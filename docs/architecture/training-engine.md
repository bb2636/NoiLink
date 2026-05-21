# Training Engine — Architecture History

`client/src/training/engine.ts` 의 모드별/플랫폼별 결정 사항을 모았다. 라이브 가드는 `replit.md` 의 "Architecture decisions" 에 요약돼 있고, 이 문서는 회귀 이력과 상세 근거를 보존한다.

---

## BLE Notify Parser Order (legacy)

`tryParseAnyNotifyBytes` 는 200ms notify 스트림을 다음 우선순위로 분류한다:

1. TOUCH (`0xA5 / 0x81` 11B)
2. IR (5B **또는 6B**, 마지막 두 바이트 `0x0D 0x0A`)
3. NDEF Text (`0xD1 0x01 …`)
4. raw ASCII fallback

**회귀 이력:** NINA-B1-FB55CE 펌웨어는 IR+진동 패킷을 `06 BD 00 00 0D 0A` 같은 **6바이트** 형식(reserved 1바이트 추가)으로 보낸다. 과거 파서는 5바이트만 인정해 모든 IR 패킷이 raw ASCII fallback 까지 떨어졌다가 `0x06`(비-printable)에서 또 실패해 전부 드롭됐다 — 진단 line 의 RX 카운트는 늘지만 실제 채점이 0회가 되는 "패드 입력 무반응" 회귀의 직접 원인. 길이 무관하게 마지막 두 바이트가 `0x0D 0x0A` 인지로만 IR 을 판정한다.

펌웨어가 NFC 태그 텍스트를 NDEF wrapper 없이(`0x6C 0x65` = `"le"`) 보내는 경우도 있어 raw ASCII fallback 이 함께 필요. `nfcTextToPod` 가 `"1".."4"` 또는 `"left"/"right"/"up"/"down"` 을 pod 0..3 으로 매핑.

---

## MEMORY Sequence Loop

MEMORY phase 는 SHOW→RECALL cycle 을 phase time 이 다할 때까지 반복.

- `runMemorySequence()` 가 한 cycle 을 스케줄링.
- `advanceMemorySequence()` (idempotent — `memorySequenceAdvancing` flag) 가 RECALL window 만료 또는 sequence 완료/실패 시 다음 cycle 트리거.
- `handleTap` 은 MEMORY RECALL 진행 중에는 trailing `allOff()` 를 skip — 같은 sequence 의 후속 입력(BLE TOUCH / IR / NFC)이 OFF guard 에 막히지 않도록.

---

## Engine BLE Write Defense (Task #150)

`engine.ts` 의 모든 BLE write(`bleWriteSession`/`bleWriteControl`/`bleWriteLed`)는 `safeBleWrite*` wrapper 를 거치며 throw 를 삼킨다.

**회귀 이력:** COMPOSITE 트레이닝이 LED 도 안 들어오고 입력도 5분 내내 0회였던 사례 — `start()` 내부의 단일 BLE throw 가 `runNextPlan()` 실행 전에 path 를 중단시켰고, `handleTap` 이 모든 입력을 OFF guard 에서 거부해 BLE 에러가 "입력 0회" 증상으로 가려졌다.

`startTickLoop` 는 새 타이머 스케줄 전에 이전 `tickTimer` 를 cancel — phase 전환 시 fireTick loop 중복 실행 방지.

---

## BLE Diagnostic Line (Task #153)

`TrainingSessionPlay` 와 `Device` 페이지에 1Hz polled 진단 line:
`BLE: FW=O/X/? · L=ON/OFF · TX=N <hex> · RX=M <hex>`

- TX: `getBleFirmwareReady` / `getLegacyBleMode` / `getLegacyEmittedCount` / `getLegacyLastEmittedFrameHex` 기반.
- RX (`notifyDiagRef`): 모든 `ble.notify` 에 대해 **classification 이전** 에 카운트 + 마지막 raw payload 를 hex 로 저장 (20자 truncate).

