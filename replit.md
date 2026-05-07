# NoiLink - 뇌지컬 트레이닝

A mobile-optimized web application for cognitive ability training and analysis, analyzing "Brainimal" type and providing customized reports.

## Run & Operate

```bash
npm run dev        # Runs both frontend (port 5000) and backend (port 3001) concurrently
npm run build      # Build all workspaces (shared → client → server)
cd shared && npm run build # Must build shared before client
```

**Required Environment Variables:**
- `JWT_SECRET`: Required in production.
- `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`: Admin seed credentials. `ADMIN_PASSWORD` required for seeding in production.
- `DB_TYPE`: Explicitly selects DB (`postgres`, `replit`, or `local`).
- `DATABASE_URL`: PostgreSQL connection string.

**Database Auto-detection:**
1. `DB_TYPE` env var
2. `DATABASE_URL` → PostgreSQL
3. `REPLIT_DB_URL` or `REPL_ID` → Replit Database
4. Fallback → Local JSON file at `server/data/`

## Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, React Router v6
- **Backend:** Node.js, Express.js, TypeScript (tsx)
- **Database:** PostgreSQL / Replit Database / Local JSON fallback
- **Auth:** JWT tokens, bcryptjs for password hashing
- **Build Tool:** npm monorepo (Vite for client)

## Where things live

- `client/`: React frontend application.
- `server/`: Express.js backend API.
- `shared/`: Shared TypeScript types and utilities (ESM-only).
- `shared/ble-protocol.ts`: Source of truth for BLE hardware protocol (LED, SESSION, CONTROL, TOUCH encoding).
- `shared/ble-stability-config.ts`: BLE stability remote configuration schema and defaults.
- `shared/kst-date.ts`: KST-based date utility functions, used for attendance and ranking.
- `docs/firmware/led-off-convention.md`: Firmware agreement for LED immediate turn-off.
- `docs/operations/ble-stability-threshold-tuning.md`: Guide for BLE disconnect threshold tuning.
- `docs/operations/ble-abort-telemetry.md`: BLE abort telemetry details.
- `docs/operations/ack-banner-telemetry.md`: ACK reject toast telemetry details.

## Architecture decisions

