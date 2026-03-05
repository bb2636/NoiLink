# Replit Database 연결 가이드

## 📋 개요

Replit Database는 Replit 플랫폼에서 제공하는 내장 Key-Value 데이터베이스입니다. 별도의 설정 없이 Replit 환경에서 자동으로 연결됩니다.

## 🔧 설정 방법

### 1. 패키지 설치 (이미 완료됨)

```bash
cd server
npm install @replit/database
```

`server/package.json`에 이미 포함되어 있습니다:
```json
{
  "dependencies": {
    "@replit/database": "^2.0.2"
  }
}
```

### 2. 데이터베이스 인스턴스 생성

현재 `server/db.ts` 파일에서 이미 설정되어 있습니다:

```typescript
import { Database } from '@replit/database';

export const db = new Database();
```

### 3. Replit 환경에서 자동 연결

**중요**: Replit Database는 Replit 환경에서만 작동합니다!

- Replit Repl 내에서 실행하면 자동으로 연결됩니다
- 별도의 연결 문자열이나 인증 정보가 필요 없습니다
- `REPLIT_DB_URL` 환경 변수가 자동으로 설정됩니다

## 🚀 사용 방법

### 기본 사용법

```typescript
import { db } from './db.js';

// 데이터 저장
await db.set('key', 'value');
await db.set('users', [{ id: '1', name: 'John' }]);

// 데이터 조회
const value = await db.get('key');
const users = await db.get('users') || [];

// 데이터 삭제
await db.delete('key');

// 모든 키 조회
const keys = await db.list();
```

### 현재 프로젝트에서의 사용 예시

```typescript
// 사용자 저장
const users = await db.get('users') || [];
users.push(newUser);
await db.set('users', users);

// 세션 조회
const sessions = await db.get('sessions') || [];
const userSessions = sessions.filter(s => s.userId === userId);
```

## ⚠️ 주의사항

### 1. Replit 환경 필수

- **Replit 외부에서는 작동하지 않습니다**
- 로컬 개발 환경에서는 다른 데이터베이스(예: SQLite, JSON 파일)를 사용해야 합니다

### 2. 데이터 타입 제한

- Replit Database는 JSON 직렬화 가능한 데이터만 저장합니다
- 함수, Date 객체 등은 자동으로 문자열로 변환됩니다
- ISO 8601 형식의 날짜 문자열 사용 권장

### 3. 동시성 제한

- 여러 요청이 동시에 같은 키를 수정하면 마지막 쓰기가 이전 쓰기를 덮어쓸 수 있습니다
- 프로덕션 환경에서는 트랜잭션 로직을 추가하는 것을 권장합니다

## 🔄 로컬 개발 환경 대안

Replit 외부에서 개발할 경우, 다음 중 하나를 사용할 수 있습니다:

### 옵션 1: JSON 파일 기반 (간단)

```typescript
// server/db-local.ts
import fs from 'fs/promises';
import path from 'path';

const DB_FILE = path.join(process.cwd(), 'data', 'db.json');

class LocalDB {
  private data: Record<string, any> = {};
  
  async init() {
    try {
      const content = await fs.readFile(DB_FILE, 'utf-8');
      this.data = JSON.parse(content);
    } catch {
      this.data = {};
    }
  }
  
  async get(key: string) {
    return this.data[key];
  }
  
  async set(key: string, value: any) {
    this.data[key] = value;
    await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
    await fs.writeFile(DB_FILE, JSON.stringify(this.data, null, 2));
  }
  
  async delete(key: string) {
    delete this.data[key];
    await fs.writeFile(DB_FILE, JSON.stringify(this.data, null, 2));
  }
  
  async list() {
    return Object.keys(this.data);
  }
}

export const db = new LocalDB();
await db.init();
```

### 옵션 2: 환경 변수로 분기

```typescript
// server/db.ts
import { Database } from '@replit/database';

let db: any;

if (process.env.REPLIT_DB_URL || process.env.REPL_ID) {
  // Replit 환경
  db = new Database();
} else {
  // 로컬 환경 - JSON 파일 사용
  const { LocalDB } = await import('./db-local.js');
  db = new LocalDB();
  await db.init();
}

export { db };
```

## 📝 Replit에서 배포 시 체크리스트

1. ✅ `@replit/database` 패키지가 설치되어 있는지 확인
2. ✅ `server/db.ts`에서 Database 인스턴스가 생성되는지 확인
3. ✅ Replit Repl 내에서 실행 중인지 확인
4. ✅ 환경 변수 `REPLIT_DB_URL`이 자동 설정되는지 확인 (Replit이 자동 처리)

## 🧪 테스트

Replit 환경에서 데이터베이스 연결 테스트:

```typescript
// server/test-db.ts
import { db } from './db.js';

async function testDB() {
  try {
    // 테스트 데이터 저장
    await db.set('test_key', { message: 'Hello Replit DB!' });
    
    // 테스트 데이터 조회
    const data = await db.get('test_key');
    console.log('✅ DB 연결 성공:', data);
    
    // 테스트 데이터 삭제
    await db.delete('test_key');
    console.log('✅ DB 테스트 완료');
  } catch (error) {
    console.error('❌ DB 연결 실패:', error);
  }
}

testDB();
```

## 📚 참고 자료

- [Replit Database 공식 문서](https://docs.replit.com/hosting/databases/replit-database)
- [@replit/database npm 패키지](https://www.npmjs.com/package/@replit/database)
