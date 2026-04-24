// 합성 (synthetic) NoiPod E2E 검증 스크립트
//
// 실제 NoiPod 하드웨어 없이 격리된 에이전트 환경에서 실행 가능한 범위 안에서:
//  1) BLE 프레임 인코딩(SESSION/CONTROL/LED)이 펌웨어 명세 바이트 레이아웃과 일치하는지
//  2) 펌웨어가 보내는 11바이트 TOUCH 프레임을 base64/hex 양쪽으로 정상 파싱하는지
//  3) judgeRhythmError가 임계값(45/110/200ms)대로 등급을 매기는지
//  4) 펌웨어가 측정한 deltaMs를 그대로 |errMs|로 사용했을 때, 엔진의 metric 산식과
//     동일한 수식을 통과시키면 입력 분포에 비례한 rhythm.avgOffset / accuracy 가
//     기대 범위 안에서 산출되는지
// 를 자동 검증한다.
//
// 본 스크립트가 통과한다고 해서 실제 하드웨어 검증을 대체하지는 않는다.
// 발견(스캔)/연결(GATT)/물리 LED 점등/터치 응답/언마운트 시 LED OFF 같은
// "기기 + 모바일 셸" 통합 시나리오는 사람이 직접 수행해야 하며, 결과는
// docs/noipod-end-to-end-verification.md 의 §1~5,7,8 에 기록한다.
//
// 실행: `node scripts/synthetic-noipod-e2e.mjs`
// (사전 조건: `cd shared && npm run build`)

import {
  COLOR_CODE,
  CTRL_START,
  CTRL_STOP,
  OP_CONTROL,
  OP_LED,
  OP_SESSION,
  OP_TOUCH,
  RHYTHM_GRADE_SCORE,
  RHYTHM_THRESHOLDS_MS,
  SESSION_PHASE_COGNITIVE,
  SESSION_PHASE_RHYTHM,
  SYNC_BYTE,
  TOUCH_FRAME_BYTES,
  bytesToBase64,
  bytesToHex,
  encodeControlFrame,
  encodeLedFrame,
  encodeSessionFrame,
  judgeRhythmError,
  rhythmScoreFromCounts,
  tryParseTouchBase64,
  tryParseTouchBytes,
  tryParseTouchHex,
} from '../shared/dist/index.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(label, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`);
  }
}

function section(name) {
  console.log(`\n=== ${name} ===`);
}

// ---------------------------------------------------------------------------
section('1. SESSION 프레임 인코딩');
{
  const f = encodeSessionFrame({
    bpm: 90, level: 3, phase: SESSION_PHASE_RHYTHM, durationSec: 30,
  });
  check('SESSION 프레임은 14바이트', f.length === 14);
  check('SYNC byte 0xA5', f[0] === SYNC_BYTE);
  check('OP_SESSION (0x02)', f[1] === OP_SESSION);
  check('BPM little-endian (90 = 0x5A 0x00)', f[2] === 0x5A && f[3] === 0x00);
  check('Level 3', f[4] === 3);
  check('phase = RHYTHM(0)', f[5] === 0);
  check('durationSec=30 LE', f[6] === 30 && f[7] === 0);
}

section('2. CONTROL 프레임 인코딩');
{
  const start = encodeControlFrame(CTRL_START);
  const stop = encodeControlFrame(CTRL_STOP);
  check('CONTROL 프레임은 6바이트', start.length === 6 && stop.length === 6);
  check('CONTROL_START cmd=0', start[0] === SYNC_BYTE && start[1] === OP_CONTROL && start[2] === 0);
  check('CONTROL_STOP cmd=1', stop[0] === SYNC_BYTE && stop[1] === OP_CONTROL && stop[2] === 1);
}

section('3. LED 프레임 인코딩');
{
  const led = encodeLedFrame({
    tickId: 0x12345678,
    pod: 2,
    colorCode: COLOR_CODE.BLUE,
    onMs: 420,
  });
  check('LED 프레임은 12바이트', led.length === 12);
  check('SYNC + OP_LED', led[0] === SYNC_BYTE && led[1] === OP_LED);
  check('tickId LE (0x78,0x56,0x34,0x12)',
    led[2] === 0x78 && led[3] === 0x56 && led[4] === 0x34 && led[5] === 0x12);
  check('pod=2', led[6] === 2);
  check('colorCode=BLUE(2)', led[7] === COLOR_CODE.BLUE);
  check('onMs=420 LE', led[8] === (420 & 0xff) && led[9] === ((420 >> 8) & 0xff));
}

