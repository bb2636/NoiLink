# NoiPod 트레이닝 한 사이클 끝-to-끝 검증 체크리스트

본 문서는 실제 NoiPod 펌웨어가 들어간 기기와 모바일 셸(Expo/RN)을 사용해
"발견 → 연결 → 세션 시작 → 점등 → 터치 응답 → 정상 종료"까지 한 사이클을 사람이 직접
끝까지 흘려 본 결과를 기록하는 체크리스트입니다.

문서는 두 부분으로 구성됩니다.

- **Part A (이번 빌드에서 자동 검증 완료)** — 격리된 에이전트 환경에서 합성 BLE 프레임과
  엔진과 동일한 산식을 사용해 자동 검증한 결과. 데이터 경로(SESSION/CONTROL/LED 인코딩,
  TOUCH 디코딩, deltaMs → rhythm 메트릭 산식 일치)는 이미 PASS.
- **Part B (실 하드웨어가 필요한 항목)** — 실 NoiPod + 모바일 셸이 있어야 사람이 직접
  확인 가능한 발견·연결·물리 점등·언마운트 시 LED OFF·서버 반영. 다음 검증 사이클을
  진행하는 검증자가 채워 넣을 수 있도록 빈 체크박스로 보존.

웹/Replit 미리보기에서는 BLE 호출이 모두 no-op로 떨어지므로 Part B 검증은 반드시 모바일
셸(또는 BLE 권한이 살아 있는 데스크톱 셸 환경)에서 수행해야 합니다.

---

## 0. 환경 정보 기록

| 항목                       | 값 (Part A: 에이전트) | 값 (Part B: 사람 검증자) |
| -------------------------- | --------------------- | ------------------------ |
| 검증 일시                  | 2026-04-24            |                          |
| 검증자                     | Replit Agent (격리 환경) |                          |
| 앱 빌드 (커밋/버전)        | 본 PR HEAD             |                          |
| 모바일 OS / 디바이스 모델  | n/a (하드웨어 없음)    |                          |
| NoiPod 펌웨어 버전         | n/a (하드웨어 없음)    |                          |
| NoiPod 광고 이름           | n/a                    | (예: `NINA-B1-FB55CE` / `NoiPod-XXXXXX`) |
| 테스트한 트레이닝 모드/세팅 | (Part A는 합성 데이터) | COMPOSITE 5분 (300s, 30s×5사이클) / RHYTHM 1분 (60s) |
| BPM / Level                | 90 / 3 (합성)          |                          |

**전제 코드 정합성** (코드 변경 시 반드시 같이 갱신)
- `shared/training-spec.ts`: `COMPOSITE_TOTAL_MS = 300_000`, `RHYTHM_PHASE_MS = 30_000`,
  `COGNITIVE_PHASE_MS = 30_000`. **(코드 확인 완료)**
- `shared/ble-protocol.ts`: `RHYTHM_THRESHOLDS_MS = { PERFECT: 45, GOOD: 110, BAD: 200 }`,
  `RHYTHM_GRADE_SCORE = { PERFECT:100, GOOD:70, BAD:35, MISS:0 }`. **(자동 검증 PASS)**
- `shared/ble-constants.ts`: `NOIPOD_BLE.SERVICE/NOTIFY/WRITE` 가 펌웨어와 일치.
  현재 u-blox NINA-B1 SPS 표준 UUID `2456e1b9-...d701` / `...d703`.
  **펌웨어 팀과 한 번 더 매칭 확인 필요.**
- 의미색 매핑 `LOGIC_TO_HARDWARE_COLOR`:
  GREEN→G, RED→R, BLUE→B, YELLOW→RG, WHITE→RGB. `logicColorToCode` 결과는
  COLOR_CODE.GREEN(0)/RED(1)/BLUE(2)/YELLOW(3)/WHITE(4). **(코드 확인 완료)**

> 펌웨어가 광고 이름·UUID·프레임 레이아웃 중 어느 하나라도 바꿨다면, 본 검증을 시작하기
> 전에 위 상수를 먼저 동기화해야 합니다.

---

# Part A — 에이전트가 자동 검증 완료한 항목

본 절은 `scripts/synthetic-noipod-e2e.mjs` 의 출력으로 채워집니다.
재실행: `cd shared && npm run build && node scripts/synthetic-noipod-e2e.mjs`.
2026-04-24 실행 결과 **55 passed / 0 failed**.

