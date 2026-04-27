import { describe, it, expect } from 'vitest';
import {
  encodeLegacyControlStartFrame,
  encodeLegacyControlStopFrame,
  encodeLegacyLedFrame,
  SYNC_BYTE,
  OP_LED,
  OP_SESSION,
  OP_CONTROL,
  OP_TOUCH,
  CTRL_START,
  CTRL_STOP,
  CTRL_PAUSE,
  COLOR_CODE,
  SESSION_PHASE_RHYTHM,
  SESSION_PHASE_COGNITIVE,
  TOUCH_FRAME_BYTES,
  encodeLedFrame,
  encodeLedOffFrame,
  encodeSessionFrame,
  encodeControlFrame,
  isLedOffPayload,
  tryParseTouchBytes,
  tryParseTouchHex,
  tryParseTouchBase64,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  RHYTHM_THRESHOLDS_MS,
  RHYTHM_GRADE_SCORE,
  judgeRhythmError,
  rhythmScoreFromCounts,
  onMsForLevel,
  mixedColorRate,
} from './ble-protocol.js';

function hex(...byteSeq: number[]): Uint8Array {
  return new Uint8Array(byteSeq);
}

function expectBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(bytesToHex(actual)).toBe(bytesToHex(expected));
  expect(actual.length).toBe(expected.length);
}

describe('encodeLedFrame', () => {
  it('produces a 12-byte frame with the documented layout', () => {
    const frame = encodeLedFrame({
      tickId: 0x12345678,
      pod: 2,
      colorCode: COLOR_CODE.GREEN,
      onMs: 300,
      flags: 0,
    });
    // SYNC, OP_LED, tickId LE (78 56 34 12), pod, color, onMs LE (2C 01), flags, reserved
    expectBytes(
      frame,
      hex(0xa5, 0x01, 0x78, 0x56, 0x34, 0x12, 0x02, 0x00, 0x2c, 0x01, 0x00, 0x00),
    );
    expect(frame[0]).toBe(SYNC_BYTE);
    expect(frame[1]).toBe(OP_LED);
  });

  it('encodes flags into byte 10 and keeps reserved byte 11 zero', () => {
    const frame = encodeLedFrame({
      tickId: 1,
      pod: 0,
      colorCode: COLOR_CODE.RED,
      onMs: 0,
      flags: 0xab,
    });
    expect(frame[10]).toBe(0xab);
    expect(frame[11]).toBe(0x00);
  });

  it('writes tickId as little-endian u32', () => {
    const frame = encodeLedFrame({
      tickId: 0xdeadbeef,
      pod: 0,
      colorCode: COLOR_CODE.GREEN,
      onMs: 0,
    });
    expect(Array.from(frame.slice(2, 6))).toEqual([0xef, 0xbe, 0xad, 0xde]);
  });

  it('writes onMs as little-endian u16', () => {
    const frame = encodeLedFrame({
      tickId: 0,
      pod: 0,
      colorCode: COLOR_CODE.GREEN,
      onMs: 0x1234,
    });
    expect(Array.from(frame.slice(8, 10))).toEqual([0x34, 0x12]);
  });
});

describe('encodeLedOffFrame — OFF 합의서 테스트 벡터', () => {
  // 정본: docs/firmware/led-off-convention.md §3.1
  it('vector 1: pod=0, tickId=0, color=OFF, onMs=0', () => {
    const frame = encodeLedOffFrame({ tickId: 0, pod: 0 });
    expectBytes(
      frame,
      hex(0xa5, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00),
    );
  });

  it('vector 2: pod=2, tickId=0x12345678, color=OFF, onMs=0', () => {
    const frame = encodeLedOffFrame({ tickId: 0x12345678, pod: 2 });
    expectBytes(
      frame,
      hex(0xa5, 0x01, 0x78, 0x56, 0x34, 0x12, 0x02, 0xff, 0x00, 0x00, 0x00, 0x00),
    );
  });

  it('vector 3: pod=1, tickId=0x42, color=GREEN, onMs=0 (onMs=0 단독 OFF)', () => {
    // 합의서의 세 번째 벡터는 encodeLedFrame으로 직접 만든 GREEN+onMs=0 페이로드.
    const frame = encodeLedFrame({
      tickId: 0x42,
      pod: 1,
      colorCode: COLOR_CODE.GREEN,
      onMs: 0,
    });
    expectBytes(
      frame,
      hex(0xa5, 0x01, 0x42, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00),
    );
  });

  it('encodeLedOffFrame는 항상 colorCode=0xFF, onMs=0', () => {
    for (let pod = 0; pod < 4; pod++) {
      const frame = encodeLedOffFrame({ tickId: 0xcafebabe, pod });
      expect(frame[7]).toBe(0xff);
      expect(frame[8]).toBe(0x00);
      expect(frame[9]).toBe(0x00);
      expect(frame[6]).toBe(pod);
    }
  });
});

