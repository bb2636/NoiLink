/**
 * sessions repository (Task #157)
 */
import type { Session } from '@noilink/shared';
import { getPool, rowToCamel } from './util.js';

const SESSION_COLUMNS = `
  id, user_id, mode, bpm, level, duration, score, is_composite, is_valid,
  phases, meta, created_at
`;

function rowToSession(row: any): Session | null {
  if (!row) return null;
  const camel = rowToCamel<any>(row)!;
  if (camel.createdAt instanceof Date) camel.createdAt = camel.createdAt.toISOString();
  return camel as Session;
}

export async function findSessionById(id: string): Promise<Session | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rowToSession(rows[0]);
}

export interface ListSessionsOpts {
  userId?: string;
  isComposite?: boolean;
  isValid?: boolean;
  /** ISO timestamp, inclusive */
  sinceCreatedAt?: string;
  /** ISO timestamp, exclusive */
  beforeCreatedAt?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

export async function listSessions(opts: ListSessionsOpts = {}): Promise<Session[]> {
  const pool = await getPool();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.userId !== undefined) {
    params.push(opts.userId);
    where.push(`user_id = $${params.length}`);
  }
  if (opts.isComposite !== undefined) {
    params.push(opts.isComposite);
    where.push(`is_composite = $${params.length}`);
  }
  if (opts.isValid !== undefined) {
    params.push(opts.isValid);
    where.push(`is_valid = $${params.length}`);
  }
  if (opts.sinceCreatedAt !== undefined) {
    params.push(opts.sinceCreatedAt);
    where.push(`created_at >= $${params.length}`);
  }
  if (opts.beforeCreatedAt !== undefined) {
    params.push(opts.beforeCreatedAt);
    where.push(`created_at < $${params.length}`);
  }
  const order = opts.order === 'asc' ? 'ASC' : 'DESC';
  const limit = opts.limit !== undefined ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const sql = `SELECT ${SESSION_COLUMNS} FROM sessions ${
    where.length ? `WHERE ${where.join(' AND ')}` : ''
  } ORDER BY created_at ${order} ${limit}`;
  const { rows } = await pool.query(sql, params);
  return rows.map((r) => rowToSession(r)!).filter(Boolean);
}

export async function listCompositeSessionsByUser(
  userId: string,
  opts: { limit?: number; sinceCreatedAt?: string } = {}
): Promise<Session[]> {
  return listSessions({
    userId,
    isComposite: true,
    isValid: true,
    sinceCreatedAt: opts.sinceCreatedAt,
    limit: opts.limit,
    order: 'desc',
  });
}

export async function upsertSession(s: Session): Promise<void> {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO sessions (id, user_id, mode, bpm, level, duration, score, is_composite, is_valid, phases, meta, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
     ON CONFLICT (id) DO UPDATE SET
       user_id=EXCLUDED.user_id, mode=EXCLUDED.mode, bpm=EXCLUDED.bpm,
       level=EXCLUDED.level, duration=EXCLUDED.duration, score=EXCLUDED.score,
       is_composite=EXCLUDED.is_composite, is_valid=EXCLUDED.is_valid,
       phases=EXCLUDED.phases, meta=EXCLUDED.meta`,
    [
      s.id, s.userId, s.mode, s.bpm, s.level, s.duration, s.score ?? null,
      s.isComposite, s.isValid,
      s.phases ? JSON.stringify(s.phases) : null,
      s.meta ? JSON.stringify(s.meta) : null,
      s.createdAt,
    ]
  );
}

export async function deleteSession(id: string): Promise<void> {
  const pool = await getPool();
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
}

export async function countSessionsByUser(
  userId: string,
  opts: { isComposite?: boolean; isValid?: boolean; sinceCreatedAt?: string } = {}
): Promise<number> {
  const pool = await getPool();
  const where: string[] = ['user_id = $1'];
  const params: any[] = [userId];
  if (opts.isComposite !== undefined) {
    params.push(opts.isComposite);
    where.push(`is_composite = $${params.length}`);
  }
  if (opts.isValid !== undefined) {
    params.push(opts.isValid);
    where.push(`is_valid = $${params.length}`);
  }
  if (opts.sinceCreatedAt !== undefined) {
    params.push(opts.sinceCreatedAt);
    where.push(`created_at >= $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sessions WHERE ${where.join(' AND ')}`,
    params
  );
  return rows[0]?.n ?? 0;
}
