# NoiLink - 뇌지컬 트레이닝

A mobile-optimized web application for cognitive ability training and analysis.

## Overview

NoiLink measures six cognitive indicators (memory, comprehension, concentration, judgment, agility, endurance), analyzes the user's "Brainimal" (Brain + Animal) type, and provides customized training reports.

## Architecture

This is an **npm monorepo** with three workspaces:

- `client/` — React 18 + Vite frontend (port 5000)
- `server/` — Express.js backend API (port 3001)
- `shared/` — Shared TypeScript types

### `@noilink/shared` 는 ESM-only 패키지

- `shared/package.json` 은 `"type": "module"` 이며 `dist/*.js` 산출물은 ESM
  (`export *`, named exports). 모든 컨슈머(client, server, mobile)는 반드시
  `import` 로 사용한다 — `require('@noilink/shared')` 는 깨진다.
- 회귀 사례 (Apr 2026): `type` 필드가 빠진 적이 있었는데 그러면 Node 가
  dist 를 CJS 로 잘못 해석해서 `import { KST_TIME_ZONE } from '@noilink/shared'`
  같은 정적 named import 가 `does not provide an export named ...` 로 서버
  부팅 단계에서 즉사했다. 동적 `await import(...)` 와 vitest(Vite alias 로 ts
  소스를 직접 읽음) 에서는 잡히지 않아 묻혔던 사례.
- 회귀 방지: `scripts/post-merge.sh` 가 build 직후 `node --input-type=module -e`
  로 `KST_TIME_ZONE` / `COMPOSITE_TOTAL_MS` / `sanitizeRecoveryRawMetrics` 를
  정적 import 해보고 실패 시 머지 후 셋업이 실패한다.

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, React Router v6
- **Backend**: Node.js, Express.js, TypeScript (tsx)
- **Database**: Auto-selects: PostgreSQL (if DATABASE_URL set), Replit Database (if REPL_ID set), or local JSON fallback
- **Auth**: JWT tokens with bcryptjs password hashing

## Development

```bash
npm run dev        # Runs both frontend (port 5000) and backend (port 3001) concurrently
npm run build      # Build all workspaces (shared → client → server)
```

The shared package must be built before the client:
```bash
cd shared && npm run build
```

## Configuration

- Frontend proxies `/api` requests to `http://localhost:3001`
- Vite configured with `host: '0.0.0.0'`, `allowedHosts: true` for Replit proxy compatibility
- Backend port: 3001 (set via `PORT` env var)

## Environment Variables

- `JWT_SECRET` — Required in production. Auto-generated for dev.
- `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` — Admin seed credentials. In production, `ADMIN_PASSWORD` must be set or seeding is skipped.
- `DB_TYPE` — Explicit DB selection: `postgres`, `replit`, or `local`
- `DATABASE_URL` — PostgreSQL connection string

## Database

Auto-detection priority:
1. `DB_TYPE` env var explicitly set
2. `DATABASE_URL` → PostgreSQL
3. `REPLIT_DB_URL` or `REPL_ID` → Replit Database
4. Fallback → Local JSON file at `server/data/`

## Security

- Passwords hashed with bcryptjs (backward-compatible with legacy plaintext)
- JWT secret enforced via environment variable in production
- Auth middleware protects user update endpoints (self-or-admin only)
- x-user-id header bypass removed

## "나의 랭킹" 카드 단일 진실원

- `GET /api/rankings/user/:userId/card` (requireAuth + 본인/관리자/동일 조직 기업
  관리자) 가 카드의 4개 stat 을 한 번에 돌려준다 — `compositeScore` (없으면 null),
  `totalTimeHours`, `streakDays`, `attendanceRate`, 그리고 본인 등수 `myRanks`.
- 모두 랭킹표(`/api/rankings`) 와 동일한 14일 창 / 동일한 세션 데이터에서
  파생된다. 출석률·연속·dayKey 계산은 KST 기준 (`isoToKstLocalDate`).
- 회귀 보호: `server/routes/rankings.user-card.test.ts` (9 테스트). 카드가
  과거처럼 DEMO_PROFILE 하드코딩(80점/4시간/5일/90%) 으로 회귀하면 테스트와
  랭킹표 표시값이 즉시 갈라진다.

## Idempotency (training save retry safety)