section('4. TOUCH 프레임 디코딩 (펌웨어 → 앱)');
{
  // 펌웨어가 보낼 법한 TOUCH 프레임 직접 조립
  const buf = new Uint8Array(TOUCH_FRAME_BYTES);
  buf[0] = SYNC_BYTE;
  buf[1] = OP_TOUCH;
  // tickId = 0x000003E8 (1000)
  buf[2] = 0xE8; buf[3] = 0x03; buf[4] = 0x00; buf[5] = 0x00;
  buf[6] = 1;            // pod = 1
  buf[7] = 0;            // channel = HAND
  // deltaMs = -52 (signed int16) → 0xFFCC LE
  buf[8] = 0xCC; buf[9] = 0xFF;
  buf[10] = 0x01;        // flags: deviceDeltaValid

  const fromBytes = tryParseTouchBytes(buf);
  check('TOUCH 파싱 성공 (bytes)', fromBytes !== null);
  check('tickId=1000', fromBytes?.tickId === 1000);
  check('pod=1', fromBytes?.pod === 1);
  check('channel=0 (HAND)', fromBytes?.channel === 0);
  check('deltaMs=-52 (signed)', fromBytes?.deltaMs === -52);
  check('deviceDeltaValid=true', fromBytes?.deviceDeltaValid === true);

  // base64/hex 라운드트립
  const b64 = bytesToBase64(buf);
  const fromB64 = tryParseTouchBase64(b64);
  check('base64 라운드트립 동치',
    fromB64?.tickId === 1000 && fromB64?.deltaMs === -52 && fromB64?.deviceDeltaValid === true);
  const hex = bytesToHex(buf);
  const fromHex = tryParseTouchHex(hex);
  check('hex 라운드트립 동치',
    fromHex?.tickId === 1000 && fromHex?.deltaMs === -52);

  // flags=0x00 → deviceDeltaValid=false
  buf[10] = 0x00;
  const inv = tryParseTouchBytes(buf);
  check('flags=0x00 → deviceDeltaValid=false', inv?.deviceDeltaValid === false);

  // 잘못된 SYNC → null
  const bad = new Uint8Array(buf);
  bad[0] = 0x00;
  check('잘못된 SYNC는 null', tryParseTouchBytes(bad) === null);
  // 짧은 프레임 → null
  check('11바이트 미만은 null', tryParseTouchBytes(new Uint8Array(5)) === null);
}

section('5. judgeRhythmError 임계값 (45 / 110 / 200ms)');
{
  check('|0|=PERFECT', judgeRhythmError(0) === 'PERFECT');
  check('|45|=PERFECT (경계)', judgeRhythmError(45) === 'PERFECT');
  check('|46|=GOOD', judgeRhythmError(46) === 'GOOD');
  check('|110|=GOOD (경계)', judgeRhythmError(110) === 'GOOD');
  check('|111|=BAD', judgeRhythmError(111) === 'BAD');
  check('|200|=BAD (경계)', judgeRhythmError(200) === 'BAD');
  check('|201|=MISS', judgeRhythmError(201) === 'MISS');
  check('음수도 절댓값 기준 (-50)=GOOD', judgeRhythmError(-50) === 'GOOD');
  check('grade score 표 (PERFECT=100)', RHYTHM_GRADE_SCORE.PERFECT === 100);
  check('grade score 표 (GOOD=70)', RHYTHM_GRADE_SCORE.GOOD === 70);
  check('grade score 표 (BAD=35)', RHYTHM_GRADE_SCORE.BAD === 35);
  check('grade score 표 (MISS=0)', RHYTHM_GRADE_SCORE.MISS === 0);
  check('PERFECT 임계값', RHYTHM_THRESHOLDS_MS.PERFECT === 45);
  check('GOOD 임계값', RHYTHM_THRESHOLDS_MS.GOOD === 110);
  check('BAD 임계값', RHYTHM_THRESHOLDS_MS.BAD === 200);
}

// ---------------------------------------------------------------------------
section('6. 합성 60-tap 시나리오: 펌웨어 deltaMs → rhythm 메트릭 반영');