- **Idempotent Training Session Saves:** `POST /api/sessions`, `POST /api/metrics/calculate`, `POST /api/metrics/raw` endpoints support `Idempotency-Key` header to prevent duplicate training saves during network retries. The client generates a stable `localId` for this.
- **ESM-only Shared Package:** The `@noilink/shared` package is ESM-only (`"type": "module"`), enforcing `import` syntax to prevent runtime errors. A `post-merge.sh` script validates this.
- **Unified Ranking Source:** User ranking cards (`/api/rankings/user/:userId/card`) derive all 4 stats (compositeScore, totalTimeHours, streakDays, attendanceRate) from the same 14-day window and session data as the main ranking table (`/api/rankings`).
- **BLE Legacy Mode Toggle:** Supports both current NINA-B1 firmware (legacy mode, default ON) and future NoiPod specification (toggle OFF), with specific encoding/decoding logic for each. Includes a migration for users with old settings.
- **BLE Notify Parser Order (legacy):** `tryParseAnyNotifyBytes` classifies the 200ms notify stream in priority order: TOUCH (0xA5/0x81 11B) → IR (5B **또는 6B**, 마지막 두 바이트 0x0D 0x0A) → NDEF Text (0xD1 0x01 …) → **raw ASCII fallback**. NINA-B1-FB55CE 펌웨어는 IR+진동 패킷을 `06 BD 00 00 0D 0A` 같은 **6바이트** 형식(reserved 1바이트 추가)으로 보내는데, 과거 파서는 5바이트만 인정해 모든 IR 패킷이 raw ASCII fallback 까지 떨어졌다가 0x06(비-printable)에서 또 실패해 전부 드롭됐고 — 진단 line 의 RX 카운트는 늘지만 실제 채점이 0회가 되는 "패드 입력 무반응" 회귀의 직접 원인이었다. 길이 무관하게 마지막 두 바이트가 `0x0D 0x0A` 인지로만 IR 을 판정한다. 한편 펌웨어가 NFC 태그 텍스트를 NDEF wrapper 없이(`0x6C 0x65` = `"le"`) 보내는 경우도 있어 raw ASCII fallback 이 함께 필요하다. `nfcTextToPod` 가 `"1".."4"` 또는 `"left"/"right"/"up"/"down"` 을 pod 0..3 으로 매핑한다.
- **KST-based Date Consistency:** All date-dependent calculations for result comparison, attendance, and rankings use KST (Korean Standard Time) helpers (`shared/kst-date.ts`) to ensure consistency regardless of client device timezones.
- **MEMORY Sequence Loop:** MEMORY phase repeats SHOW→RECALL cycles until phase time runs out. `runMemorySequence()` schedules one cycle; `advanceMemorySequence()` (idempotent via `memorySequenceAdvancing` flag) triggers the next on either RECALL window expiry or sequence completion/failure. `handleTap` skips the trailing `allOff()` while MEMORY RECALL is in progress so that subsequent inputs (BLE TOUCH / IR / NFC) of the same sequence are not blocked by the OFF guard.
- **Engine BLE Write Defense (Task #150):** All BLE writes from `client/src/training/engine.ts` (`bleWriteSession`/`bleWriteControl`/`bleWriteLed`) go through `safeBleWrite*` wrappers that swallow throws. Composite training failed (no LED + no input the whole 5min) when a single BLE throw inside `start()` aborted the path before `runNextPlan()` ran — `handleTap` then rejected every input on the OFF guard, masking the underlying BLE error as a "no input" symptom. `startTickLoop` also cancels any prior `tickTimer` before scheduling a new one to prevent overlapping fireTick loops on phase transitions.
- **BLE Diagnostic Line (Task #153):** Both `TrainingSessionPlay` and `Device` pages render a 1Hz-polled diagnostic line `BLE: FW=O/X/? · L=ON/OFF · 송신=N · <hex>` from `getBleFirmwareReady` / `getLegacyBleMode` / `getLegacyEmittedCount` / `getLegacyLastEmittedFrameHex`. Required because Task #150 `safeBleWrite*` wrappers swallow throws silently — without this line, "점등이 안 들어옴" reports have no user-visible signal to distinguish firmware-not-ready (FW=X → all writes skipped) from legacy-mode mismatch from engine-not-emitting from device-side ignore. Training screen also switched from `height: 100vh` to `100dvh` (with 100vh fallback) so the input counter is no longer pushed off-screen by mobile WebView address bar.
- **BLE Diagnostic Line — RX Counter (mobile real-device feedback):** Training screen diag line extended to `BLE: FW=… · L=… · TX=N <hex> · RX=M <hex>` to show both directions. `notifyDiagRef` increments on every `ble.notify` (counted **before** classification) and stores the last raw payload as space-separated hex (truncated to 20 chars). Required because the previous TX-only line couldn't distinguish "NFC tag tapped but no notify reached the WebView" from "notify reached but `nfcTextToPod` couldn't map the text" — both manifest as "입력 0회" on the screen. The pre-classification count and raw hex let the user see the literal bytes the firmware sends (e.g. `6c 65` = `"le"`) and confirm whether the raw-ASCII fallback path needs adjustment for their tag labels.
- **Mobile Shell SafeAreaView Wrapper:** `mobile/src/screens/WebShellScreen.tsx` wraps `WebAppWebView` in `SafeAreaView` with `edges={['top','bottom','left','right']}`. The web-side `#root { padding-top: env(safe-area-inset-top) }` alone is unreliable on Android WebView (the WebView draws under the status bar but `env(safe-area-inset-top)` resolves to 0), causing the training/result headers to be visually clipped by the system status bar. Native-layer SafeAreaView guarantees the WebView never overlaps system UI regardless of OS quirks.
- **MULTITASKING (F) 입력 채널 분리 (handleTap source):** `engine.handleTap(podId, opts)` 의 `opts.source: 'touch' | 'nfc'` 가 명세 F. 멀티태스킹의 손/발 채널 구분 입력 소스를 표현한다. BLE TOUCH 11B 프레임과 IR 진동 카운트는 `'touch'`(손, 진동센서는 손으로 두드린 것), NFC NDEF Text / raw ASCII 는 `'nfc'`(발) 로 분류해 `TrainingSessionPlay` 가 명시적으로 넘긴다. AGILITY(=멀티태스킹) 모드의 `handleAgilityTap` 만 source 를 사용하며, 다른 모드는 영향 없음. `GREEN(앵커)+touch` / `BLUE·YELLOW(발)+nfc` 가 정상이고, 그 외(예: `GREEN+nfc`, `BLUE+touch`) 는 채널 침범으로 hit 인정 없이 `aCrossChannelErrors` 만 누적 — 결과적으로 footAccuracy / handRate 가 자연스럽게 깎인다. source 미지정 호출(단위 테스트 / 미마이그레이션 경로) 은 채널 검증을 스킵해 기존 동작과 호환을 유지한다. `MULTITASKING_API_MODE = 'AGILITY'` alias 는 그대로 유지 — 서버 score-calculator 와 저장 스키마는 'AGILITY' 모드 하나로 통합 관리.
- **MULTITASKING (F) 동시(simul) 자극 윈도우 (`agilitySimulPending`):** Lv4+ 동시 자극(GREEN 앵커 + BLUE 오른발 동시 점등) 에서 명세 F 의 `20*동시성공률` 항을 구조적으로 보장하기 위해, 두 채널 모두 윈도우 안에 정확 입력될 때까지 자극을 유지한다. `fireAgilityTick` simul 분기에서 lit pod id 두 개를 `agilitySimulPending: Set<number>` 로 기록하고, `handleAgilityTap` 의 정확 입력에 따라 set 에서 pod 를 제거 — set 이 비면 `aSimulHit++` + state clear 후 `handleTap` 끝의 `allOff()` 진행, 남으면 입력 pod 만 단일 OFF 하고 `handleTap` 으로 `keepOtherPodLit=true` 를 반환해 다른 pod 의 LED 를 보존한다. 채널 침범(cross-channel) 입력은 즉시 simul state 무효화 — 두 pod 모두 종료(=동시성공 자연 실패) + `aCrossChannelErrors++`. simul 윈도우 만료(`schedule()` 로 `simulOnMs+50` 예약) 시 미입력 pod 가 남아 있으면 simul state 만 자동 정리 (다음 tick 의 단일 자극이 simul 로 잘못 분류되지 않도록). cleanup 콜백은 `agilitySimulSeq` 토큰 가드로 보호 — simul cleanup 은 `simulOnMs+50` 후 fire 되지만 다음 tick 은 `beatMs` 에 시작하므로, 토큰 일치 검사 없이 비우면 새 simul 의 두 번째 채널 입력 요건이 우회되어 한 채널만으로 `aSimulHit` 가 카운트되는 회귀가 되살아난다. 또한 `pause()` 가 `pendingTimers` 를 cancel 하면서 `agilitySimulPending` 도 명시적으로 null 로 정리 — 그렇지 않으면 resume 후 다음 단일 자극의 첫 정확 입력이 stale pending set 에 잘못 매칭되어 `aSimulHit++` 가 되는 leak 이 생긴다. 이 윈도우 정책 없이 첫 입력에서 무조건 `allOff()` 로 두 pod 를 모두 끄면 두 번째 채널이 영영 입력될 수 없어 명세상 동시성공이 0% 로 고정된다 — 회귀 가드는 `engine.test.ts` 의 "AGILITY Lv4 동시 점등 → 두 채널 모두 정확 입력되면 두 Pod 모두 OFF" 테스트와 `engine.agility.test.ts` 의 동시 자극 시나리오 + 토큰 가드/pause leak 라이프사이클 테스트들이 담당.
- **Task #155 — 6모드 정합성 점검 결과 (5개 항목 traceability):**
  1. **LED 1~8 매핑** (encodeLegacyLedFrame): `shared/ble-protocol.test.ts` L567~586 의 pod 0/1/3/7 + RangeError 테스트로 회귀 가드 OK — 추가 변경 없음.
  2. **COMPREHENSION 카운터** (cNoMixedUntilTicks/cSwitchCount/flashAll WHITE): `client/src/training/engine.test.ts` 에 3건 신규 테스트 추가 (전환 직후 카운터 셋팅·자연 감소·상한, RED 풀 제외 효과, flashAll(WHITE,250) podCount 만큼 송신).
  3. **COMPOSITE Early/Mid/Late 경계 정렬**: `engine.ts` 의 0.34/0.66 근사 → 1/3·2/3 으로 교체 (아래 "ENDURANCE Early/Mid/Late 경계 정렬" 항목 참조).
  4. **ENDURANCE 산식 동기화**: server/spec 분기는 의도된 운영 결정 (아래 "ENDURANCE 점수 산식 — server vs spec 분기" 항목) — 명세 가중치 골든 케이스를 `shared/training-spec.test.ts` 에 codify, Task #156 으로 follow-up.
  5. **JUDGMENT 더블탭 윈도우** (judgmentDoubleTapWindowMs): `shared/training-spec.test.ts` L237~250 기존 BPM 60/70/120/140 + Task #155-tagged 보강 4건 (BPM 40 하한, 77 전환점, 78 산식, 200 상한).
- **ENDURANCE Early/Mid/Late 경계 정렬 (Task #155):** `engine.ts` 의 `recordIntervalCount`/`recordIntervalHit`/구간 omission 누적은 `earlyMidLateBucket(elapsedMs)` 로 일원화 — 경계가 `total/3`, `total*2/3` (300s 세션 기준 100s/200s) 로 정렬돼 `shared/training-spec.ts` 의 `ENDURANCE_EARLY_END_MS=100_000` / `ENDURANCE_LATE_START_MS=200_000` 와 정확히 일치한다. 과거 `0.34/0.66` 근사는 102s/198s 로 어긋나 100~102s 입력이 Mid 가 아닌 Early 로, 198~200s 입력이 Late 가 아닌 Mid 로 잘못 누적되어 `maintainRatio = lateScore/earlyScore` 가 미세하게 비뚤어졌다. 회귀 가드: `engine.test.ts` "Early/Mid/Late 버킷 경계는 1/3·2/3 으로 정렬된다".
- **ENDURANCE 점수 산식 — server vs spec 분기 (의도된):** `shared/training-spec.ts` 의 `scoreEndurance()` 는 명세 가중치 `40*maintainRatio + 20*(1-Drift) + 15*(1-omissionInc) + 15*lateStability + 10*lateSpeed` (Late 표본 부족시 Early-only 재정규화) 를 정의하지만, 실제 운영 점수 계산은 `server/services/score-calculator.ts` `calculateEnduranceScore` 가 NormConfig 기반 Z-score 정규화(maintainRatio Z-score 80 + rhythmAccuracy 20) 로 수행한다. 이는 다른 5개 지표(memory/comprehension/focus/judgment/agility) 가 모두 동일한 Z-score 통합 정규화 경로를 쓰기 때문에 ENDURANCE 만 다른 산식을 쓰면 지표간 분포가 어긋난다는 운영 결정에서 비롯됐다. 명세 산식 채택은 6지표 일괄 정규화 재설계가 선행돼야 하므로 별도 Task 로 분리. `scoreEndurance()` 헬퍼는 단위 테스트와 향후 산식 마이그레이션의 참조로 유지한다.
- **handleTap dedup scope (consumedTickIds):** Dedup of `(pod, tickId)` is applied **only when `opts.tickId` is explicitly provided** (i.e. BLE TOUCH 11B frames where the firmware echoes a tickId). NFC raw / IR vibration / unit-test calls have no `opts.tickId` and skip dedup entirely — otherwise sequences like MEMORY RECALL `[0,1,0]` (same Pod repeats while `pod.tickId` stays constant for the whole RECALL window) would silently drop the second hit on Pod 0, and JUDGMENT YELLOW double-taps would have the second tap rejected. Trade-off: NFC/IR has no engine-side native-redispatch protection, but the 200ms firmware polling cadence makes duplicate dispatch unlikely.

## Product

- Measures six cognitive indicators: memory, comprehension, concentration, judgment, agility, endurance.
- Analyzes user's "Brainimal" type based on cognitive profile.
- Provides customized training reports.
- Displays personal and organizational rankings.
- Offers enterprise insights for organizations.
- Supports cognitive training sessions with BLE hardware interaction.

## User preferences

_Populate as you build_

## Gotchas

- **Shared Package Builds:** Always run `cd shared && npm run build` before building the client or server to ensure the latest shared types are available.
- **BLE Write Serialization (Legacy Mode):** In legacy BLE mode, multiple rapid writes to the characteristic are serialized on the client-side (50ms gap) and native-side (30ms gap) to prevent firmware from dropping frames due to concurrent GATT writes.
- **Admin Password in Production:** `ADMIN_PASSWORD` must be explicitly set in production for seeding admin credentials; otherwise, seeding is skipped.
- **NoiPod vs. NINA-B1 Firmware:** The `legacyBleMode` toggle is critical for correct BLE communication depending on the connected hardware. Ensure it's set appropriately or verified on the Device screen.

## Pointers

- [React 18 Documentation](https://react.dev/blog/2022/03/29/react-v18)
- [Vite Documentation](https://vitejs.dev/guide/)
- [Express.js Documentation](https://expressjs.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Framer Motion Documentation](https://www.framer.com/motion/)
- [React Router v6 Documentation](https://reactrouter.com/en/v6)
- [Node.js Documentation](https://nodejs.org/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [JWT (JSON Web Tokens) Introduction](https://jwt.io/introduction/)
- [bcrypt.js GitHub](https://github.com/dcodeIO/bcrypt.js)