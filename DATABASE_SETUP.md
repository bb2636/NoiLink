# 데이터베이스 설정 가이드

## 개요

이 프로젝트는 세 가지 데이터베이스 백엔드를 지원한다:

- **PostgreSQL** — 권장 (개발·프로덕션 공통)
- **Replit Database** — Replit 환경 KV fallback
- **로컬 JSON 파일** — 의존성 없는 개발 fallback

운영 정책은 Replit 내장 Postgres (DB_TYPE=postgres) 단일 사용. KV/로컬은 호환만 유지.

## 설정 방법

### 1. PostgreSQL (권장)

`.env` (개발) 또는 Replit Secrets (프로덕션) 에 다음을 설정:

```bash
DB_TYPE=postgres
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=disable
```

Replit 내장 Postgres 를 쓰는 경우 host 는 `helium`, `sslmode=disable` 로 두면 된다. 외부 호스팅 Postgres 라면 SSL 옵션은 해당 호스팅 정책에 맞춘다.

부팅 시 `server/db/schema.sql` 이 멱등 적용돼 13개 정규화 테이블 + `kv_store` 가 생성된다 (자세한 내용: `docs/architecture/db-refactor.md`).

### 2. Replit Database

Replit 환경에서는 `REPLIT_DB_URL` 또는 `REPL_ID` 가 있으면 자동 감지된다. 명시 지정:

```bash
DB_TYPE=replit
```

### 3. 로컬 JSON

의존성 없이 빠르게 띄울 때:

```bash
DB_TYPE=local
```

데이터는 `server/data/` 의 JSON 파일에 저장된다.

## 환경 변수 우선순위

1. `DB_TYPE` (명시 지정)
2. `DATABASE_URL` → PostgreSQL
3. `REPLIT_DB_URL` 또는 `REPL_ID` → Replit Database
4. fallback → 로컬 JSON

## 코드에서 사용

신규 entity 는 정규화 테이블 + `server/db/repositories/*.ts` 헬퍼로 시작한다. KV `db.get/set/list` 는 idempotency / normConfig / migrations / OTP·reset-token / banners / 레거시 통계 같은 진짜 KV 용도에만 남는다.

```typescript
// 정규화 테이블 — 권장
import { findUserById, listSessions } from './db/repositories/users.js';
const user = await findUserById(userId);
const recent = await listSessions({ userId, sinceCreatedAt: since });

// PostgreSQL 전용 raw query (정말 필요할 때만)
import { getPool } from './db.js';
const result = await getPool().query('SELECT ... FROM ...', [params]);
```

## 주의사항

### PostgreSQL
- `kv_store` 와 13개 정규화 테이블이 병행 존재한다. 신규 저장 경로는 정규화 테이블로 가야 KV 통째 로딩 회귀가 안 생긴다.
- `users` 테이블의 `email`/`username` 에 partial UNIQUE index — 같은 값으로 두 번 INSERT 시 거부된다. 프로덕션 배포 전 중복 row 사전 정리 필요.

### Replit Database
- Replit 환경에서만 작동, KV 인터페이스만 지원 (raw SQL 불가).

### 로컬 JSON
- 단일 프로세스에서만 안전. 동시성 보장 없음.

## 데이터 이전

Task #157 정규화 직후 KV → 정규화 테이블 이전 스크립트:

```bash
DATABASE_URL=... node scripts/migrate-kv-to-normalized.mjs
```

멱등 — 여러 번 실행해도 안전. 원본 `kv_store` 는 검증 안전망으로 보존된다.

## 참고

- `docs/architecture/db-refactor.md` — KV → 정규화 리팩토링 이력, 의도된 KV 잔존 영역, repository 헬퍼 목록
- `server/db/schema.sql` — Postgres 정규화 스키마 (부팅 시 멱등 적용)
- [Replit Database 문서](https://docs.replit.com/hosting/databases/replit-database)
- [PostgreSQL Node.js Driver](https://node-postgres.com/)