**근거:** Task #150 의 `safeBleWrite*` 가 throw 를 silent 로 삼키기 때문에, 이 line 없이는 "점등 안 됨" 보고를 firmware-not-ready (FW=X → 전 write skip) / legacy-mode mismatch / engine-not-emitting / device-side-ignore 중 어디인지 구분 못 한다. RX 카운터는 "NFC tap 됐는데 notify 가 WebView 에 안 도달함" vs "notify 는 왔지만 `nfcTextToPod` 가 매핑 못 함" 을 구분.

훈련 화면은 `height: 100vh` → `100dvh` (with 100vh fallback) — 모바일 WebView 주소창에 입력 카운터가 화면 밖으로 밀려나지 않도록.

---

## Mobile Shell SafeAreaView Wrapper

`mobile/src/screens/WebShellScreen.tsx` 가 `WebAppWebView` 를 `SafeAreaView edges={['top','bottom','left','right']}` 로 감싼다.

**근거:** 웹측의 `#root { padding-top: env(safe-area-inset-top) }` 만으로는 Android WebView 에서 status bar 회피가 안 됨 (WebView 가 status bar 아래로 그려지는데 `env(safe-area-inset-top)` 은 0 으로 resolve). 결과적으로 training/result 헤더가 시스템 status bar 에 가려지는 회귀가 있었다. Native-layer SafeAreaView 가 OS quirk 와 무관하게 보장.

---

## MULTITASKING (F) — handleTap source 채널 분리

`engine.handleTap(podId, opts)` 의 `opts.source: 'touch' | 'nfc'` 가 명세 F. 멀티태스킹의 손/발 입력 채널을 표현한다.

- BLE TOUCH 11B / IR 진동 → `'touch'` (손, 진동센서 = 손으로 두드림).
- NFC NDEF Text / raw ASCII → `'nfc'` (발).
- `TrainingSessionPlay` 가 명시적으로 source 를 넘긴다.

**채널 정합성:** `GREEN(앵커)+touch` / `BLUE·YELLOW(발)+nfc` 가 정상. 그 외(`GREEN+nfc`, `BLUE+touch`) 는 채널 침범 — hit 인정 없이 `aCrossChannelErrors` 만 누적, footAccuracy / handRate 가 자연스럽게 깎인다.

AGILITY (=멀티태스킹) 모드의 `handleAgilityTap` 만 source 사용. 다른 모드는 영향 없음. source 미지정 호출(단위 테스트 / 미마이그레이션 경로)은 채널 검증을 skip 해 기존 동작 호환.

`MULTITASKING_API_MODE = 'AGILITY'` alias 유지 — 서버 score-calculator 와 저장 스키마는 'AGILITY' 단일 모드로 통합.

---

## MULTITASKING (F) — 동시(simul) 자극 윈도우 (`agilitySimulPending`)

Lv4+ 동시 자극(GREEN 앵커 + BLUE 오른발 동시 점등)에서 명세 F 의 `20*동시성공률` 항을 구조적으로 보장하기 위해, 두 채널 모두 윈도우 안에 정확 입력될 때까지 자극을 유지한다.

