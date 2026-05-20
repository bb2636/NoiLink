/**
 * metrics_scores repository (Task #157)
 */
import type { MetricsScore } from '@noilink/shared';
import { getPool, rowToCamel } from './util.js';

const COLS = `session_id, user_id, memory, comprehension, focus, judgment, agility, endurance, rhythm, created_at`;

function rowToMetrics(row: any): MetricsScore | null {
  if (!row) return null;
  const c = rowToCamel<any>(row)!;
  if (c.createdAt instanceof Date) c.createdAt = c.createdAt.toISOString();
  return c as MetricsScore;
}

export async function findMetricsBySessionId(sessionId: string): Promise<MetricsScore | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM metrics_scores WHERE session_id = $1 LIMIT 1`,
    [sessionId]
  );
  return rowToMetrics(rows[0]);
}

export async function listMetricsByUser(
  userId: string,
  opts: { limit?: number; sinceCreatedAt?: string } = {}
): Promise<MetricsScore[]> {
  const pool = await getPool();
  const where: string[] = ['user_id = $1'];
  const params: any[] = [userId];
  if (opts.sinceCreatedAt !== undefined) {
    params.push(opts.sinceCreatedAt);
    where.push(`created_at >= $${params.length}`);
  }
  const limit = opts.limit !== undefined ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM metrics_scores WHERE ${where.join(' AND ')} ORDER BY created_at DESC ${limit}`,
    params
  );
  return rows.map((r) => rowToMetrics(r)!).filter(Boolean);
}

export async function listMetricsBySessionIds(sessionIds: string[]): Promise<MetricsScore[]> {
  if (sessionIds.length === 0) return [];
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM metrics_scores WHERE session_id = ANY($1::text[])`,
    [sessionIds]
  );
  return rows.map((r) => rowToMetrics(r)!).filter(Boolean);
}

export async function upsertMetricsScore(m: MetricsScore): Promise<void> {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO metrics_scores (session_id, user_id, memory, comprehension, focus, judgment, agility, endurance, rhythm, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (session_id) DO UPDATE SET
       user_id=EXCLUDED.user_id, memory=EXCLUDED.memory, comprehension=EXCLUDED.comprehension,
       focus=EXCLUDED.focus, judgment=EXCLUDED.judgment, agility=EXCLUDED.agility,
       endurance=EXCLUDED.endurance, rhythm=EXCLUDED.rhythm`,
    [
      m.sessionId, m.userId, m.memory ?? null, m.comprehension ?? null,
      m.focus ?? null, m.judgment ?? null, m.agility ?? null,
      m.endurance ?? null, m.rhythm ?? null, m.createdAt,
    ]
  );
}
