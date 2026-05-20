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
- `DATABASE_URL`: PostgreSQL connection string. **Also required for `server` workspace test runs** — `server/db/repositories/integration.test.ts` provisions an isolated `noilink_test_<pid>_<ts>` schema against this DB and runs `schema.sql` as the regression guard for repository contracts. If unset, the suite registers an explicitly **failing** top-level `it` (not a silent skip) so external CI (GitHub Actions etc.) cannot report a green build with zero coverage of repository round-trips (Task #160).
- `ALLOW_SKIP_DB_INTEGRATION_TESTS=1`: Opt-out for environments that genuinely have no Postgres available. Set explicitly to convert the repository integration suite from "fail" to "skip". Default is fail-loud — do not set this in any CI that is expected to validate DB repositories.

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
- **펌웨어 LED 색상 코드 정렬 (2026-05-19, 라이브 검증):** `encodeLegacyLedFrame` 의 두 번째 바이트는 **pod 인덱스가 아니라 색상 코드** 다. NINA-B1-FB55CE 펌웨어 실측: `0x01=R, 0x02=B, 0x03=G, 0x04=R+B(보라), 0x05=R+G(노랑), 0x06=B+G(하늘), 0x07=R+B+G(흰), 0x08=OFF`. 단일 LED 라 `pod` 인자는 받지 않고 — 멀티 기기 시나리오는 BLE 연결 자체를 기기별로 분리해 동일 프레임을 라우팅하는 별도 작업으로 분리. 과거 `pod+1` 을 색 자리에 넣던 구현은 1..4 가 색 값으로도 우연히 유효해 점등은 됐지만 의도색과 무관했다 (예: GREEN 점등 요청 → BLUE 점등). `COLOR_CODE` 정의(`shared/ble-protocol.ts`)도 같이 갱신 — 과거 `GREEN=0, OFF=0xFF` 가 `GREEN=0x03, OFF=0x08` 로 바뀌어 NoiPod 정식 12바이트 골든 벡터도 같이 정렬. 펌웨어 송신 조건(누락시 무반응): **(1) Notifications enabled (CCCD 활성화)** + **(2) Write Without Response** — `bleWriteCharacteristic('write', b64, 'withoutResponse')` 와 `monitorCharacteristicForService` 가 이미 보장. `bleWriteLed` 의 OFF 분기도 "송신 생략" 에서 "명시적 0x08 송신" 으로 변경 — 단일 LED 라 OFF 명령을 보내지 않으면 직전 색이 잔존한다. 회귀 가드: `shared/ble-protocol.test.ts` `encodeLegacyLedFrame` 골든 (RED/BLUE/GREEN/YELLOW/WHITE/OFF 1~8 + RangeError + 길이 3).
- **Task #155 — 6모드 정합성 점검 결과 (5개 항목 traceability):**
  1. **LED 1~8 매핑** (encodeLegacyLedFrame): 위 "펌웨어 LED 색상 코드 정렬" 항목으로 대체 — 2026-05-19 라이브 검증으로 시그니처가 `{ colorCode }` 로 바뀌었고 골든 테스트도 색상 6종 + OFF + RangeError 로 갱신됐다.
  2. **COMPREHENSION 카운터** (cNoMixedUntilTicks/cSwitchCount/flashAll WHITE): `client/src/training/engine.test.ts` 에 3건 신규 테스트 추가 (전환 직후 카운터 셋팅·자연 감소·상한, RED 풀 제외 효과, flashAll(WHITE,250) podCount 만큼 송신).
  3. **COMPOSITE Early/Mid/Late 경계 정렬**: `engine.ts` 의 0.34/0.66 근사 → 1/3·2/3 으로 교체 (아래 "ENDURANCE Early/Mid/Late 경계 정렬" 항목 참조).
  4. **ENDURANCE 산식 동기화**: server/spec 분기는 의도된 운영 결정 (아래 "ENDURANCE 점수 산식 — server vs spec 분기" 항목) — 명세 가중치 골든 케이스를 `shared/training-spec.test.ts` 에 codify, Task #156 으로 follow-up.
  5. **JUDGMENT 더블탭 윈도우** (judgmentDoubleTapWindowMs): `shared/training-spec.test.ts` L237~250 기존 BPM 60/70/120/140 + Task #155-tagged 보강 4건 (BPM 40 하한, 77 전환점, 78 산식, 200 상한).
- **ENDURANCE Early/Mid/Late 경계 정렬 (Task #155):** `engine.ts` 의 `recordIntervalCount`/`recordIntervalHit`/구간 omission 누적은 `earlyMidLateBucket(elapsedMs)` 로 일원화 — 경계가 `total/3`, `total*2/3` (300s 세션 기준 100s/200s) 로 정렬돼 `shared/training-spec.ts` 의 `ENDURANCE_EARLY_END_MS=100_000` / `ENDURANCE_LATE_START_MS=200_000` 와 정확히 일치한다. 과거 `0.34/0.66` 근사는 102s/198s 로 어긋나 100~102s 입력이 Mid 가 아닌 Early 로, 198~200s 입력이 Late 가 아닌 Mid 로 잘못 누적되어 `maintainRatio = lateScore/earlyScore` 가 미세하게 비뚤어졌다. 회귀 가드: `engine.test.ts` "Early/Mid/Late 버킷 경계는 1/3·2/3 으로 정렬된다".
- **ENDURANCE 점수 산식 — server vs spec 분기 (의도된):** `shared/training-spec.ts` 의 `scoreEndurance()` 는 명세 가중치 `40*maintainRatio + 20*(1-Drift) + 15*(1-omissionInc) + 15*lateStability + 10*lateSpeed` (Late 표본 부족시 Early-only 재정규화) 를 정의하지만, 실제 운영 점수 계산은 `server/services/score-calculator.ts` `calculateEnduranceScore` 가 NormConfig 기반 Z-score 정규화(maintainRatio Z-score 80 + rhythmAccuracy 20) 로 수행한다. 이는 다른 5개 지표(memory/comprehension/focus/judgment/agility) 가 모두 동일한 Z-score 통합 정규화 경로를 쓰기 때문에 ENDURANCE 만 다른 산식을 쓰면 지표간 분포가 어긋난다는 운영 결정에서 비롯됐다. 명세 산식 채택은 6지표 일괄 정규화 재설계가 선행돼야 하므로 별도 Task 로 분리. `scoreEndurance()` 헬퍼는 단위 테스트와 향후 산식 마이그레이션의 참조로 유지한다.
- **서비스/라우트 KV → Repository 리팩토링 (Task #158):** Task #157 에서 깐 정규화 테이블 인프라 위에, `server/services/` 와 `server/routes/` 의 대부분 `db.get(<collection>)` whole-load 호출을 `server/db/repositories/*.ts` 의 단일 entity 헬퍼(`findUserById`, `listSessions({userId, sinceCreatedAt})`, `findOrganizationById`, `findPasswordByUserId/Email`, `insertInquiry/listInquiries/deleteInquiriesByUser`, `deleteSessionsByUser/deleteMetricsByUser/deleteRawMetricsByUser/deleteReportsByUser/deleteDailyConditionsByUser/deleteDailyMissionsByUser`, `insertBleAbortEvent/insertAckBannerEvent`, `findLatestReportByUser`, `listUsersByIds/listUsersByOrganization/listAllUsers/listUsersByType/upsertUser/softDeleteUser`, `listOrganizations/upsertOrganization`, …) 호출로 교체. KV 통째 로딩 회귀(기관 리포트 한 번에 전체 사용자/세션 역직렬화)가 사라져 응답 지연이 SQL `WHERE`/인덱스로 떨어지고 Node 메모리 폭주가 차단된다. 기존 `IDatabase.get/set/list` 어댑터는 `idempotency` / `normConfig` / `migrations` / 레거시 `scores` · `games` 통계 / `rankings`(clear-only) / OTP · reset-token / `Postgres 미사용 호환 fallback` 같은 진짜 KV 용도에만 남는다. Repository 함수들은 `isPostgresBackend()` 분기로 KV 폴백을 그대로 지원해 Postgres 외 환경에서도 회귀 없이 동작. **Phase B (이전 세션)**: `middleware/auth`, `routes/{terms,reports,home,sessions,metrics,rankings}`, `services/{personal-report,organization-insight-report}`. **Phase C (이번 세션)**: `routes/scores.ts` (전체 재작성 — KV `scores` 컬렉션은 레거시로 유지), `routes/admin.ts` (dashboard/users/organizations/sessions/recovery-stats/reset-training-data — `listAllUsers/listUsersByType/listOrganizations/listSessions/countAll*/deleteAll*/upsertUser/listAllRawMetrics` 사용), `routes/auth.ts` (naver/kakao callbacks + naver withdraw — `findUserBySocial/Email/Username/Phone`, `upsertUser`, `findUserById`), `routes/users.ts` (전체 가입/로그인/me/cascade 탈퇴/조직 가입·승인·반려/비밀번호 재설정/문의/조직 멤버/통계 — 모든 path 정규화 entity 호출로 전환, 새 `findUserByPhone` repo 헬퍼 추가). **Drift / 의도된 KV 잔존:** (1) `/api/users/:userId/stats` 의 `scores`/`games` 는 현재 미사용 레거시라 KV 유지, (2) `routes/admin.ts` 의 reset-training-data 가 `rankings` KV 컬렉션을 clear-only 로 비우는 호출은 그대로 — rankings 는 read 시 매번 계산되는 derived view 라 정규화 우선순위 낮음, (3) `cascadeDeleteUser` 의 합성/composite 세션 cleanup 은 `participantIds`-only 참여 기록을 정리하지 않음 (rare-path drift, follow-up 으로 sessions repo 에 `deleteCompositeParticipantByUser` 추가 권장), (4) `seed-admin.ts` 는 부팅 1회성 path 라 KV 그대로 두고 별도 follow-up 으로 분리. **`GET /api/reports/:reportId` 인가 회귀 가드 (코드 리뷰 follow-up)**: 초기 Phase C 구현은 본인 리포트 100개 + ADMIN 만 다른 사용자 리포트 검색이라 같은 조직 매니저가 부하 사용자 리포트를 id 로 직접 못 여는 회귀가 있었다. `reports` repo 에 인덱싱된 `findReportById(reportId)` (PK 단일조회 + KV 폴백) 헬퍼를 추가해, 라우트는 id 로 먼저 가져온 뒤 `userCanActOnTargetUserId` 로 인가 검사 — 본인 / ADMIN / 같은 조직 매니저 모두 기존처럼 접근 가능, 100개 윈도우 한계도 사라짐. **Repository envelope 변경 가드**: events 정규화 테이블(`ble_abort_events` / `ack_banner_events` / `inquiries`) 의 `insertEvent` 가 페이로드를 `(id, user_id, session_id, payload, created_at)` 으로 평탄화하면서 저장된 row 모양에 `id` + `createdAt` 가 추가됐다 — `routes/metrics.test.ts` 의 PII 화이트리스트 키 비교 두 건을 새 envelope 키 포함으로 갱신 (PII 누출 검증은 그대로 유지, `apiMode/bleUnstable/burstCount` 등 application 페이로드 키만 정확히 일치하는지 확인). **Postgres 정규화 스키마 인프라 (Task #157):** Postgres 어댑터 부팅 시 `server/db/schema.sql` 을 멱등 적용해 13개 정규화 테이블(`users`, `passwords`, `organizations`, `terms`, `sessions`, `metrics_scores`, `raw_metrics`, `rankings`, `reports`, `org_insight_reports`, `daily_conditions`, `daily_missions`, `ble_abort_events`, `ack_banner_events`, `inquiries`) + 기존 `kv_store` 를 함께 유지한다. 핵심 entity(users/sessions/passwords/organizations/terms) 는 컬럼으로 평탄화, 부가 entity 는 식별 컬럼 + `payload JSONB` 패턴. Repository 계층은 `server/db/repositories/*.ts` (users/sessions/metrics-scores/raw-metrics/passwords/organizations/reports/rankings/daily/events/terms) 에 함수 단위로 모여 있으며 `db.getPool()` 을 통해 pg `Pool` 에 안전 접근(Postgres 백엔드 외에서는 throw). KV → 정규화 테이블 데이터 이전은 `scripts/migrate-kv-to-normalized.mjs` 가 멱등으로 수행(원본 `kv_store` 는 idempotency/normConfig/migrations 보존 + 검증 안전망으로 남김). **운영 정책 (옵션 C):** 기존 `db.get('users')` 등 KV 호출은 손대지 않고 그대로 둔다 — 정규화 테이블은 (1) SQL 인스펙션, (2) 향후 서비스/라우트 그룹별 리팩토링 follow-up task 에서 단계적으로 전환할 때 사용. 따라서 `kv_store` 와 정규화 테이블이 일시적으로 병행 존재하며, 마이그레이션 스크립트는 단방향 dump 다 (서비스가 KV 를 계속 쓰는 동안에는 새 INSERT 가 정규화 테이블에 반영되지 않으므로, 리팩토링 전까지 SQL 인스펙션 결과는 최신 시점이 아닐 수 있음). server 빌드 시 `npm run build` 가 `dist/db/schema.sql` 로 복사 — tsx 개발 모드는 source 경로를 직접 읽음.
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