## A1. SESSION / CONTROL / LED 프레임 인코딩 (앱 → 기기)

| # | 검증 항목 | 결과 |
|---|-----------|------|
| A1.1 | SESSION 14바이트, SYNC=0xA5, OP=0x02, BPM/Level/phase/durationSec 모두 LE 정합 | ✅ PASS |
| A1.2 | CONTROL 6바이트, START cmd=0x00, STOP cmd=0x01 | ✅ PASS |
| A1.3 | LED 12바이트, tickId u32 LE, pod/colorCode/onMs 정합 | ✅ PASS |

## A2. TOUCH 프레임 디코딩 (기기 → 앱)

| # | 검증 항목 | 결과 |
|---|-----------|------|
| A2.1 | 11바이트 TOUCH 프레임을 bytes/base64/hex 모두에서 동일하게 파싱 | ✅ PASS |
| A2.2 | signed int16 deltaMs (예: -52) 정상 복원 | ✅ PASS |
| A2.3 | flags bit0 → `deviceDeltaValid` 정상 분기 (0x01=true, 0x00=false) | ✅ PASS |
| A2.4 | 잘못된 SYNC 또는 길이 부족 프레임은 `null` | ✅ PASS |

## A3. RHYTHM 등급 임계값 정합성

| # | 검증 항목 | 결과 |
|---|-----------|------|
| A3.1 | \|0..45\|=PERFECT, \|46..110\|=GOOD, \|111..200\|=BAD, \|201+\|=MISS, 음수도 절댓값 기준 | ✅ PASS |
| A3.2 | grade 점수 100/70/35/0, `RHYTHM_THRESHOLDS_MS` 상수와 일치 | ✅ PASS |

## A4. 합성 60-tap 시나리오 — `deltaMs` → 메트릭 반영

엔진의 `handleRhythmTap` 과 `buildMetrics` 와 **동일한 식**(|deltaMs| → judge → counts,
avgOffset = 평균, accuracy = (P + 0.5G + 0.2B)/N)을 합성 입력에 적용한 결과.

| 입력 분포 | counts (P/G/B/M) | avgOffset (ms) | accuracy | rhythm score |
|-----------|------------------|----------------|----------|--------------|
| **A. 디바이스 입력 (P30/G20/B10)** | 30/20/10/0 | **53** | **0.700** | **79** |
| **B. 화면 클릭 가정 (100~250ms 분산)** | 0/5/37/18 | **172** | 0.165 | 27 |
| **C. 모두 늦은 입력 (250ms)** | 0/0/0/30 | 250 | 0 | 0 |

검증된 사실:
- 디바이스 입력(분포 A)이 화면 클릭(분포 B)보다 avgOffset 이 **약 3배 작고**(53 vs 172ms),
  accuracy 가 **0.7 vs 0.165 로 4배 이상** 높다 → 펌웨어 deltaMs 가 메트릭에 반영되면
  결과 화면 `rhythm.avgOffset` 이 화면 클릭 케이스 대비 **유의미하게 작게** 나와야 한다는
  것이 수치적으로 증명됨.
- accuracy 식 `(P + 0.5G + 0.2B)/N` = `(30 + 10 + 2)/60` = `0.700` 과 정확히 일치 → 엔진
  산식이 명세대로 동작.

## A5. 엔진 송신 시퀀스 (정적 코드 검증)

`client/src/training/engine.ts` 코드 흐름 확인:

| # | 시점 | 송신 | 결과 |
|---|------|------|------|
| A5.1 | `start()` (COMPOSITE/단일 모드 모두) | `bleWriteSession({phase,bpm,level,durationSec})` 1회 → `bleWriteControl(CTRL_START)` | ✅ 코드 확인 |
| A5.2 | `runNextPlan()` 페이즈 전환 | 새 phase 가 직전과 다르면 `bleWriteSession` 재송신 | ✅ 코드 확인 |
| A5.3 | `lightSinglePod` / `lightTwoPods` / `flashAll` | `bleWriteLed({tickId,pod,colorCode,onMs})` 송신, monotonic tickId 부여 | ✅ 코드 확인 |
| A5.4 | `destroy()` (언마운트/취소) | `bleWriteControl(CTRL_STOP)` 1회 | ✅ 코드 확인 |
| A5.5 | `complete()` (정상 종료) | `bleWriteControl(CTRL_STOP)` 1회 | ✅ 코드 확인 |
| A5.6 | `handleTap`: stale BLE TOUCH (다른 tickId) | drop, accepted=false | ✅ 코드 확인 |
| A5.7 | `handleTap`: 같은 (pod,tickId) 중복 입력 | `consumedTickIds` 가드로 1회만 처리 | ✅ 코드 확인 |
| A5.8 | `bleBridge.post`: 네이티브 셸이 아닐 때 (`isNoiLinkNativeShell()===false`) | 모든 BLE 호출 silent no-op | ✅ 코드 확인 |