- `fireAgilityTick` simul 분기에서 lit pod id 두 개를 `agilitySimulPending: Set<number>` 로 기록.
- `handleAgilityTap` 의 정확 입력에 따라 set 에서 pod 제거 — set 이 비면 `aSimulHit++` + state clear 후 `handleTap` 끝의 `allOff()` 진행, 남으면 입력 pod 만 단일 OFF 하고 `keepOtherPodLit=true` 로 다른 pod LED 보존.
- **채널 침범 입력:** 즉시 simul state 무효화 — 두 pod 모두 종료(=동시성공 자연 실패) + `aCrossChannelErrors++`.
- **윈도우 만료** (`schedule()` 로 `simulOnMs+50` 예약): 미입력 pod 가 남아 있으면 simul state 만 자동 정리 (다음 tick 의 단일 자극이 simul 로 잘못 분류되지 않도록).
- **`agilitySimulSeq` 토큰 가드:** simul cleanup 은 `simulOnMs+50` 후 fire 되지만 다음 tick 은 `beatMs` 에 시작하므로, 토큰 일치 검사 없이 비우면 새 simul 의 두 번째 채널 입력 요건이 우회돼 한 채널만으로 `aSimulHit` 가 카운트되는 회귀 부활.
- **`pause()` leak 가드:** `pendingTimers` cancel 시 `agilitySimulPending` 도 명시 null 정리 — 그렇지 않으면 resume 후 다음 단일 자극의 첫 정확 입력이 stale pending set 에 잘못 매칭되어 `aSimulHit++` leak.

이 윈도우 정책 없이 첫 입력에서 무조건 `allOff()` 로 두 pod 를 모두 끄면 두 번째 채널이 영영 입력될 수 없어 명세상 동시성공이 0% 로 고정된다.

**회귀 가드:** `engine.test.ts` "AGILITY Lv4 동시 점등 → 두 채널 모두 정확 입력되면 두 Pod 모두 OFF" + `engine.agility.test.ts` 의 동시 자극 시나리오 + 토큰 가드/pause leak 라이프사이클 테스트.

---

## 펌웨어 LED 색상 코드 정렬 (2026-05-19, 라이브 검증)

`encodeLegacyLedFrame` 의 두 번째 바이트는 **pod 인덱스가 아니라 색상 코드** 다.

NINA-B1-FB55CE 펌웨어 실측:
```
0x01=R  0x02=B  0x03=G  0x04=R+B(보라)
0x05=R+G(노랑)  0x06=B+G(하늘)  0x07=R+B+G(흰)  0x08=OFF
```

단일 LED 라 `pod` 인자를 받지 않음 — 멀티 기기 시나리오는 BLE 연결 자체를 기기별로 분리해 동일 프레임을 라우팅하는 별도 작업으로 분리.

**회귀 이력:** 과거 `pod+1` 을 색 자리에 넣던 구현은 1..4 가 색 값으로도 우연히 유효해 점등은 됐지만 의도색과 무관했다 (예: GREEN 요청 → BLUE 점등). `COLOR_CODE` 정의(`shared/ble-protocol.ts`)도 같이 갱신 — 과거 `GREEN=0, OFF=0xFF` 가 `GREEN=0x03, OFF=0x08` 로 바뀌어 NoiPod 정식 12바이트 골든 벡터도 정렬.

**펌웨어 송신 조건 (누락시 무반응):**
1. Notifications enabled (CCCD 활성화)
2. Write Without Response

`bleWriteCharacteristic('write', b64, 'withoutResponse')` 와 `monitorCharacteristicForService` 가 이미 보장.

**OFF 분기:** "송신 생략" → "명시적 `0x08` 송신" 으로 변경 — 단일 LED 라 OFF 명령을 안 보내면 직전 색이 잔존.

**회귀 가드:** `shared/ble-protocol.test.ts` `encodeLegacyLedFrame` 골든 (RED/BLUE/GREEN/YELLOW/WHITE/OFF 1~8 + RangeError + 길이 3).

---

## Task #155 — 6모드 정합성 점검 결과 (5개 항목 traceability)

