# Database Refactor — KV → Normalized Postgres

`server/db/` 의 KV-only 구조에서 정규화 테이블 + Repository 패턴으로의 전환 기록. 라이브 운영 정책은 `replit.md` 의 "Architecture decisions" 에 요약돼 있고, 이 문서는 단계별 작업 범위와 의도된 KV 잔존 영역을 보존한다.

---

## Postgres 정규화 스키마 인프라 (Task #157)

Postgres 어댑터 부팅 시 `server/db/schema.sql` 을 멱등 적용해 13개 정규화 테이블 + 기존 `kv_store` 를 함께 유지한다.

**정규화 테이블 (13개):**
`users`, `passwords`, `organizations`, `terms`, `sessions`, `metrics_scores`, `raw_metrics`, `rankings`, `reports`, `org_insight_reports`, `daily_conditions`, `daily_missions`, `ble_abort_events`, `ack_banner_events`, `inquiries`.

**패턴:**
- 핵심 entity (users/sessions/passwords/organizations/terms) → 컬럼으로 평탄화.
- 부가 entity → 식별 컬럼 + `payload JSONB`.

**Repository 계층:** `server/db/repositories/*.ts` (users/sessions/metrics-scores/raw-metrics/passwords/organizations/reports/rankings/daily/events/terms). `db.getPool()` 을 통해 pg `Pool` 에 안전 접근(Postgres 백엔드 외에서는 throw).

**데이터 이전:** `scripts/migrate-kv-to-normalized.mjs` 가 멱등으로 수행 (원본 `kv_store` 는 idempotency / normConfig / migrations 보존 + 검증 안전망으로 남김).

**빌드:** `npm run build` 가 `dist/db/schema.sql` 로 복사 — tsx 개발 모드는 source 경로를 직접 읽음.

---

## 서비스/라우트 KV → Repository 리팩토링 (Task #158)

Task #157 인프라 위에서 `server/services/` 와 `server/routes/` 의 대부분 `db.get(<collection>)` whole-load 호출을 단일 entity 헬퍼로 교체.

**주요 헬퍼:**
- 사용자: `findUserById/Email/Username/Phone/Social`, `listUsersByIds/ByOrganization/ByType/listAllUsers`, `upsertUser`, `softDeleteUser`.
- 세션·메트릭: `listSessions({userId, sinceCreatedAt})`, `deleteSessionsByUser/MetricsByUser/RawMetricsByUser`.
- 조직·약관: `findOrganizationById`, `listOrganizations`, `upsertOrganization`, `listAllTerms`, `findTermsById`, `upsertTerms`.
- 인증: `findPasswordByUserId/Email`.
- 리포트: `findLatestReportByUser`, `findReportById`, `deleteReportsByUser`.
- 일일: `deleteDailyConditionsByUser`, `deleteDailyMissionsByUser`.
- 이벤트·문의: `insertBleAbortEvent`, `insertAckBannerEvent`, `insertInquiry`, `listInquiries`, `findInquiry`, `deleteInquiriesByUser`.

**효과:** KV 통째 로딩 회귀(기관 리포트 한 번에 전체 사용자/세션 역직렬화)가 사라져 응답 지연이 SQL `WHERE`/인덱스로 떨어지고 Node 메모리 폭주 차단. Repository 함수들은 `isPostgresBackend()` 분기로 KV 폴백을 그대로 지원 — Postgres 외 환경에서도 회귀 없이 동작.

**Phase B:** `middleware/auth`, `routes/{terms,reports,home,sessions,metrics,rankings}`, `services/{personal-report,organization-insight-report}`.

**Phase C:**
- `routes/scores.ts` — 전체 재작성 (KV `scores` 컬렉션은 레거시로 유지).
- `routes/admin.ts` — dashboard/users/organizations/sessions/recovery-stats/reset-training-data, terms/inquiries 핸들러.
- `routes/auth.ts` — naver/kakao callbacks + naver withdraw.
- `routes/users.ts` — 전체 가입/로그인/me/cascade 탈퇴/조직 가입·승인·반려/비밀번호 재설정/문의/조직 멤버/통계. 새 `findUserByPhone` repo 헬퍼 추가.

