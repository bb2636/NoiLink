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
const dbPromise = initializeDB().catch((error) => {
  console.error('❌ Failed to initialize database:', error);
  // Fallback: 메모리 기반 간단한 DB
  return {
    data: {} as Record<string, any>,
    async get(key: string) { return this.data[key]; },
    async set(key: string, value: any) { this.data[key] = value; },
    async delete(key: string) { delete this.data[key]; },
    async list() { return Object.keys(this.data); },
    async query() { throw new Error('Not supported'); },
    async transaction(callback: any) { return await callback(this); },
    async connect() {},
    async disconnect() {},
    isConnected: () => true,
  } as IDatabase;
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

export { dbWrapper as db };