- 결과 저장 라우트(`POST /api/sessions`, `POST /api/metrics/calculate`, `POST /api/metrics/raw`)는
  `Idempotency-Key` 헤더를 받으면 (scope, userId, key) 단위로 첫 응답을 캐시한다 (`server/utils/idempotency.ts`).
  같은 키가 두 번째로 들어오면 핸들러를 다시 실행하지 않고 캐시된 status/body 를 반환 → 네트워크 타임아웃
  재시도가 트레이닝을 두 번 저장하지 않는다. 캐시는 단일 KV 키(`idempotency`) 에 저장돼 모든 DB 백엔드에서 동일.
- 클라이언트는 `TrainingSessionPlay` 가 세션 시작 시 `createPendingLocalId()` 로 안정 키를 1회 발급해
  화면 내 자동/수동 재시도와 큐(pendingTrainingRuns) → background drain 까지 동일 키를 흘려보낸다.
  헤더 부착은 `api.createSession`/`api.calculateMetrics`/`api.saveRawMetrics` 의 옵션 인자.
- 회귀 테스트:
  - `client/src/utils/__tests__/submitTrainingRunRetry.test.ts` — `localId` 가 두 단계 모두에 같은
    idempotency 키로 흐르는지, 일시 실패 후 재시도에서도 키가 유지되는지.
  - `client/src/hooks/__tests__/drainPendingTrainingRuns.test.ts` — drain 시 큐의 `localId` 가 그대로 흐른다.

## Admin Account

Default admin: `admin@admin.com` / `admin1234` (dev only, skipped in production without `ADMIN_PASSWORD`)

## Hardware Protocol (NoiPod BLE)

- 정본 코드: `shared/ble-protocol.ts` (LED / SESSION / CONTROL / TOUCH 인코딩)
- LED 즉시 소등 컨벤션 (펌웨어 합의서): `docs/firmware/led-off-convention.md`
  - 색=0xFF 또는 onMs=0 → 펌웨어가 잔여 onMs 무시하고 LED 즉시 OFF
  - 펌웨어 측 구현·릴리스 노트 반영 필요 (별도 리포지토리)
- 바이트 레이아웃 회귀 테스트: `shared/ble-protocol.test.ts`
  - 실행: `npm test` (vitest). 인코더/디코더 변경 시 OFF 합의서의
    테스트 벡터가 깨지지 않는지 자동 검증된다.
- 엔진 LED 소등 흐름 회귀 테스트: `client/src/training/engine.test.ts`
  - `bleWriteLed`/`bleWriteControl`/`bleWriteSession` 모킹 후, 사용자가 onMs 안에
    탭하면 OFF 페이로드(`isLedOffPayload` 컨벤션, `mode='withResponse'`)가 송신되고
    `allOff`가 모든 점등 Pod에 OFF + CTRL_STOP 을 보내며 두 번째 호출에는
    멱등하게 동작함을 검증한다. (jsdom + vi.useFakeTimers)
  - `npm test` (root)는 shared → client 순으로 vitest 를 실행한다.
- BLE 단절 안내 토스트 임계값 튜닝 가이드: `docs/operations/ble-stability-threshold-tuning.md`
  - `shared/ble-stability-config.ts` 의 기본값을 그대로 둘지, 모델별 오버라이드를
    등록할지에 대한 분석 절차·결정 규칙·1차 결정(2026-04 기준 기본값 유지) 기록.
- BLE 자동 종료 운영 텔레메트리: `docs/operations/ble-abort-telemetry.md`
  - `finalizeAndAbort('ble-disconnect')` 시점에 클라이언트가 `POST /api/metrics/ble-abort`
    로 익명 회복 통계(`windows`, `totalMs`, `bleUnstable`)를 fire-and-forget 보고.
  - 서버는 `bleAbortEvents` JSONB 배열에 append + 한 줄 콘솔 로그 (PII 없음).
  - 운영 조회는 `kv_store` JSONB 단일 SQL 쿼리로 "지난 7일 환경 점검 안내 비율" 산출.
- ack 거부 토스트 burst 텔레메트리: `docs/operations/ack-banner-telemetry.md`
  - `subscribeAckErrorBanner` 가 burst(연속 거부 묶음) 가 끝나는 시점마다
    `POST /api/metrics/ack-banner` 로 익명 통계 fire-and-forget 보고.
  - 페이로드: `reason` (`auto-dismiss`/`user-dismiss`/`unmount`), `burstCount`, `burstDurationMs`.
  - 서버는 `ackBannerEvents` JSONB 배열에 append + `[ack-banner]` 한 줄 콘솔 로그.
  - `ACK_ERROR_AUTO_DISMISS_MS`(현재 5초) 임계값 튜닝의 운영 데이터 근거.