---

## 의도된 KV 잔존 영역

`IDatabase.get/set/list` 어댑터는 다음 진짜 KV 용도에만 남는다:

1. `idempotency` / `normConfig` / `migrations` — 진정한 key-value.
2. 레거시 `scores` · `games` 통계 — `/api/users/:userId/stats` 에서만 참조, 현재 미사용.
3. `rankings` (clear-only) — `routes/admin.ts` 의 reset-training-data 가 비움. read 시 매번 계산되는 derived view 라 정규화 우선순위 낮음.
4. OTP · reset-token — `password_reset_otps` / `password_reset_tokens`.
5. `banners` — 정규화 테이블 미보유.
6. Postgres 미사용 환경 호환 fallback.
7. `seed-admin.ts` — 부팅 1회성 path, 별도 follow-up.

---

## `GET /api/reports/:reportId` 인가 회귀 가드 (코드 리뷰 follow-up)

초기 Phase C 구현은 본인 리포트 100개 + ADMIN 만 다른 사용자 리포트 검색이라 같은 조직 매니저가 부하 사용자 리포트를 id 로 직접 못 여는 회귀가 있었다.

`reports` repo 에 인덱싱된 `findReportById(reportId)` (PK 단일조회 + KV 폴백) 헬퍼를 추가해, 라우트는 id 로 먼저 가져온 뒤 `userCanActOnTargetUserId` 로 인가 검사 — 본인 / ADMIN / 같은 조직 매니저 모두 기존처럼 접근 가능, 100개 윈도우 한계도 사라짐.

---

## Cascade Delete 보조 정리 (Task #162)

`cascadeDeleteUser` 는 `deleteSessionsByUser(userId)` (1차 사용자 row 삭제) 직후 `deleteCompositeParticipantByUser(userId)` 로 다른 사용자 합동 세션의 `meta.participantIds` 배열에서 본인 id 만 splice — 보조 참여 기록도 정리되고, 다른 참여자의 결과 row 는 보존.

**회귀 가드:** `server/db/repositories/integration.test.ts` "deleteCompositeParticipantByUser — participantIds 에서 본인만 splice, row 유지".

---

## Repository Envelope 변경 가드

Events 정규화 테이블(`ble_abort_events` / `ack_banner_events` / `inquiries`)의 `insertEvent` 가 페이로드를 `(id, user_id, session_id, payload, created_at)` 으로 평탄화하면서 저장된 row 모양에 `id` + `createdAt` 가 추가됨.

`routes/metrics.test.ts` 의 PII 화이트리스트 키 비교 두 건을 새 envelope 키 포함으로 갱신 — PII 누출 검증은 그대로 유지, `apiMode/bleUnstable/burstCount` 등 application 페이로드 키만 정확히 일치하는지 확인.

---

## 중복 사용자 방지 (2026-05-21)

`users` 테이블에 partial unique index 2개 추가:
- `uniq_users_email ON users(email) WHERE email IS NOT NULL AND email <> ''`
- `uniq_users_username ON users(username) WHERE username IS NOT NULL AND username <> ''`

소셜 가입처럼 email 없는 케이스를 깨지 않기 위해 partial unique 사용. `server/db/schema.sql` 에 반영돼 새 환경 부팅 시 자동 적용.

**회귀 이력:** Task #157 정규화 직후 첫 부팅에서 `seed-admin` 이 기존 KV 시드를 못 찾고 새 ID 로 admin/test/org 계정을 재시드 — 동일 email/username 으로 3쌍의 중복 user row 가 생겼다. 자식 row(sessions/metrics)는 4월 row 로 이전 후 5월 row 삭제, UNIQUE 인덱스로 재발 차단.

**프로덕션 배포 주의:** 기존 중복 row 가 있으면 인덱스 생성 자체가 실패하므로, 배포 전 동일 정리 SQL 적용 필요.
