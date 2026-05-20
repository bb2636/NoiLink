/**
 * passwords repository (Task #157 + Task #158 dual-mode)
 *
 * KV 컬렉션 'passwords' 의 항목 모양:
 *   { userId, email, password (= bcrypt hash), mustChange, createdAt }
 * Postgres 컬럼: password_hash (KV 의 `password` 와 동일한 의미).
 * 폴백 경로에서는 password ↔ passwordHash 매핑을 수행한다.
 */
import { getPool, isPostgresBackend, kvGetCollection, kvSetCollection } from './util.js';

const KV = 'passwords';

export interface PasswordRecord {
  userId: string;
  email?: string;
  passwordHash: string;
  mustChange?: boolean;
  createdAt: string;
  updatedAt?: string;
}

interface KvPasswordRow {
  userId: string;
  email?: string;
  password: string;
  mustChange?: boolean;
  createdAt: string;
  updatedAt?: string;
}

function kvToRec(r: KvPasswordRow | undefined): PasswordRecord | null {
  if (!r) return null;
  return {
    userId: r.userId,
    email: r.email,
    passwordHash: r.password,
    mustChange: r.mustChange ?? false,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function rowToRecord(row: any): PasswordRecord | null {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email ?? undefined,
    passwordHash: row.password_hash,
    mustChange: row.must_change ?? false,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? undefined,
  };
}

export async function findPasswordByUserId(userId: string): Promise<PasswordRecord | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<KvPasswordRow>(KV);
    return kvToRec(all.find((r) => r.userId === userId));
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT user_id, email, password_hash, must_change, created_at, updated_at
     FROM passwords WHERE user_id = $1 LIMIT 1`, [userId]
  );
  return rowToRecord(rows[0]);
}

export async function findPasswordByEmail(email: string): Promise<PasswordRecord | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<KvPasswordRow>(KV);
    return kvToRec(all.find((r) => r.email === email));
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT user_id, email, password_hash, must_change, created_at, updated_at
     FROM passwords WHERE email = $1 LIMIT 1`, [email]
  );
  return rowToRecord(rows[0]);
}

export async function upsertPassword(rec: PasswordRecord): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<KvPasswordRow>(KV);
    const row: KvPasswordRow = {
      userId: rec.userId,
      email: rec.email,
      password: rec.passwordHash,
      mustChange: rec.mustChange ?? false,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    };
    const idx = all.findIndex((r) => r.userId === rec.userId);
    if (idx >= 0) all[idx] = row;
    else all.push(row);
    await kvSetCollection(KV, all);
    return;
  }
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
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<KvPasswordRow>(KV);
    await kvSetCollection(KV, all.filter((r) => r.userId !== userId));
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM passwords WHERE user_id = $1`, [userId]);
}