## Remote Config (BLE Stability Thresholds — Task #48)

- 서버: `GET /api/config/ble-stability` 가 `BLE_STABILITY_REMOTE_CONFIG` 환경 변수의 JSON 을
  그대로 내려준다. 미설정/파싱 실패 → `{ rules: [] }` 빈 설정.
- 클라이언트: `client/src/main.tsx` 부트스트랩에서 `loadBleStabilityRemoteConfig()` 가
  응답을 `makeBleStabilityResolverFromRemoteConfig()` 로 변환해
  `setBleStabilityOverrideResolver()` 에 등록한다. 응답이 비어 있으면
  기본값(`DEFAULT_BLE_STABILITY_*`) 이 그대로 쓰인다.
- 응답 스키마: `BleStabilityRemoteConfig { rules?: { match?, thresholds }[]; default? }` —
  자세한 의미와 회귀 테스트는 `shared/ble-stability-config.ts` /
  `shared/ble-stability-config.test.ts` 와
  `client/src/utils/__tests__/bleStabilityRemoteConfig.test.ts`.
- 운영 튜닝: 환경 변수만 갱신하면 앱 재배포 없이 모델/사용자별 임계값 A/B 가능.

## Bridge Reject Toast (Task #77)

- 모바일 디스패처/웹 수신기는 잘못된 web→native 메시지를 거부할 때
  `${type}:${reason}@${field}: ${message}` 형식의 사유를 `native.ack.payload.error` 에 싣는다.
- 클라이언트는 `client/src/native/nativeAckErrors.ts` 의
  `subscribeNativeAckErrors()` / `formatAckErrorForBanner()` 로 사유를 파싱해
  한국어 안내(예: "내부 오류: ble.connect의 deviceId 누락") + 디버그 키
  (`type:reason@field`) 를 SuccessBanner 에 띄운다.
- 적용 화면: `client/src/pages/Device.tsx`, `client/src/pages/DeviceAdd.tsx`,
  `client/src/pages/TrainingSessionPlay.tsx`.
- 자유 문자열(`BleManagerError.message`, `version-mismatch` 등)은 디버그 키 없이
  원문을 그대로 노출해 정보 손실이 없도록 한다.
- 회귀 테스트: `client/src/native/__tests__/nativeAckErrors.test.ts`.

## Result Comparison Card (Task #112 → Task #114 → Task #122)

- 결과 화면(`client/src/pages/Result.tsx`) 의 "직전 vs 오늘" 비교 카드 + 코칭 메시지는
  `previousScore` 가 확정됐을 때만 노출된다 — 임시 폴백(`todayScore - 12`) 은
  Task #113 에서 제거됨.
