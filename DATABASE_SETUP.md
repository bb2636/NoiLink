# 데이터베이스 설정 가이드

## 📋 개요

이 프로젝트는 여러 데이터베이스 백엔드를 지원합니다:
- **PostgreSQL** (Neon/Supabase) - 개발 환경 권장
- **Replit Database** - Replit 배포 환경
- **로컬 JSON 파일** - 간단한 테스트

## 🔧 설정 방법

### 1. PostgreSQL (Neon/Supabase) - 개발 환경

#### Neon 설정

1. [Neon](https://neon.tech)에서 프로젝트 생성
2. Connection String 복사
3. `.env` 파일 생성:

```bash
DB_TYPE=postgres
DATABASE_URL=postgresql://user:password@host.neon.tech/database?sslmode=require
```

#### Supabase 설정

1. [Supabase](https://supabase.com)에서 프로젝트 생성
2. Settings > Database > Connection String 복사
3. `.env` 파일 생성:

```bash
DB_TYPE=postgres
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

### 2. Replit Database - 배포 환경

Replit 환경에서는 자동으로 감지됩니다. 별도 설정 불필요.

수동으로 지정하려면:
```bash
DB_TYPE=replit
```

### 3. 로컬 JSON 파일 - 테스트

```bash
DB_TYPE=local
```

데이터는 `data/db.json` 파일에 저장됩니다.

## 🚀 사용 방법

### 환경 변수 우선순위

1. `DB_TYPE` 환경 변수로 명시적 지정
2. `DATABASE_URL`이 있으면 PostgreSQL 자동 선택
3. `REPLIT_DB_URL` 또는 `REPL_ID`가 있으면 Replit Database 자동 선택
4. 그 외에는 로컬 JSON 파일 사용

### 코드에서 사용

```typescript
import { db } from './db.js';

// Key-Value 스토어 방식 (모든 DB에서 동일)
await db.set('users', [{ id: '1', name: 'John' }]);
const users = await db.get('users') || [];

// PostgreSQL 전용 (Neon/Supabase에서만 사용 가능)
const result = await db.query('SELECT * FROM custom_table WHERE id = $1', [userId]);
```

## 📦 패키지 설치

### PostgreSQL 사용 시

```bash
cd server
npm install pg @types/pg
```

### Replit Database 사용 시

```bash
cd server
npm install @replit/database
```

## 🔄 개발 → 배포 전환

### 개발 환경 (Neon/Supabase)

```bash
# .env 파일
DB_TYPE=postgres
DATABASE_URL=postgresql://...
```

### 배포 환경 (Replit)

```bash
# Replit Secrets에 설정 (또는 자동 감지)
# DB_TYPE=replit (선택사항)
```

Replit 환경에서는 `REPL_ID`가 자동으로 설정되므로 별도 설정 불필요.

## 🧪 테스트

### 데이터베이스 연결 테스트

```bash
cd server
npx tsx test-db.ts
```

### 환경별 테스트

```bash
# PostgreSQL 테스트
DB_TYPE=postgres DATABASE_URL=... npx tsx test-db.ts

# Replit DB 테스트 (Replit 환경에서만)
DB_TYPE=replit npx tsx test-db.ts

# 로컬 JSON 테스트
DB_TYPE=local npx tsx test-db.ts
```

## ⚠️ 주의사항

### PostgreSQL (Neon/Supabase)

- Key-Value 스토어는 `kv_store` 테이블에 저장됩니다
- 자동으로 테이블이 생성됩니다
- SSL 연결이 자동으로 활성화됩니다 (프로덕션 환경)

### Replit Database

- Replit 환경에서만 작동합니다
- 외부에서는 사용할 수 없습니다

### 데이터 마이그레이션

개발 환경(PostgreSQL)에서 배포 환경(Replit DB)으로 데이터를 옮기려면:

1. PostgreSQL에서 데이터 추출
2. Replit DB 형식으로 변환
3. Replit 환경에서 import

(마이그레이션 스크립트는 추후 추가 예정)

## 📚 참고 자료

- [Neon Documentation](https://neon.tech/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Replit Database](https://docs.replit.com/hosting/databases/replit-database)
- [PostgreSQL Node.js Driver](https://node-postgres.com/)