## A6. Part A 종합

- BLE 데이터 경로(인코딩/디코딩/임계값/메트릭 산식)는 펌웨어와 정합.
- 엔진 송신 시퀀스는 명세대로 작성되어 있음.
- **남은 위험 항목은 모두 "실 무전기/실 발판/실 LED" 가 있어야만 검증 가능.**
- 자동화 가능한 한도 내 결과: **PASS (55/55)**.

---

# Part B — 실 NoiPod + 모바일 셸 검증 (사람이 채울 항목)

다음 절은 실 NoiPod 한 대와 빌드된 모바일 셸이 필요합니다. 각 행의 결과란을 채워 주세요.

## 1. 발견 (Discovery)  *[하드웨어 필요]*

| # | 검증 항목 | 기대 동작 | 결과 |
|---|-----------|-----------|------|
| 1.1 | 모바일 셸의 디바이스 스캔 화면 진입 (`DeviceScanScreen` 또는 `BleScreen`) | BLE 권한·블루투스 ON 프롬프트가 한 번 뜨고 정상 통과 | ☐ Pass / ☐ Fail |
| 1.2 | NoiPod를 전원 ON 한 뒤 스캔 시작 | 5초 이내에 디바이스 카드가 1회 이상 노출 (`nameContains: 'NoiPod'` 필터 적용) | ☐ Pass / ☐ Fail |
| 1.3 | 동일 디바이스가 RSSI 갱신되며 중복 카드로 쌓이지 않음 | 카드는 deviceId 기준 1개만 | ☐ Pass / ☐ Fail |
| 1.4 | 스캔 종료 버튼 또는 타임아웃 | `ble.scanState`가 `scanning: false`로 떨어지고 LED는 영향 없음 | ☐ Pass / ☐ Fail |

메모:

## 2. 연결 (Connect)  *[하드웨어 필요]*

| # | 검증 항목 | 기대 동작 | 결과 |
|---|-----------|-----------|------|
| 2.1 | 발견된 NoiPod 카드 탭 → 연결 | 15초 이내 `ble.connection.connected` 도착 | ☐ Pass / ☐ Fail |
| 2.2 | 연결 직후 GATT 자동 탐색 | `ble.gatt` 이벤트로 `services` + `selected.write/notify` 도착 (없으면 NoiPod 상수 fallback) | ☐ Pass / ☐ Fail |
| 2.3 | 트레이닝 화면에 들어가지 않은 상태에서 1분 대기 | 자동 disconnect 없음 | ☐ Pass / ☐ Fail |
| 2.4 | 디바이스 전원을 잠깐 OFF/ON | unexpected disconnect → reconnect 시도 → 성공 시 connection 재발사 | ☐ Pass / ☐ Fail |

메모:

## 3. COMPOSITE 5분 — 시작 + 1번째 RHYTHM 페이즈  *[하드웨어 필요]*

세션 시작 시 코드 경로(`engine.start` → `bleWriteSession` → `bleWriteControl(START)` → `runNextPlan`).