describe('isLedOffPayload — OFF 컨벤션 진리표', () => {
  // OR 관계: colorCode==OFF 또는 onMs==0 이면 OFF
  it('OFF / 0 → true', () => {
    expect(isLedOffPayload({ colorCode: COLOR_CODE.OFF, onMs: 0 })).toBe(true);
  });
  it('OFF / 300 → true (color 단독 OFF)', () => {
    expect(isLedOffPayload({ colorCode: COLOR_CODE.OFF, onMs: 300 })).toBe(true);
  });
  it('GREEN / 0 → true (onMs 단독 OFF)', () => {
    expect(isLedOffPayload({ colorCode: COLOR_CODE.GREEN, onMs: 0 })).toBe(true);
  });
  it('GREEN / 300 → false (정상 점등)', () => {
    expect(isLedOffPayload({ colorCode: COLOR_CODE.GREEN, onMs: 300 })).toBe(false);
  });
});

describe('encodeSessionFrame', () => {
  it('produces a 14-byte frame with the documented layout', () => {
    const frame = encodeSessionFrame({
      bpm: 80,
      level: 3,
      phase: SESSION_PHASE_RHYTHM,
      durationSec: 120,
      flags: 0,
    });
    // SYNC, OP_SESSION, bpm LE (50 00), level, phase, durSec LE (78 00), flags, 5 padding
    expectBytes(
      frame,
      hex(0xa5, 0x02, 0x50, 0x00, 0x03, 0x00, 0x78, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00),
    );
    expect(frame.length).toBe(14);
    expect(frame[0]).toBe(SYNC_BYTE);
    expect(frame[1]).toBe(OP_SESSION);
  });

  it('encodes COGNITIVE phase and flags', () => {
    const frame = encodeSessionFrame({
      bpm: 0xabcd,
      level: 5,
      phase: SESSION_PHASE_COGNITIVE,
      durationSec: 0x0102,
      flags: 0x7f,
    });
    expect(Array.from(frame.slice(2, 4))).toEqual([0xcd, 0xab]); // bpm LE
    expect(frame[4]).toBe(0x05); // level
    expect(frame[5]).toBe(0x01); // phase = COGNITIVE
    expect(Array.from(frame.slice(6, 8))).toEqual([0x02, 0x01]); // durSec LE
    expect(frame[8]).toBe(0x7f); // flags
    // padding 9..13 must remain zero
    for (let i = 9; i < 14; i++) expect(frame[i]).toBe(0x00);
  });

  it('omitting flags defaults to 0', () => {
    const frame = encodeSessionFrame({
      bpm: 60,
      level: 1,
      phase: SESSION_PHASE_RHYTHM,
      durationSec: 60,
    });
    expect(frame[8]).toBe(0x00);
  });
});

describe('encodeControlFrame', () => {
  it('START → 6바이트 [A5 03 00 00 00 00]', () => {
    expectBytes(
      encodeControlFrame(CTRL_START),
      hex(0xa5, 0x03, 0x00, 0x00, 0x00, 0x00),
    );
  });
  it('STOP → [A5 03 01 00 00 00]', () => {
    expectBytes(
      encodeControlFrame(CTRL_STOP),
      hex(0xa5, 0x03, 0x01, 0x00, 0x00, 0x00),
    );
  });
  it('PAUSE → [A5 03 02 00 00 00]', () => {
    expectBytes(
      encodeControlFrame(CTRL_PAUSE),
      hex(0xa5, 0x03, 0x02, 0x00, 0x00, 0x00),
    );
  });
  it('frame[0]=SYNC, frame[1]=OP_CONTROL', () => {
    const f = encodeControlFrame(CTRL_START);
    expect(f.length).toBe(6);
    expect(f[0]).toBe(SYNC_BYTE);
    expect(f[1]).toBe(OP_CONTROL);
  });
});

