/**
 * 데이터베이스 인스턴스
 * 환경 변수에 따라 자동으로 적절한 DB를 선택합니다.
 * 
 * 우선순위:
 * 1. DB_TYPE 환경 변수로 명시적 지정
 * 2. DATABASE_URL이 있으면 PostgreSQL (Neon/Supabase)
 * 3. REPLIT_DB_URL 또는 REPL_ID가 있으면 Replit Database
 * 4. 그 외에는 로컬 JSON 파일
 */

import type { Pool } from 'pg';
import type { IDatabase } from './db/interface.js';

let db: IDatabase | null = null;

async function initializeDB(): Promise<IDatabase> {
  const dbType = process.env.DB_TYPE?.toLowerCase();
  
  // 1. 명시적 DB 타입 지정
  if (dbType === 'postgres' || dbType === 'postgresql' || dbType === 'neon' || dbType === 'supabase') {
    const { PostgresDB } = await import('./db/postgres.js');
    const dbInstance = new PostgresDB();
    await dbInstance.connect();
    return dbInstance;
  }
  
  if (dbType === 'replit') {
    const { ReplitDB } = await import('./db/replit.js');
    const dbInstance = new ReplitDB();
    await dbInstance.connect();
    return dbInstance;
  }
  
  if (dbType === 'local') {
    const { LocalDB } = await import('./db/local.js');
    const dbInstance = new LocalDB();
    await dbInstance.connect();
    return dbInstance;
  }
  
  // 2. DATABASE_URL이 있으면 PostgreSQL (Neon/Supabase)
  if (process.env.DATABASE_URL) {
    const { PostgresDB } = await import('./db/postgres.js');
    const dbInstance = new PostgresDB();
    await dbInstance.connect();
    return dbInstance;
  }
  
  // 3. Replit 환경 감지
  if (process.env.REPLIT_DB_URL || process.env.REPL_ID) {
    const { ReplitDB } = await import('./db/replit.js');
    const dbInstance = new ReplitDB();
    await dbInstance.connect();
    return dbInstance;
  }
  
  // 4. 기본값: 로컬 JSON 파일
  const { LocalDB } = await import('./db/local.js');
  const dbInstance = new LocalDB();
  await dbInstance.connect();
  return dbInstance;
}

// DB 초기화 (비동기)
const dbPromise = initializeDB().catch(async (error) => {
  console.error('❌ Failed to initialize database:', error);
  if (error instanceof Error) {
    console.error('   Error message:', error.message);
  }
  
  // PostgreSQL 연결 실패 시 로컬 DB로 fallback
  console.log('⚠️  Falling back to local JSON database...');
  const { LocalDB } = await import('./db/local.js');
  const localDB = new LocalDB();
  await localDB.connect();
  return localDB;
});

// 동기적으로 접근 가능한 래퍼
const dbWrapper: IDatabase = {
  async get(key: string) {
    if (!db) db = await dbPromise;
    return await db.get(key);
  },
  async set(key: string, value: any) {
    if (!db) db = await dbPromise;
    return await db.set(key, value);
  },
  async delete(key: string) {
    if (!db) db = await dbPromise;
    return await db.delete(key);
  },
  async list(prefix?: string) {
    if (!db) db = await dbPromise;
    return await db.list(prefix);
  },
  async query(sql: string, params?: any[]) {
    if (!db) db = await dbPromise;
    return await db.query(sql, params);
  },
  async transaction<T>(callback: (tx: IDatabase) => Promise<T>) {
    if (!db) db = await dbPromise;
    return await db.transaction(callback);
  },
  async connect() {
    if (!db) db = await dbPromise;
    return await db.connect();
  },
  async disconnect() {
    if (!db) db = await dbPromise;
    return await db.disconnect();
  },
  isConnected() {
    return db ? db.isConnected() : false;
  },
};

/**
 * Task #157: Postgres 백엔드의 pg Pool 에 안전하게 접근.
 * 다른 백엔드(Replit KV / LocalDB) 에서 호출하면 throw.
 * Repository 함수가 raw SQL/트랜잭션을 위해 사용한다.
 */
async function getPool(): Promise<Pool> {
  if (!db) db = await dbPromise;
  const maybe = db as unknown as { getPool?: () => Promise<Pool> };
  if (typeof maybe.getPool !== 'function') {
    throw new Error(
      'db.getPool(): 현재 DB 백엔드가 Postgres 가 아닙니다. DB_TYPE=postgres 환경에서만 호출하세요.'
    );
  }
  return await maybe.getPool();
}

/**
 * 실제 결정된 백엔드 인스턴스에 getPool 메서드가 있는지로 Postgres 여부 판정.
 * dbWrapper 자체에 getPool 을 합쳐놓았으므로 `dbExport.getPool` 존재 여부로는
 * 판정할 수 없다 — 반드시 내부 인스턴스를 거쳐야 한다 (PG 연결 실패 후
 * LocalDB 로 fallback 한 경우도 정확히 false 가 나온다).
 */
async function isPostgresBackend(): Promise<boolean> {
  if (!db) db = await dbPromise;
  const maybe = db as unknown as { getPool?: () => Promise<Pool> };
  return typeof maybe.getPool === 'function';
}

const dbExport = Object.assign(dbWrapper, { getPool, isPostgresBackend });

export { dbExport as db };