- 두 진입 경로 모두 같은 단건 엔드포인트(`/metrics/session/:sessionId/previous-score`)
  하나의 진실원에 묶인다 (Task #122).
- 우선순위:
  1. `navigate state.previousScore` (정상 완료 직후 흐름) → 그대로 사용.
     `client/src/utils/submitTrainingRun.ts` 가 `includePreviousScore: true`
     일 때 `calculateMetrics` 와 단건 엔드포인트를 `Promise.all` 로 병렬 호출해
     결과 객체에 `previousScore`/`previousScoreCreatedAt` 를 함께 담아 돌려준다.
     `TrainingSessionPlay.tsx` 는 그 값을 그대로 navigate state 로 흘려보낸다 —
     별도의 페이징 이력 호출(`/sessions/user/:userId?limit=50`) 은 하지 않는다.
  2. 그 외(=기록에서 재진입) → 같은 단건 엔드포인트를 `Result.tsx` 가 useEffect
     로 호출해 서버 값 사용.
  3. 서버가 `previousScore: null` 을 돌려주면(첫 세션) 비교 카드와 "직전 대비"
     코칭 문구를 모두 숨겨 가짜 차이 노출을 막는다.
- 서버 엔드포인트(`server/routes/metrics.ts`): 같은 `userId` + 같은 `mode` +
  같은 `isComposite` 의 세션 중 `isValid===true` & `score: number` & `createdAt`
  이 target 보다 엄격히 이전인 가장 최근 1건의 score 를 돌려준다. 없으면 null.
- 비교 카드의 직전 날짜 라벨(Task #123 → Task #132): 응답에 `previousScoreCreatedAt`
  (ISO) 과 함께 KST(`Asia/Seoul`) 기준 표시용 날짜 `previousScoreLocalDate`
  (`YYYY-MM-DD`) 와 `timeZone` 도 한 쌍으로 내려준다. 클라이언트는 표시용 날짜를
  우선 사용해 라벨이 디바이스 시간대로 흔들리지 않게 한다(자정 경계 회귀 보호).
  같은 KST 헬퍼(`shared/kst-date.ts` 의 `isoToKstLocalDate`) 를 정상 완료 흐름
  (`TrainingSessionPlay`) 에서도 사용해 두 흐름의 라벨이 정확히 일치한다.
- 홈 "주간 출석 도장" 7칸(Task #144): `useUserStats` 의 `checkedDays` 도 같은
  KST 헬퍼 위에 쌓아 디바이스 시간대 영향을 받지 않게 잠갔다. `shared/kst-date.ts`
  에 추가한 `kstStartOfWeekMonYmd` / `kstYmdDiffDays` / `kstWeekdayMon0FromYmd` 가
  단일 출처. 자정 직전(KST) 에 끝낸 세션이 UTC 디바이스에서도 같은 KST 요일
  칸을 채우고, 지난 주 일요일(KST) 세션이 새 주에 잘못 흘러들어가지 않는다.
- 회귀 테스트:
  - `server/routes/metrics.test.ts` — 모드/형식/유효/시간/권한 규칙 (Task #114),
    KST 표시용 날짜·자정 경계 (Task #132).
  - `client/src/pages/Result.test.tsx` — 재진입/첫 세션/state 우선/응답 전 숨김,
    KST 표시용 라벨/자정 경계 (Task #132).
  - `shared/kst-date.test.ts` — `isoToKstLocalDate` 자정/월/연 경계 (Task #132),
    `kstStartOfWeekMonYmd` / `kstYmdDiffDays` / `kstWeekdayMon0FromYmd` 의 주 시작·
    요일 인덱스·일수 차이 (Task #144).
  - `client/src/utils/__tests__/submitTrainingRunRetry.test.ts` —
    `includePreviousScore` 플래그의 호출/병렬/실패 폴백/생략 정책 (Task #122)
    및 `previousScoreLocalDate` 전파 (Task #132 ← Task #122).
  - `client/src/pages/TrainingSessionPlay.test.tsx` — 정상 완료 흐름이 submit
    결과의 직전 점수/표시용 날짜를 navigate state 로 흘리고, 페이징 이력 호출
    로 회귀하지 않음을 잠근다 (Task #122 / Task #132 자정 경계 회귀 보호).
  - `client/src/hooks/__tests__/useUserStats.weeklyAttendance.test.ts` — UTC 디바이스
    시뮬레이션(`process.env.TZ='UTC'`) 하에서 `checkedDays` 가 KST 요일 칸에 떨어지는지
    (Task #144).

## BLE 펌웨어 모드 — 현행 NINA-B1 vs 차세대 NoiPod

사용자 기기(NINA-B1-FB55CE)는 단순 펌웨어를 사용한다. 차세대 NoiPod 정식
사양(0xA5 12B SYNC 프레임)과 별개이므로 **`legacyBleMode` 토글**로 분기한다.

- **현행(레거시) 모드 — 기본값 ON**
  - 송신: 점등 `4E XX 0D` (3B, XX = 1<<pod), START `AA 55`, STOP `FF`
  - 수신: 5B IR 패킷 `[hi][lo][touchCount][0D][0A]` (200ms 간격) 또는
    NFC NDEF Text Record `D1 01 ?? 54 [status] [lang...] [text...]`
  - 인코더: `encodeLegacyLedFrame` / `encodeLegacyControlStartFrame` /
    `encodeLegacyControlStopFrame` (`shared/ble-protocol.ts`)
  - 디코더: `tryParseLegacyIrBytes` / `tryParseLegacyNdefTextBytes` /
    `tryParseAnyNotifyBytes` (TOUCH→IR→NDEF 분류기). base64 entry point 도 동일.
- **차세대 NoiPod 모드 — 토글 OFF 시**
  - 송신: 0xA5 12B LED/SESSION/CONTROL 프레임 (`encodeLedFrame` 등)
  - 수신: 11B TOUCH 프레임 (`tryParseTouchBytes`)
- **토글 위치**: Device 화면 카드. 변경 즉시 `bleWriteLed/bleWriteControl`
  분기와 진단 로그가 모드 전환된다.
- **마이그레이션 (m1.cleanForcedOff)**: 어제 빌드의 강제 OFF useEffect 가
  storage 에 `'0'` 을 박아둔 사용자가 있다. `getLegacyBleMode()` 첫 호출 시
  마이그레이션 키가 없으면 잔여 `'0'` 을 1회 청소해서 기본값(ON)으로 복귀시킨다.
  사용자가 그 후 OFF 를 명시적으로 누른 결과(`'0'`)는 마이그레이션 키 존재로
  보호된다 (`client/src/native/legacyBleMode.ts`,
  `client/src/native/__tests__/legacyBleMode.test.ts`).
- **Device 진단 notify 구독**: 화면에 머무는 동안 `device-diag-*` subId 로
  notify 구독 → 분류기로 디코드 → 진단 로그에 표시. 다른 구독 스트림 오염
  방지를 위해 `payload.subscriptionId === subId && payload.key === 'notify'`
  로 필터. IR 패킷은 throttle (count 변화 즉시 / distance 1.5초당 1회).
- **레거시 write 직렬화 큐** (`client/src/native/bleBridge.ts`): 트레이닝 엔진이
  같은 JS turn 에서 여러 LED/CONTROL 프레임을 post 하면 (`flashAll`,
  `lightTwoPods`, MEMORY RECALL, START 중복 송신 등), native shell 의
  `dispatchWebMessage` 가 메시지마다 별도 promise 로 처리해 ble-plx GATT 큐가
  동시 N 개 write 를 받게 된다. NUS 계열 펌웨어는 `withoutResponse` 동시
  폭주를 못 따라가서 일부 write 가 'operation was cancelled' 로 drop 되거나
  펌웨어가 LED 출력을 통째로 무시한다 (증상: 진단 송신 카운터는 올라가는데
  본체 LED 변화 없음). `enqueueLegacyWrite` 가 레거시 분기의
  `bleWriteCharacteristic` 호출을 50ms 간격으로 흩뿌려 직렬화한다. 첫 호출은
  마지막 송신 이후 50ms 가 지나 있으면 즉시 실행, 아니면 남은 시간만큼만
  대기. STOP 은 `enqueueLegacyWritePriority` 로 펜딩 LED 큐를 비우고 즉시
  송신해 일시정지/취소 시 본체가 한 박자 더 깜박이지 않게 한다.
  `getLegacyEmittedCount`/`getLegacyLastEmittedFrameHex`/`resetLegacyEmittedDiag`
  를 export 해 트레이닝 화면이 "엔진 onPodStates 콜백 횟수" 와 "큐가 native
  bridge 로 실제 송신한 횟수/직전 frame hex" 를 분리해 노출한다 — 두 값이
  같이 올라가는데 본체 LED 만 안 바뀌면 펌웨어/하드웨어, 큐 카운터만 멈추면
  큐 자체 문제로 좁힐 수 있다.
- **MEMORY SHOW 첫 점등 마진** (`client/src/training/engine.ts`): MEMORY 모드의
  SHOW 시퀀스 첫 LED 는 `FIRST_TICK_DELAY_MS=500` 만큼 늦게 발사한다. 다른
  모드의 `fireTick` 첫 호출 마진(handleTestBlink 의 START→sleep(500)→LED 와
  같은 정책) 과 일치시켜 NUS 펌웨어가 START(`aa 55`) 를 처리하는 동안 들어온
  LED 프레임을 잃어버리지 않게 한다.
- **Native-side write 직렬화** (`mobile/src/ble/BleManager.ts`):
  `WebAppWebView.onMessage` 가 매 메시지마다 `void dispatchWebMessage(...)` 로
  fire-and-forget 호출하고 dispatcher 가 각 메시지를 독립 promise chain 으로
  처리하기 때문에, JS 의 `enqueueLegacyWrite` 가 50ms 간격으로 N 개 postMessage
  를 띄워도 native 측에는 N 개의 `writeCharacteristic` 호출이 동시 in-flight 가
  된다. ble-plx 의 `writeCharacteristicWithoutResponseForService` 는 OS GATT 큐에
  enqueue 하고 즉시 리턴하므로 NUS 펌웨어가 동시 폭주 frame 일부를 silent drop
  한다(증상: JS/native 카운터는 올라가는데 본체 LED 미점등). `writeChain`
  (Promise chain mutex) 으로 모든 write 호출을 직렬로 묶고, 직전 write 종료 후
  `WRITE_GAP_MS=30` 만큼 갭을 둬서 펌웨어가 frame 을 처리할 시간을 확보한다.
  handleTestBlink 가 1초 sleep 으로 자연 직렬화하던 것과 같은 효과를 트레이닝
  포함 모든 write 경로에 일괄 적용. 한 write 실패가 이후 write 를 막지 않도록
  `writeChain` 은 catch 로 흡수하고, public promise 만 reject 한다.

## 점등-전용 트레이닝 (현재 펌웨어 한정)

NINA-B1-FB55CE 펌웨어는 IR/TOUCH 입력의 정확도/안정성이 채점에 필요한
수준에 미치지 못해, 앱은 입력을 일체 받지 않고 점등 신호만 BPM 타이밍에
맞춰 자동 송신한다. 트레이닝 시작 시 모든 흐름이 점등-전용 화면으로
진입하고, 결과 화면도 점수 대신 단순 "완료"만 표시한다.

- **TrainingEngine.pause()/resume()** (`client/src/training/engine.ts`)
  - `pause()`: 회복 윈도우 마감 + `allOff()` + RAF/setTimeout/회복 grace 모두
    cancel + `bleWriteControl(CTRL_STOP)` + `pausedAt`/`isPaused=true` 기록.
  - `resume()`: `dt = Date.now() - pausedAt` 만큼 시간 기준점들
    (`startedAt`, `currentPhaseStartedAt`, `memoryRecallStartedAt`,
    `memoryLastTapAt`, `switchedAt`, `lastTapAt.ts`) 을 일제히 +dt 보정 →
    `bleWriteControl(CTRL_START)` 재송신 → `startElapsedRaf()` 재시작 →
    남은 phase 시간만큼 `currentTickFire` 를 setTimeout 으로 다시 예약.
    남은 시간이 0 이하이면 즉시 `currentPhaseOnEnd()` 호출.
  - 회귀 테스트: `client/src/training/engine.pauseResume.test.ts` (6 통과).
- **TrainingBlinkPlay.tsx** (`client/src/pages/TrainingBlinkPlay.tsx`)
  - 입력 무시: `handleTap`/`handleBleTouch`/`PodGrid` 전부 미사용. 들어오는
    notify 데이터는 처리하지 않는다.
  - **RX-keepalive notify 구독**: 점등-전용이라도 마운트 동안
    `bleSubscribeCharacteristic('notify')` 를 한 번 등록한다. 근거: NINA-B1
    NUS 펌웨어는 TX(notify) CCCD 가 활성 구독 상태일 때만 RX(write) 로
    들어온 LED frame 을 처리한다. Device 화면(`testBlink`)이 작동하는
    이유는 그 화면이 마운트 동안 notify 를 구독하기 때문이고, 구독 없는
    트레이닝 화면 진입 시 펌웨어가 LED frame 을 silent 무시하던 증상을
    이 한 줄로 해결한다 (실제 데이터는 사용하지 않음).
  - UI: 헤더 + BPM 카드 (라임 테두리) + 원형 SVG progress (라임 stroke,
    중앙 총 시간/경과 mm:ss) + 하단 취소(회색)/일시정지·재개(오렌지).
  - BLE 단절 회복 그레이스 (8s) 정책은 기존 `TrainingSessionPlay` 와 동일.
  - 자연 종료 시 `navigate('/result', { state: { blinkOnly: true, title } })`.
  - 회귀 테스트: `client/src/pages/TrainingBlinkPlay.test.tsx` (7 통과).
- **Result.tsx — blinkOnly 분기**: `state.blinkOnly === true` 면 점수/회복/
  비교/부분-결과 카드를 모두 숨기고 단순 "트레이닝 완료" + 확인 버튼만
  렌더한다. 회귀 테스트: `Result.test.tsx` 의 "점등-전용 완료 분기"
  describe (2 통과).
- **라우팅**:
  - 신규: `/training/blink-session` → `<TrainingBlinkPlay />`. `TrainingSetup`
    이 모든 트레이닝을 이 라우트로 보낸다.
  - 보존: `/training/session` → `<TrainingSessionPlay />`. 향후 펌웨어가
    입력 모드를 지원하면 `TrainingSetup` 의 navigate 한 줄만 바꿔 복귀할
    수 있도록 화면/테스트를 그대로 유지한다.

## Deployment

- Target: autoscale
- Build: `npm run build` (builds shared → client → server)
- Run: `cd server && npm start` (serves built Express app + static client files)
- Server auto-detects built vs dev mode for correct `client/dist` path resolution
