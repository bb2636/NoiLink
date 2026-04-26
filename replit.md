# NoiLink - 뇌지컬 트레이닝

A mobile-optimized web application for cognitive ability training and analysis.

## Overview

NoiLink measures six cognitive indicators (memory, comprehension, concentration, judgment, agility, endurance), analyzes the user's "Brainimal" (Brain + Animal) type, and provides customized training reports.

## Architecture

This is an **npm monorepo** with three workspaces:

- `client/` — React 18 + Vite frontend (port 5000)
- `server/` — Express.js backend API (port 3001)
- `shared/` — Shared TypeScript types

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

## Result Comparison Card (Task #112 → Task #114)

- 결과 화면(`client/src/pages/Result.tsx`) 의 "직전 vs 오늘" 비교 카드 + 코칭 메시지는
  `previousScore` 가 확정됐을 때만 노출된다 — 임시 폴백(`todayScore - 12`) 은
  Task #113 에서 제거됨.
- 우선순위:
  1. `navigate state.previousScore` (정상 완료 직후 흐름) → 그대로 사용.
  2. 그 외(=기록에서 재진입) → `GET /api/metrics/session/:sessionId/previous-score`
     를 useEffect 로 호출해 서버에서 받아온 값 사용 (Task #114 — 단건 엔드포인트).
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
- 회귀 테스트:
  - `server/routes/metrics.test.ts` — 모드/형식/유효/시간/권한 규칙 (Task #114),
    KST 표시용 날짜·자정 경계 (Task #132).
  - `client/src/pages/Result.test.tsx` — 재진입/첫 세션/state 우선/응답 전 숨김,
    KST 표시용 라벨/자정 경계 (Task #132).
  - `shared/kst-date.test.ts` — `isoToKstLocalDate` 자정/월/연 경계.

## Deployment

- Target: autoscale
- Build: `npm run build` (builds shared → client → server)
- Run: `cd server && npm start` (serves built Express app + static client files)
- Server auto-detects built vs dev mode for correct `client/dist` path resolution