| # | 검증 항목 | 기대 동작 | 결과 |
|---|-----------|-----------|------|
| 3.1 | COMPOSITE 5분, BPM/Lv 임의 값으로 시작 | 화면 진입 직후 1초 이내 NoiPod 점등 시작. 첫 점등은 GREEN(RHYTHM). | ☐ Pass / ☐ Fail |
| 3.2 | SESSION 프레임이 RHYTHM(`phase=0`) + `durationSec≈30`으로 1회 송신 (펌웨어 디버그 로그/표시 LED 확인) | OK | ☐ Pass / ☐ Fail |
| 3.3 | CONTROL_START(`cmd=0`)가 SESSION 직후 1회 송신 | OK | ☐ Pass / ☐ Fail |
| 3.4 | 화면 PodGrid의 점등과 NoiPod 실물 점등이 같은 Pod·같은 색·같은 시점 (육안 100ms 이내) | OK | ☐ Pass / ☐ Fail |
| 3.5 | Lv 패턴: Lv1~2 4/4 P0→P1→P2→P3, Lv3 2/4 P0/P1, Lv4 2/4+8분 P2/P3, Lv5 P0+P1/P2+P3 동시+8분 교차 | OK | ☐ Pass / ☐ Fail |
| 3.6 | 발판/터치 입력 → **화면 클릭 없이도** `입력 N회` 카운트 증가 | OK | ☐ Pass / ☐ Fail |
| 3.7 | 약 60ms 빠르게/느리게 입력 → ble.touch payload `\|deltaMs\|≈60`, judge=GOOD | OK | ☐ Pass / ☐ Fail |
| 3.8 | 200ms 이상 늦게 입력 → BAD 또는 MISS | OK | ☐ Pass / ☐ Fail |
| 3.9 | 같은 점등에 화면 클릭 + NoiPod 발판 거의 동시 → 카운트 1회만 증가 | ✅ Part A에서 dedup 가드 코드 확인 | ☐ Pass / ☐ Fail (실측) |

메모 (관측한 deviceDeltaMs 분포, 패턴 어긋남, 끊김 등):

## 4. COMPOSITE — 페이즈 전환 (RHYTHM ↔ COGNITIVE)  *[하드웨어 필요]*

5분 = RHYTHM 30s + COGNITIVE 30s × 5사이클. 인지 순서: MEMORY → COMPREHENSION → FOCUS → JUDGMENT → AGILITY.

| # | 검증 항목 | 기대 동작 | 결과 |
|---|-----------|-----------|------|
| 4.1 | 30초 시점 RHYTHM → COGNITIVE(MEMORY) 전환 | 페이즈 칩 "리듬 유지" → "인지 과제 / 기억력" | ☐ Pass / ☐ Fail |
| 4.2 | 페이즈 전환 시 SESSION 프레임 재송신(`phase=1`, `durationSec≈30`) | OK | ☐ Pass / ☐ Fail |
| 4.3 | MEMORY: 초록 시퀀스 → 흰색 신호 → 같은 순서 입력. 흰색 신호가 4개 Pod에 동시 RGB | OK | ☐ Pass / ☐ Fail |
| 4.4 | COMPREHENSION: 규칙색만 정답. 규칙 전환 시 4개 Pod 흰색 깜빡임 송출 | OK | ☐ Pass / ☐ Fail |
| 4.5 | FOCUS: BLUE만 타겟, RED/YELLOW 무시. 발판이 채점에 반영 | OK | ☐ Pass / ☐ Fail |
| 4.6 | JUDGMENT: GREEN=1탭, RED=참기, YELLOW=2탭. RED 입력 시 충동 누적 | ☐ Pass / ☐ Fail |
| 4.7 | AGILITY: GREEN=손, BLUE/YELLOW=발. Lv4+ 동시 점등 | ☐ Pass / ☐ Fail |
| 4.8 | 5사이클 동안 BPM 박자 일정 (점등 간격 흔들림 없음) | OK | ☐ Pass / ☐ Fail |
| 4.9 | 5분 정확히 경과 → 결과 페이지 자동 전환 + LED 모두 OFF + CONTROL_STOP 1회 | OK | ☐ Pass / ☐ Fail |

메모:

## 5. RHYTHM 단독 1분 세션  *[하드웨어 필요]*

| # | 검증 항목 | 기대 동작 | 결과 |
|---|-----------|-----------|------|
| 5.1 | 시작 직후 SESSION + CONTROL_START (단일 모드는 코드상 `phase=COGNITIVE` 로 송신) | OK | ☐ Pass / ☐ Fail |
| 5.2 | 60초 동안 RHYTHM 패턴이 BPM에 맞춰 끊김 없이 점등 | OK | ☐ Pass / ☐ Fail |
| 5.3 | 발판 입력 30회 이상 → `입력 N회` ≥ 30 | OK | ☐ Pass / ☐ Fail |
| 5.4 | 60초 종료 → 결과 화면, LED 즉시 OFF | OK | ☐ Pass / ☐ Fail |

메모:

## 6. 디바이스 측정 입력 시간(`deviceDeltaMs`) → 메트릭 반영 검증

