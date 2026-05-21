# NoiLink - 뇌지컬 트레이닝

A mobile-optimized web application for cognitive ability training and analysis, analyzing "Brainimal" type and providing customized reports.

## Run & Operate

```bash
npm run dev        # frontend (5000) + backend (3001) concurrently
npm run build      # shared → client → server
cd shared && npm run build  # must run before client/server build
```

**Required Environment Variables:**
- `JWT_SECRET`: Required in production.
- `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`: Admin seed credentials. `ADMIN_PASSWORD` required for seeding in production.
- `DB_TYPE`: Explicitly selects DB (`postgres`, `replit`, or `local`).
- `DATABASE_URL`: PostgreSQL connection string. **Also required for `server` workspace test runs** — `server/db/repositories/integration.test.ts` provisions an isolated `noilink_test_<pid>_<ts>` schema against this DB and runs `schema.sql` as the regression guard for repository contracts. If unset, the suite registers an explicitly **failing** top-level `it` (not a silent skip) so external CI cannot report a green build with zero coverage of repository round-trips (Task #160).
- `ALLOW_SKIP_DB_INTEGRATION_TESTS=1`: Opt-out for environments that genuinely have no Postgres available. Default is fail-loud.

**Database Auto-detection:** `DB_TYPE` → `DATABASE_URL` (Postgres) → `REPLIT_DB_URL`/`REPL_ID` (Replit DB) → Local JSON at `server/data/`.

## Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, Framer Motion, React Router v6
- **Backend:** Node.js, Express.js, TypeScript (tsx)
- **Database:** PostgreSQL / Replit Database / Local JSON fallback
- **Auth:** JWT tokens, bcryptjs

## Where things live

- `client/`: React frontend.
- `server/`: Express API.
- `server/db/repositories/`: 정규화 테이블 단일 entity 헬퍼 (users/sessions/passwords/organizations/terms/reports/rankings/daily/events 등). 모든 서비스/라우트는 여기를 거친다.
- `server/db/schema.sql`: Postgres 정규화 스키마 — 부팅 시 멱등 적용. `npm run build` 가 `dist/db/schema.sql` 로 복사.
- `shared/`: ESM-only 타입·유틸.
- `shared/ble-protocol.ts`: BLE 하드웨어 프로토콜 (LED/SESSION/CONTROL/TOUCH 인코딩) 단일 출처.
- `shared/ble-stability-config.ts`: BLE 안정성 원격 구성.
- `shared/kst-date.ts`: 출석·랭킹용 KST 날짜 유틸.
- `docs/architecture/training-engine.md`: 트레이닝 엔진 결정 사항 + 회귀 이력 (BLE 파서, MEMORY/MULTITASKING/ENDURANCE, LED 색상 코드, Task #155 등).
- `docs/architecture/db-refactor.md`: KV → 정규화 Postgres 리팩토링 이력 (Task #157/#158, 의도된 KV 잔존, UNIQUE 인덱스).
- `docs/firmware/led-off-convention.md`: 펌웨어 LED 즉시 OFF 협약.
- `docs/operations/ble-stability-threshold-tuning.md`, `ble-abort-telemetry.md`, `ack-banner-telemetry.md`: 운영 가이드.

## Architecture decisions (live guards)

상세 회귀 이력과 근거는 `docs/architecture/` 의 파일을 참조. 여기는 현재 적용 중인 룰의 요약만.

### 데이터 계층
- **Postgres 정규화 스키마 + Repository 패턴 (Task #157/#158):** 13개 정규화 테이블(`users`/`passwords`/`organizations`/`terms`/`sessions`/`metrics_scores`/`raw_metrics`/`rankings`/`reports`/`org_insight_reports`/`daily_conditions`/`daily_missions`/`ble_abort_events`/`ack_banner_events`/`inquiries`) + 기존 `kv_store`. 서비스/라우트는 `server/db/repositories/*.ts` 헬퍼를 거치고, `db.get(<collection>)` 통째 로딩은 금지. KV 어댑터는 idempotency / normConfig / migrations / OTP·reset-token / banners / 레거시 scores·games / rankings clear-only / Postgres 미사용 환경 호환에만 남는다. 상세: `docs/architecture/db-refactor.md`.
- **사용자 중복 방지 partial unique index:** `users(email)` / `users(username)` 에 partial UNIQUE (값이 있을 때만 유일). 소셜 가입 등 NULL/빈 문자열은 허용. seed-admin 재시드 race 가 만든 중복 row 회귀를 차단. 프로덕션 배포 시 기존 중복 row 가 있으면 인덱스 생성이 실패하므로 사전 정리 필요.
- **Idempotent Training Session Saves:** `POST /api/sessions`, `POST /api/metrics/calculate`, `POST /api/metrics/raw` 가 `Idempotency-Key` 헤더 지원 — 네트워크 재시도 시 중복 저장 방지. 클라가 안정적 `localId` 를 생성.
- **Unified Ranking Source:** `/api/rankings/user/:userId/card` 의 4개 통계(compositeScore/totalTimeHours/streakDays/attendanceRate) 모두 메인 랭킹 테이블(`/api/rankings`) 과 동일한 14일 윈도우·세션 데이터에서 파생.
- **KST-based Date Consistency:** 결과 비교·출석·랭킹의 모든 날짜 계산은 `shared/kst-date.ts` 의 KST 헬퍼 — 클라 디바이스 timezone 과 무관하게 일관.
- **ESM-only Shared Package:** `@noilink/shared` 는 `"type": "module"` ESM 전용. `post-merge.sh` 가 검증.

### BLE / 트레이닝 엔진 (상세: `docs/architecture/training-engine.md`)
- **BLE Legacy Mode Toggle:** 현재 NINA-B1 펌웨어(legacy 모드, 기본 ON) 와 차후 NoiPod 사양(toggle OFF) 동시 지원. 구 설정 사용자 마이그레이션 포함.
- **BLE Notify Parser Order:** TOUCH(11B) → IR(5B/6B, 끝 `0x0D 0x0A`) → NDEF Text → raw ASCII fallback. IR 은 길이 무관하게 끝 2바이트로만 판정.
- **펌웨어 LED 색상 코드:** `encodeLegacyLedFrame` 두 번째 바이트는 색상 코드(`R=1`/`B=2`/`G=3`/`R+B=4`/`R+G=5`/`B+G=6`/`W=7`/`OFF=8`). `pod` 인자 받지 않음 (단일 LED). OFF 도 명시 `0x08` 송신.
- **Engine BLE Write Defense (Task #150):** 모든 BLE write 는 `safeBleWrite*` wrapper 로 throw 삼킴 + `startTickLoop` 가 중복 타이머 cancel.
- **BLE Diagnostic Line (Task #153):** 훈련/Device 화면에 `BLE: FW=O/X/? · L=ON/OFF · TX=N <hex> · RX=M <hex>` 1Hz polling. `safeBleWrite*` 가 silent 라 진단 line 없이는 회귀 구분 불가. 훈련 화면 viewport 는 `100dvh` (WebView 주소창 회피).
- **MEMORY Sequence Loop:** SHOW→RECALL cycle 반복 (`runMemorySequence` + idempotent `advanceMemorySequence`). RECALL 중에는 `handleTap` 이 trailing `allOff()` skip.
- **MULTITASKING (F) handleTap source:** `opts.source: 'touch'|'nfc'` 로 손/발 채널 분리 — BLE TOUCH·IR = touch, NFC = nfc. AGILITY 모드만 사용. 채널 침범은 `aCrossChannelErrors` 누적. `MULTITASKING_API_MODE = 'AGILITY'` alias 유지.
- **MULTITASKING (F) simul 윈도우 (`agilitySimulPending`):** Lv4+ 동시 자극은 두 채널 모두 정확 입력될 때까지 LED 유지. `agilitySimulSeq` 토큰 가드 + `pause()` 시 명시 정리로 leak 차단.
- **handleTap dedup scope:** `(pod, tickId)` dedup 은 `opts.tickId` 명시될 때만 (BLE TOUCH 11B). NFC/IR/단위 테스트는 skip — MEMORY 반복 입력과 JUDGMENT 더블탭 보존.
- **ENDURANCE Early/Mid/Late 경계:** `engine.ts` 가 `total/3`·`total*2/3` 으로 일원화 (300s 세션 = 100s/200s) — `shared/training-spec.ts` 의 `ENDURANCE_EARLY_END_MS=100_000` / `ENDURANCE_LATE_START_MS=200_000` 와 정렬.
- **ENDURANCE 점수 산식 — server vs spec 분기 (의도된):** 운영 산식은 `server/services/score-calculator.ts` 의 Z-score 정규화(maintainRatio 80 + rhythmAccuracy 20). `shared/training-spec.ts` 의 명세 산식 채택은 6지표 일괄 재설계 선행 — Task #156 follow-up.
- **Mobile Shell SafeAreaView:** `mobile/src/screens/WebShellScreen.tsx` 가 `WebAppWebView` 를 `SafeAreaView edges={['top','bottom','left','right']}` 로 감쌈 — Android WebView 의 `env(safe-area-inset-top)` quirk 회피.

## Product

- Measures six cognitive indicators: memory, comprehension, concentration, judgment, agility, endurance.
- Analyzes user's "Brainimal" type.
- Provides customized training reports.
- Displays personal and organizational rankings.
- Offers enterprise insights for organizations.
- Supports cognitive training sessions with BLE hardware interaction.

## User preferences

_Populate as you build_

## Gotchas

- **Shared Package Builds:** Always run `cd shared && npm run build` before building client/server.
- **BLE Write Serialization (Legacy Mode):** Client-side 50ms + native-side 30ms gap to prevent firmware frame drops.
- **Admin Password in Production:** `ADMIN_PASSWORD` 미설정 시 시드 skip.
- **NoiPod vs. NINA-B1 Firmware:** `legacyBleMode` toggle 이 BLE 통신 정합성의 핵심 — Device 화면에서 확인.
- **kv_store 와 정규화 테이블 일시 병행:** Phase B/C 리팩토링으로 대부분 호출은 정규화 테이블을 쓰지만, 의도된 KV 잔존 영역(`docs/architecture/db-refactor.md` 참조) 은 그대로. 새 entity 추가 시 KV 가 아니라 정규화 테이블 + repository 헬퍼로 시작.

## Pointers

- [React 18](https://react.dev/blog/2022/03/29/react-v18) · [Vite](https://vitejs.dev/guide/) · [Express.js](https://expressjs.com/) · [TypeScript](https://www.typescriptlang.org/docs/)
- [Tailwind CSS](https://tailwindcss.com/docs) · [Framer Motion](https://www.framer.com/motion/) · [React Router v6](https://reactrouter.com/en/v6)
- [Node.js](https://nodejs.org/docs/) · [PostgreSQL](https://www.postgresql.org/docs/) · [JWT](https://jwt.io/introduction/) · [bcrypt.js](https://github.com/dcodeIO/bcrypt.js)
