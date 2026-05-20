import Database from '@replit/database';
import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 미설정');
  process.exit(1);
}
if (!process.env.REPLIT_DB_URL) {
  console.error('REPLIT_DB_URL 미설정 — Replit Database 접근 불가');
  process.exit(1);
}

const kv = new Database();

let keys = await kv.list();
if (keys && typeof keys === 'object' && 'value' in keys) keys = keys.value;
if (!Array.isArray(keys)) {
  console.error('list() 반환이 array 가 아님:', keys);
  process.exit(1);
}
console.log(`Replit KV 총 키 수: ${keys.length}`);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

await pool.query(`CREATE TABLE IF NOT EXISTS kv_store (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_kv_key ON kv_store(key)`);
console.log('✓ kv_store 테이블 준비 완료');

let ok = 0, skipped = 0, failed = 0;
const failedKeys = [];

for (const key of keys) {
  try {
    let v = await kv.get(key);
    if (v && typeof v === 'object' && 'value' in v && 'ok' in v) v = v.value;
    if (v === undefined || v === null) { skipped++; continue; }
    await pool.query(
      `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
      [key, JSON.stringify(v)]
    );
    ok++;
  } catch (e) {
    console.error(`✗ ${key}:`, e.message);
    failed++;
    failedKeys.push(key);
  }
}

console.log(`\n=== 마이그레이션 결과 ===`);
console.log(`성공: ${ok}, 빈값 스킵: ${skipped}, 실패: ${failed}`);
if (failedKeys.length) console.log('실패 키:', failedKeys);

const { rows: count } = await pool.query('SELECT COUNT(*)::int AS n FROM kv_store');
console.log(`\nPostgres kv_store 행 수: ${count[0].n}`);

const sample = await pool.query(`SELECT key,
  CASE WHEN jsonb_typeof(value)='array' THEN jsonb_array_length(value)::text ELSE jsonb_typeof(value) END AS info
  FROM kv_store ORDER BY key LIMIT 30`);
console.log('\n샘플 키 (최대 30개):');
sample.rows.forEach(r => console.log(`  ${r.key.padEnd(45)} ${r.info}`));

try {
  const u = await pool.query(`SELECT jsonb_array_length(value) AS n FROM kv_store WHERE key='users'`);
  if (u.rows[0]) console.log(`\n✓ users 키: ${u.rows[0].n}명`);
} catch {}

await pool.end();
console.log('\n완료.');