1. **LED 1~8 매핑** (encodeLegacyLedFrame): 위 "펌웨어 LED 색상 코드 정렬" 로 대체. 시그니처 `{ colorCode }` 로 변경, 골든 테스트도 색상 6종 + OFF + RangeError 로 갱신.
2. **COMPREHENSION 카운터** (cNoMixedUntilTicks/cSwitchCount/flashAll WHITE): `engine.test.ts` 에 3건 신규 테스트 (전환 직후 카운터 셋팅·자연 감소·상한, RED 풀 제외 효과, `flashAll(WHITE,250)` podCount 만큼 송신).
3. **COMPOSITE Early/Mid/Late 경계 정렬**: 아래 "ENDURANCE 경계 정렬" 항목 참조.
4. **ENDURANCE 산식 동기화**: server/spec 분기는 의도된 운영 결정 (아래 항목). 명세 가중치 골든 케이스를 `shared/training-spec.test.ts` 에 codify, Task #156 으로 follow-up.
5. **JUDGMENT 더블탭 윈도우** (judgmentDoubleTapWindowMs): `shared/training-spec.test.ts` L237~250 기존 BPM 60/70/120/140 + Task #155-tagged 보강 4건 (BPM 40 하한, 77 전환점, 78 산식, 200 상한).

---

## ENDURANCE Early/Mid/Late 경계 정렬 (Task #155)

`engine.ts` 의 `recordIntervalCount` / `recordIntervalHit` / 구간 omission 누적은 `earlyMidLateBucket(elapsedMs)` 로 일원화 — 경계가 `total/3`, `total*2/3` (300s 세션 기준 100s/200s) 로 정렬돼 `shared/training-spec.ts` 의 `ENDURANCE_EARLY_END_MS=100_000` / `ENDURANCE_LATE_START_MS=200_000` 와 정확히 일치.

**회귀 이력:** 과거 `0.34/0.66` 근사는 102s/198s 로 어긋나 100~102s 입력이 Mid 가 아닌 Early 로, 198~200s 입력이 Late 가 아닌 Mid 로 잘못 누적되어 `maintainRatio = lateScore/earlyScore` 가 미세하게 비뚤어졌다.

**회귀 가드:** `engine.test.ts` "Early/Mid/Late 버킷 경계는 1/3·2/3 으로 정렬된다".

---

## ENDURANCE 점수 산식 — server vs spec 분기 (의도된)

`shared/training-spec.ts` 의 `scoreEndurance()` 는 명세 가중치
```
40*maintainRatio + 20*(1-Drift) + 15*(1-omissionInc) + 15*lateStability + 10*lateSpeed
```
(Late 표본 부족시 Early-only 재정규화) 를 정의한다.

실제 운영 점수 계산은 `server/services/score-calculator.ts` `calculateEnduranceScore` 가 NormConfig 기반 Z-score 정규화(maintainRatio Z-score 80 + rhythmAccuracy 20) 로 수행.

**근거:** 다른 5개 지표(memory/comprehension/focus/judgment/agility)가 모두 동일한 Z-score 통합 정규화 경로를 쓰기 때문에 ENDURANCE 만 다른 산식을 쓰면 지표간 분포가 어긋난다는 운영 결정.

명세 산식 채택은 6지표 일괄 정규화 재설계가 선행돼야 하므로 별도 Task. `scoreEndurance()` 헬퍼는 단위 테스트와 향후 산식 마이그레이션의 참조로 유지.

---

## handleTap dedup scope (`consumedTickIds`)

`(pod, tickId)` dedup 은 **`opts.tickId` 가 명시될 때만** 적용 (BLE TOUCH 11B 프레임 — firmware 가 tickId 를 echo).

NFC raw / IR vibration / 단위 테스트 호출은 `opts.tickId` 가 없어 dedup 을 완전히 skip.

**근거:** MEMORY RECALL `[0,1,0]` 같은 sequence 는 같은 Pod 가 반복되는데 `pod.tickId` 가 RECALL 윈도우 내내 상수라 dedup 을 적용하면 Pod 0 의 두 번째 hit 이 silent drop. JUDGMENT YELLOW 더블탭도 두 번째 탭이 거부됨.

**Trade-off:** NFC/IR 은 engine-side native-redispatch 보호가 없지만, 200ms firmware polling cadence 가 중복 dispatch 가능성을 낮춤.