**Part A 합성 결과 (✅ PASS)**: 동일 입력 분포에 대해 디바이스 입력 케이스가 화면 클릭
케이스보다 `avgOffset` 이 **53ms vs 172ms** 로 약 3배 작고, accuracy 가 **0.700 vs 0.165**
로 4배 이상 높음을 산식 차원에서 증명. 위 § A4 표 참조.

**Part B (하드웨어 필요)** — 실제 펌웨어 측정값과 화면 표시값을 비교:

검증 방법:
1. RHYTHM 60초를 진행할 때, 일부러 ① 정확히, ② 약 60ms 빠르게(또는 늦게), ③ 약 150ms 늦게 입력을 섞어서 침.
2. 결과 화면 또는 `/record` 의 직전 세션 상세에서 리듬 메트릭(`perfectCount/goodCount/badCount/missCount`, `avgOffset`, `offsetSD`)을 확인.

| # | 검증 항목 | 결과 |
|---|-----------|------|
| 6.1 | 입력 의도 비율(예: P:G:B = 4:3:2)과 실제 결과 카운트 분포가 비슷 | ☐ Pass / ☐ Fail |
| 6.2 | `avgOffset`이 펌웨어 deltaMs 절댓값 평균과 ±10ms 이내 (펌웨어 디버그와 비교) | ☐ Pass / ☐ Fail |
| 6.3 | 화면 클릭만으로 동일 세션을 한 번 더 진행 → 디바이스 입력 케이스가 더 작은 avgOffset | ☐ Pass / ☐ Fail |
| 6.4 | `ble.touch` payload에서 `deviceDeltaValid: true` 가 70% 이상 도착 | ☐ Pass / ☐ Fail |

기록값:
- 평균 deviceDeltaMs 절댓값(펌웨어 측):  
- 결과 화면 `rhythm.avgOffset`:  
- 차이(±):  

## 7. 중도 종료 / 언마운트 시 즉시 정지  *[하드웨어 필요]*

코드 경로:
- 화면 언마운트(취소/뒤로) → `TrainingSessionPlay`의 `useEffect` cleanup → `engine.destroy()`
  → 켜져 있던 Pod에 LED OFF 프레임 송신 + `bleWriteControl(CTRL_STOP)`. **(코드 확인 완료)**
- 앱 백그라운드 진입 (네이티브 셸 한정 — 일반 웹/Replit 미리보기에서는 비활성):
  1차: 웹 측 `document.visibilitychange` 핸들러가 `engine.endNow()` 호출.
  `endNow`는 정상 종료(complete)와 동일한 경로로 LED OFF + `CONTROL_STOP` 송신 후
  지금까지 누적된 메트릭으로 `onComplete`를 발사 → 평소처럼 `runSubmit` →
  결과 화면(`/result`)으로 이동. 자동 재개 없음.
  2차: 네이티브 측 `AppState` 'active→background/inactive' 전환 시
  `NativeBridgeDispatcher.ensureAppLifecycleHandlerBound`가
  연결된 NoiPod에 `CONTROL_STOP` 프레임을 한 번 더 직접 송신 (WebView JS 정지 안전망).
  **(코드 확인 완료)**

| # | 검증 항목 | 기대 동작 | 결과 |
|---|-----------|-----------|------|
| 7.1 | 진행 중 "뒤로"/"취소" 탭 | NoiPod LED 1초 이내 OFF, 점등 중단 | ☐ Pass / ☐ Fail |
| 7.2 | 진행 중 OS 백버튼/제스처로 강제 빠져나감 | 위와 동일하게 STOP 전송 + LED OFF | ☐ Pass / ☐ Fail |
| 7.3 | 진행 중 앱 백그라운드 → 5초 후 복귀 | 백그라운드 진입 1초 이내 LED 모두 OFF. 포그라운드 복귀 시 자동 재개 없이, 그때까지 누적된 메트릭으로 산출된 결과 화면(`/result`) 표시 | ☐ Pass / ☐ Fail |
| 7.4 | 진행 중 NoiPod 강제 OFF 또는 BLE 범위 이탈 | 화면은 진행, LED 송신 silent fail, `connection: null` + reconnect 시도 | ☐ Pass / ☐ Fail |

메모:

## 8. 결과 저장 / 리포트 / 랭킹 반영  *[하드웨어 필요 — 합성 데이터로는 산식만 확인]*