describe('tryParseTouchBytes', () => {
  it('parses a well-formed TOUCH frame (deviceDeltaValid=true)', () => {
    // SYNC, OP_TOUCH, tickId=0x01020304, pod=2, channel=1, deltaMs=+50 (0x0032), flags=0x01
    const bytes = hex(0xa5, 0x81, 0x04, 0x03, 0x02, 0x01, 0x02, 0x01, 0x32, 0x00, 0x01);
    const ev = tryParseTouchBytes(bytes);
    expect(ev).not.toBeNull();
    expect(ev).toEqual({
      type: 'TOUCH',
      tickId: 0x01020304,
      pod: 2,
      channel: 1,
      deltaMs: 50,
      deviceDeltaValid: true,
    });
  });

  it('parses negative deltaMs as signed int16', () => {
    // deltaMs = -100 → 0xFF9C LE → 0x9C 0xFF
    const bytes = hex(0xa5, 0x81, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9c, 0xff, 0x00);
    const ev = tryParseTouchBytes(bytes);
    expect(ev?.deltaMs).toBe(-100);
    expect(ev?.deviceDeltaValid).toBe(false);
  });

  it('flag bit0=0 → deviceDeltaValid=false', () => {
    const bytes = hex(0xa5, 0x81, 0, 0, 0, 0, 0, 0, 0, 0, 0xfe);
    const ev = tryParseTouchBytes(bytes);
    expect(ev?.deviceDeltaValid).toBe(false);
  });

  it('flag bit0=1 (with other bits set) → deviceDeltaValid=true', () => {
    const bytes = hex(0xa5, 0x81, 0, 0, 0, 0, 0, 0, 0, 0, 0xff);
    const ev = tryParseTouchBytes(bytes);
    expect(ev?.deviceDeltaValid).toBe(true);
  });

  it('returns null when length < TOUCH_FRAME_BYTES', () => {
    const bytes = new Uint8Array(TOUCH_FRAME_BYTES - 1);
    bytes[0] = SYNC_BYTE;
    bytes[1] = OP_TOUCH;
    expect(tryParseTouchBytes(bytes)).toBeNull();
  });

  it('returns null when SYNC byte is wrong', () => {
    const bytes = hex(0x5a, 0x81, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(tryParseTouchBytes(bytes)).toBeNull();
  });

  it('returns null when OP byte is not OP_TOUCH', () => {
    const bytes = hex(0xa5, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    expect(tryParseTouchBytes(bytes)).toBeNull();
  });

  it('reads tickId as little-endian u32', () => {
    const bytes = hex(0xa5, 0x81, 0xef, 0xbe, 0xad, 0xde, 0, 0, 0, 0, 0);
    const ev = tryParseTouchBytes(bytes);
    expect(ev?.tickId).toBe(0xdeadbeef);
  });
});

describe('tryParseTouchHex / tryParseTouchBase64', () => {
  // 동일 페이로드를 hex / base64 양쪽으로 디코드 → 결과 동일해야 함
  const bytes = hex(0xa5, 0x81, 0x04, 0x03, 0x02, 0x01, 0x02, 0x01, 0x32, 0x00, 0x01);
  const expected = {
    type: 'TOUCH',
    tickId: 0x01020304,
    pod: 2,
    channel: 1,
    deltaMs: 50,
    deviceDeltaValid: true,
  };

  it('hex (소문자)', () => {
    expect(tryParseTouchHex(bytesToHex(bytes))).toEqual(expected);
  });

  it('hex (대문자 + 0x 접두 + 공백 허용)', () => {
    expect(tryParseTouchHex('0x A5 81 04 03 02 01 02 01 32 00 01')).toEqual(expected);
  });

  it('base64', () => {
    expect(tryParseTouchBase64(bytesToBase64(bytes))).toEqual(expected);
  });

  it('hex 입력이 너무 짧으면 null', () => {
    expect(tryParseTouchHex('a581')).toBeNull();
  });

  it('hex 입력이 잘못된 문자열이면 null', () => {
    expect(tryParseTouchHex('not-hex!!')).toBeNull();
  });
});

describe('round-trip — encode → bytes layout sanity', () => {
  it('LED frame 길이=12, SESSION 길이=14, CONTROL 길이=6', () => {
    expect(
      encodeLedFrame({ tickId: 0, pod: 0, colorCode: COLOR_CODE.GREEN, onMs: 0 }).length,
    ).toBe(12);
    expect(
      encodeSessionFrame({ bpm: 0, level: 1, phase: SESSION_PHASE_RHYTHM, durationSec: 0 })
        .length,
    ).toBe(14);
    expect(encodeControlFrame(CTRL_START).length).toBe(6);
  });

  it('hexToBytes/bytesToHex 가 OFF 벡터 1 을 정확히 왕복한다', () => {
    const expected = 'a50100000000 00ff00000000'.replace(/\s+/g, '');
    const frame = encodeLedOffFrame({ tickId: 0, pod: 0 });
    expect(bytesToHex(frame)).toBe(expected);
    expect(Array.from(hexToBytes(expected))).toEqual(Array.from(frame));
  });
});

// ---------------------------------------------------------------------------
// 리듬 판정 / 점수 — 회귀 테스트
// (정본: shared/ble-protocol.ts §리듬 판정, 명세 12.6)
// ---------------------------------------------------------------------------

describe('RHYTHM_THRESHOLDS_MS — 임계값 상수 잠금', () => {
  // 임계값이 바뀌면 사용자가 체감하는 난이도가 그대로 어긋난다.
  // 의도치 않은 수정을 막기 위해 정확한 숫자를 잠근다.
  it('PERFECT=45, GOOD=110, BAD=200', () => {
    expect(RHYTHM_THRESHOLDS_MS.PERFECT).toBe(45);
    expect(RHYTHM_THRESHOLDS_MS.GOOD).toBe(110);
    expect(RHYTHM_THRESHOLDS_MS.BAD).toBe(200);
  });

  it('등급별 점수표: PERFECT=100, GOOD=70, BAD=35, MISS=0', () => {
    expect(RHYTHM_GRADE_SCORE.PERFECT).toBe(100);
    expect(RHYTHM_GRADE_SCORE.GOOD).toBe(70);
    expect(RHYTHM_GRADE_SCORE.BAD).toBe(35);
    expect(RHYTHM_GRADE_SCORE.MISS).toBe(0);
  });
});

describe('judgeRhythmError — 경계값 진리표', () => {
  it('errMs=0 → PERFECT', () => {
    expect(judgeRhythmError(0)).toBe('PERFECT');
  });

  // PERFECT 경계: |errMs| <= 45 → PERFECT
  it('errMs=+45 (PERFECT 상한 inclusive) → PERFECT', () => {
    expect(judgeRhythmError(45)).toBe('PERFECT');
  });
  it('errMs=-45 (PERFECT 하한 inclusive) → PERFECT', () => {
    expect(judgeRhythmError(-45)).toBe('PERFECT');
  });
  it('errMs=+46 (PERFECT 직후) → GOOD', () => {
    expect(judgeRhythmError(46)).toBe('GOOD');
  });
  it('errMs=-46 (PERFECT 직후) → GOOD', () => {
    expect(judgeRhythmError(-46)).toBe('GOOD');
  });

  // GOOD 경계: 45 < |errMs| <= 110 → GOOD
  it('errMs=+110 (GOOD 상한 inclusive) → GOOD', () => {
    expect(judgeRhythmError(110)).toBe('GOOD');
  });
  it('errMs=-110 (GOOD 하한 inclusive) → GOOD', () => {
    expect(judgeRhythmError(-110)).toBe('GOOD');
  });
  it('errMs=+111 (GOOD 직후) → BAD', () => {
    expect(judgeRhythmError(111)).toBe('BAD');
  });
  it('errMs=-111 (GOOD 직후) → BAD', () => {
    expect(judgeRhythmError(-111)).toBe('BAD');
  });

  // BAD 경계: 110 < |errMs| <= 200 → BAD
  it('errMs=+200 (BAD 상한 inclusive) → BAD', () => {
    expect(judgeRhythmError(200)).toBe('BAD');
  });
  it('errMs=-200 (BAD 하한 inclusive) → BAD', () => {
    expect(judgeRhythmError(-200)).toBe('BAD');
  });
  it('errMs=+201 (BAD 직후) → MISS', () => {
    expect(judgeRhythmError(201)).toBe('MISS');
  });
  it('errMs=-201 (BAD 직후) → MISS', () => {
    expect(judgeRhythmError(-201)).toBe('MISS');
  });

  // MISS: |errMs| > 200
  it('errMs=+9999 → MISS', () => {
    expect(judgeRhythmError(9999)).toBe('MISS');
  });
  it('errMs=-9999 → MISS', () => {
    expect(judgeRhythmError(-9999)).toBe('MISS');
  });

  it('부호 무관: judge(+x) === judge(-x)', () => {
    for (const x of [0, 10, 45, 46, 99, 110, 111, 150, 200, 201, 500]) {
      expect(judgeRhythmError(x)).toBe(judgeRhythmError(-x));
    }
  });
});

describe('rhythmScoreFromCounts — 종합 점수 0..100', () => {
  it('counts 모두 0 → 0 (분모 보호)', () => {
    expect(rhythmScoreFromCounts({ perfect: 0, good: 0, bad: 0, miss: 0 })).toBe(0);
  });

  it('전부 PERFECT → 100', () => {
    expect(rhythmScoreFromCounts({ perfect: 10, good: 0, bad: 0, miss: 0 })).toBe(100);
  });

  it('전부 GOOD → 70', () => {
    expect(rhythmScoreFromCounts({ perfect: 0, good: 5, bad: 0, miss: 0 })).toBe(70);
  });

  it('전부 BAD → 35', () => {
    expect(rhythmScoreFromCounts({ perfect: 0, good: 0, bad: 4, miss: 0 })).toBe(35);
  });

  it('전부 MISS → 0', () => {
    expect(rhythmScoreFromCounts({ perfect: 0, good: 0, bad: 0, miss: 7 })).toBe(0);
  });

  it('PERFECT 1 + MISS 1 → 50 (가중평균)', () => {
    // (100 + 0) / (2 * 100) * 100 = 50
    expect(rhythmScoreFromCounts({ perfect: 1, good: 0, bad: 0, miss: 1 })).toBe(50);
  });

  it('PERFECT 2 + GOOD 2 → 85', () => {
    // (200 + 140) / (4 * 100) * 100 = 85
    expect(rhythmScoreFromCounts({ perfect: 2, good: 2, bad: 0, miss: 0 })).toBe(85);
  });

  it('1 of each → round((100+70+35+0)/400 * 100) = 51', () => {
    // 205/400 = 0.5125 → 51.25 → round → 51
    expect(rhythmScoreFromCounts({ perfect: 1, good: 1, bad: 1, miss: 1 })).toBe(51);
  });

  it('Math.round 사용: 0.5 이상 올림 (PERFECT 1 + GOOD 1 → 85)', () => {
    // (100+70)/200 * 100 = 85.0 (정확값) — 반올림 경계 검증
    expect(rhythmScoreFromCounts({ perfect: 1, good: 1, bad: 0, miss: 0 })).toBe(85);
  });

  it('큰 카운트도 정수로 떨어진다 (PERFECT 100 → 100)', () => {
    expect(rhythmScoreFromCounts({ perfect: 100, good: 0, bad: 0, miss: 0 })).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 트레이닝 보조 공식 — 회귀 테스트 (명세 12.6)
// ---------------------------------------------------------------------------

describe('onMsForLevel — clamp(380 - level*45, 120, 420)', () => {
  // 명세 12.6: level 1..5 기준 점등 길이 산출
  it('level=1 → 335ms (380 - 45)', () => {
    expect(onMsForLevel(1)).toBe(335);
  });
  it('level=2 → 290ms', () => {
    expect(onMsForLevel(2)).toBe(290);
  });
  it('level=3 → 245ms', () => {
    expect(onMsForLevel(3)).toBe(245);
  });
  it('level=4 → 200ms', () => {
    expect(onMsForLevel(4)).toBe(200);
  });
  it('level=5 → 155ms', () => {
    expect(onMsForLevel(5)).toBe(155);
  });

  // clamp 하한: 380 - L*45 < 120 ⇔ L > 5.78 → 6 이상에서 발생
  it('level=6 → 120ms (하한 clamp; 380 - 270 = 110 → 120)', () => {
    expect(onMsForLevel(6)).toBe(120);
  });
  it('level=100 → 120ms (하한 clamp 유지)', () => {
    expect(onMsForLevel(100)).toBe(120);
  });

  // clamp 상한: 380 - L*45 > 420 ⇔ L < -0.89 → 음수에서 발생
  it('level=0 → 380ms (clamp 범위 안)', () => {
    expect(onMsForLevel(0)).toBe(380);
  });
  it('level=-1 → 420ms (상한 clamp; 380 + 45 = 425 → 420)', () => {
    expect(onMsForLevel(-1)).toBe(420);
  });
  it('level=-100 → 420ms (상한 clamp 유지)', () => {
    expect(onMsForLevel(-100)).toBe(420);
  });

  it('결과는 항상 [120, 420] 범위 안', () => {
    for (let l = -10; l <= 20; l++) {
      const v = onMsForLevel(l);
      expect(v).toBeGreaterThanOrEqual(120);
      expect(v).toBeLessThanOrEqual(420);
    }
  });
});

describe('mixedColorRate — Lv≤1 → 0, Lv≥5 → 0.35, 사이 선형 보간', () => {
  // 명세 12.6: 혼합색 등장 비율
  it('level=1 → 0 (하한 inclusive)', () => {
    expect(mixedColorRate(1)).toBe(0);
  });
  it('level=0 → 0 (하한 clamp)', () => {
    expect(mixedColorRate(0)).toBe(0);
  });
  it('level=-5 → 0 (하한 clamp)', () => {
    expect(mixedColorRate(-5)).toBe(0);
  });

  it('level=5 → 0.35 (상한 inclusive)', () => {
    expect(mixedColorRate(5)).toBe(0.35);
  });
  it('level=10 → 0.35 (상한 clamp)', () => {
    expect(mixedColorRate(10)).toBe(0.35);
  });

  // 선형 보간: ((L - 1) / 4) * 0.35
  it('level=2 → 0.0875', () => {
    expect(mixedColorRate(2)).toBeCloseTo(0.0875, 10);
  });
  it('level=3 → 0.175 (중앙값)', () => {
    expect(mixedColorRate(3)).toBeCloseTo(0.175, 10);
  });
  it('level=4 → 0.2625', () => {
    expect(mixedColorRate(4)).toBeCloseTo(0.2625, 10);
  });

  it('단조 비감소: level이 커질수록 비율도 같거나 커진다', () => {
    let prev = -Infinity;
    for (let l = 0; l <= 6; l++) {
      const v = mixedColorRate(l);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

// ---------------------------------------------------------------------------
// 레거시 모드 인코더 (savexx 명세 §11/§12.5)
// ---------------------------------------------------------------------------

describe('encodeLegacyLedFrame', () => {
  it('pod 0 → 4e 01 0d', () => {
    expect(Array.from(encodeLegacyLedFrame({ pod: 0 }))).toEqual([0x4e, 0x01, 0x0d]);
  });
  it('pod 1 → 4e 02 0d', () => {
    expect(Array.from(encodeLegacyLedFrame({ pod: 1 }))).toEqual([0x4e, 0x02, 0x0d]);
  });
  it('pod 3 → 4e 04 0d (앱이 사용하는 4 pod 의 마지막)', () => {
    expect(Array.from(encodeLegacyLedFrame({ pod: 3 }))).toEqual([0x4e, 0x04, 0x0d]);
  });
  it('pod 7 → 4e 08 0d (spec §11 COLOR 1..8 상한)', () => {
    expect(Array.from(encodeLegacyLedFrame({ pod: 7 }))).toEqual([0x4e, 0x08, 0x0d]);
  });
  it('pod -1 또는 8 → RangeError', () => {
    expect(() => encodeLegacyLedFrame({ pod: -1 })).toThrow(RangeError);
    expect(() => encodeLegacyLedFrame({ pod: 8 })).toThrow(RangeError);
  });
  it('항상 길이 3', () => {
    for (let p = 0; p <= 7; p++) {
      expect(encodeLegacyLedFrame({ pod: p }).length).toBe(3);
    }
  });
});

describe('encodeLegacyControlStartFrame / encodeLegacyControlStopFrame', () => {
  it('START → aa 55', () => {
    expect(Array.from(encodeLegacyControlStartFrame())).toEqual([0xaa, 0x55]);
  });
  it('STOP → ff', () => {
    expect(Array.from(encodeLegacyControlStopFrame())).toEqual([0xff]);
  });
});
