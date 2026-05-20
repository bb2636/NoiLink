/**
 * passwords repository (Task #157)
 *
 * KV 의 'passwords' 키는 `{userId, email, password, mustChange, createdAt}` 배열이었다.
 * 정규화 테이블 컬럼명은 password_hash 로 명확히.
 */
import { getPool } from './util.js';

export interface PasswordRecord {
  userId: string;
  email?: string;
  passwordHash: string;
  mustChange?: boolean;
  createdAt: string;
  updatedAt?: string;
}

function rowToRecord(row: any): PasswordRecord | null {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email ?? undefined,
    passwordHash: row.password_hash,
    mustChange: row.must_change ?? false,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? undefined,
  };
}

export async function findPasswordByUserId(userId: string): Promise<PasswordRecord | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT user_id, email, password_hash, must_change, created_at, updated_at
     FROM passwords WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rowToRecord(rows[0]);
}

export async function findPasswordByEmail(email: string): Promise<PasswordRecord | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT user_id, email, password_hash, must_change, created_at, updated_at
     FROM passwords WHERE email = $1 LIMIT 1`,
    [email]
  );
  return rowToRecord(rows[0]);
}

export async function upsertPassword(rec: PasswordRecord): Promise<void> {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO passwords (user_id, email, password_hash, must_change, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       email=EXCLUDED.email, password_hash=EXCLUDED.password_hash,
       must_change=EXCLUDED.must_change, updated_at=EXCLUDED.updated_at`,
    [
      rec.userId, rec.email ?? null, rec.passwordHash, rec.mustChange ?? false,
      rec.createdAt, rec.updatedAt ?? null,
    ]
  );
}

export async function deletePassword(userId: string): Promise<void> {
  const pool = await getPool();
  await pool.query(`DELETE FROM passwords WHERE user_id = $1`, [userId]);
}