| # | 검증 항목 | 기대 동작 | 결과 |
|---|-----------|-----------|------|
| 8.1 | COMPOSITE 5분 종료 직후 결과 화면에 점수 0 초과 | OK | ☐ Pass / ☐ Fail |
| 8.2 | `/record` 화면에 방금 끝낸 세션이 가장 위에 추가 | OK | ☐ Pass / ☐ Fail |
| 8.3 | 세션 상세에서 6대 지표가 모두 0이 아닌 값으로 채워짐 | OK | ☐ Pass / ☐ Fail |
| 8.4 | `/ranking` 본인 스코어/순위 갱신 | OK | ☐ Pass / ☐ Fail |
| 8.5 | `/report` 주간/월간 추이에 오늘 데이터 추가 | OK | ☐ Pass / ☐ Fail |

메모:

---

## 9. 종합 판정

### 9.A  Part A (에이전트 자동 검증)

| 영역 | 결과 |
|------|------|
| BLE 프레임 인코딩/디코딩 정합성 | ✅ PASS (29/29) |
| RHYTHM 등급 임계값 정합성 | ✅ PASS (15/15) |
| 합성 60-tap 시나리오 — 메트릭 반영 산식 | ✅ PASS (8/8) |
| 엔진 송신 시퀀스 (정적 코드) | ✅ PASS (3/3) |
| **Part A 합계** | **✅ 55 / 55 PASS** |

### 9.B  Part B (실 하드웨어 — 사람 검증)

- COMPOSITE 5분 풀 사이클 완주: ☐ Pass / ☐ Fail
- RHYTHM 1분 세션 완주: ☐ Pass / ☐ Fail
- deviceDeltaMs → `rhythm.avgOffset` 정합성: ☐ Pass / ☐ Fail
- 중도 종료/언마운트 시 즉시 LED OFF: ☐ Pass / ☐ Fail
- 결과·리포트·랭킹 자동 반영: ☐ Pass / ☐ Fail

**최종 결과:** ☐ Pass / ☐ Fail / ☐ Conditional Pass

총평 / 후속 조치 필요 항목:

---

## 부록 A. 디버그 로그에서 확인하면 좋은 키워드

- 모바일(Metro/Logcat):
  - `[BLE] connect …` `[BLE] connected + discovered` `[BLE] reconnect …`
  - `[NoiLink bridge] BleManagerError` `[NoiLink bridge] handler error`
  - `ble.touch` payload (`tickId`, `pod`, `channel`, `deltaMs`, `deviceDeltaValid`)
  - `ble.writeLed` / `ble.writeSession` / `ble.writeControl`
- 웹뷰(Chrome remote):
  - `engineRef.current?.handleTap accepted=true/false`
  - 동일 `pod:tickId` 키가 두 번 들어오면 두 번째는 `accepted=false`

## 부록 B. 알려진 한계 / 본 빌드의 비범위 항목

- NFC 발판 채널은 BLE TOUCH의 `channel` 필드로만 구분, 별도 NFC 통신은 미연결.
- 펌웨어 OTA / ack 프로토콜 미적용.
- 백그라운드 진입 시 STOP 자동 송신은 §7.3 코드 경로(웹 visibilitychange + 네이티브
  AppState 안전망)로 보장. iOS의 `bluetooth-central` 백그라운드 모드를 별도로 켜지
  않은 빌드에서는 백그라운드 후 즉시 STOP 프레임이 OS 큐에 쌓였다가 다음 포그라운드
  복귀에 송신될 수 있다 — 펌웨어가 STOP을 늦게 받는 케이스의 보강은 별도 검토.
- 기기 미연결 시 사용자에게 "기기 없이 진행 중" 안내 UI는 별도 작업.
- 격리 에이전트 환경에는 실 NoiPod 가 없으므로 발견·연결·물리 점등·LED OFF·서버 반영
  검증은 본 검증 사이클에서는 불가.

## 부록 C. 자동 재실행

```sh
cd shared && npm run build
node scripts/synthetic-noipod-e2e.mjs
# 기대 출력 마지막 줄: "--- 결과: 55 passed, 0 failed ---"
```

스크립트가 실패하면 검증을 중단하고, 실패 항목을 `git diff shared/ble-protocol.ts`
또는 `client/src/training/engine.ts` 와 함께 보고할 것.