// 펌웨어가 60회 측정해 보낸 deltaMs (ms, signed) — 4가지 분포 섞기
function simulate(distribution) {
  const counts = { perfect: 0, good: 0, bad: 0, miss: 0 };
  const offsets = [];
  // 엔진의 handleRhythmTap 과 동일한 식: |deltaMs| 를 offset 으로 사용
  for (const dms of distribution) {
    const offset = Math.abs(dms);
    offsets.push(offset);
    const grade = judgeRhythmError(offset);
    if (grade === 'PERFECT') counts.perfect += 1;
    else if (grade === 'GOOD') counts.good += 1;
    else if (grade === 'BAD') counts.bad += 1;
    else counts.miss += 1;
  }
  const avg = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const variance = offsets.reduce((a, b) => a + (b - avg) ** 2, 0) / (offsets.length - 1 || 1);
  const sd = Math.sqrt(variance);
  // 엔진 buildMetrics 의 rhythm.accuracy 산식
  const totalRhythm = Math.max(1, distribution.length);
  const accuracy = (counts.perfect + counts.good * 0.5 + counts.bad * 0.2) / totalRhythm;
  const score = rhythmScoreFromCounts(counts);
  return { counts, avgOffset: Math.round(avg), offsetSD: Math.round(sd), accuracy, score };
}

// 분포 A: 정확한 입력 위주 (P 30, G 20, B 10)
const distA = [];
for (let i = 0; i < 30; i++) distA.push((i % 2 ? 1 : -1) * (10 + (i % 30)));   // |0..39|
for (let i = 0; i < 20; i++) distA.push((i % 2 ? 1 : -1) * (50 + (i % 50)));   // |50..99|
for (let i = 0; i < 10; i++) distA.push((i % 2 ? 1 : -1) * (120 + (i % 60))); // |120..179|

const a = simulate(distA);
console.log(
  `  분포 A (P30/G20/B10): counts=${JSON.stringify(a.counts)} ` +
  `avgOffset=${a.avgOffset}ms SD=${a.offsetSD}ms accuracy=${a.accuracy.toFixed(3)} score=${a.score}`
);
check('분포 A: PERFECT 카운트=30', a.counts.perfect === 30);
check('분포 A: GOOD 카운트=20', a.counts.good === 20);
check('분포 A: BAD 카운트=10', a.counts.bad === 10);
check('분포 A: MISS 카운트=0', a.counts.miss === 0);
check('분포 A: avgOffset 합리적 (30~80ms)', a.avgOffset >= 30 && a.avgOffset <= 80);
check('분포 A: accuracy ≈ (30 + 10 + 2)/60 = 0.700', Math.abs(a.accuracy - 42/60) < 1e-9);

// 분포 B: 화면 클릭 시뮬레이션 — wall-clock 기반이라 평균 offset 이 더 큼
// (실제 엔진은 deltaMs 가 없으면 wall-clock 차이를 사용하지만, 합성에서는
//  60회 모두 100~250ms 범위로 가정)
const distB = Array.from({ length: 60 }, (_, i) => 100 + ((i * 17) % 150));
const b = simulate(distB);
console.log(
  `  분포 B (화면 클릭 가정): counts=${JSON.stringify(b.counts)} ` +
  `avgOffset=${b.avgOffset}ms accuracy=${b.accuracy.toFixed(3)} score=${b.score}`
);
check('분포 B: avgOffset > 분포 A avgOffset (디바이스 입력이 더 정확)',
  b.avgOffset > a.avgOffset);
check('분포 B: accuracy < 분포 A accuracy', b.accuracy < a.accuracy);

// 분포 C: 매우 늦은 입력 — 모두 MISS
const distC = Array.from({ length: 30 }, () => 250);
const c = simulate(distC);
check('분포 C: 모두 MISS', c.counts.miss === 30 && c.score === 0);

// ---------------------------------------------------------------------------
section('7. 엔진 송신 시퀀스 정합성 (정적 코드 검증)');
// 본 항목은 client/src/training/engine.ts 의 코드 흐름을 사람이 읽고 확인.
// 자동화 가능한 부분만 여기서 표시:
console.log('  (정적 검증) start():');
console.log('   - bleWriteSession({phase, bpm, level, durationSec}) 1회');
console.log('   - bleWriteControl(CTRL_START)');
console.log('  (정적 검증) runNextPlan() — phase 전환 시 bleWriteSession 재송신');
console.log('  (정적 검증) lightSinglePod / lightTwoPods / flashAll — bleWriteLed 송신');
console.log('  (정적 검증) destroy() — bleWriteControl(CTRL_STOP) 1회');
console.log('  (정적 검증) complete() — bleWriteControl(CTRL_STOP) 1회');
check('CTRL_START opcode === 0', CTRL_START === 0);
check('CTRL_STOP opcode === 1', CTRL_STOP === 1);
check('SESSION_PHASE_RHYTHM === 0', SESSION_PHASE_RHYTHM === 0);
check('SESSION_PHASE_COGNITIVE === 1', SESSION_PHASE_COGNITIVE === 1);

// ---------------------------------------------------------------------------
console.log(`\n--- 결과: ${passed} passed, ${failed} failed ---`);
if (failed > 0) {
  console.log('실패 항목:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
process.exit(0);
