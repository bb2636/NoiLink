/**
 * metrics_scores repository (Task #157 + Task #158 dual-mode)
 */
import type { MetricsScore } from '@noilink/shared';
import {
  getPool, rowToCamel, isPostgresBackend,
  kvGetCollection, kvSetCollection, kvUpsert,
} from './util.js';

const KV = 'metricsScores';
const COLS = `session_id, user_id, memory, comprehension, focus, judgment, agility, endurance, rhythm, created_at`;

function rowToMetrics(row: any): MetricsScore | null {
  if (!row) return null;
  const c = rowToCamel<any>(row)!;
  if (c.createdAt instanceof Date) c.createdAt = c.createdAt.toISOString();
  return c as MetricsScore;
}

export async function findMetricsBySessionId(sessionId: string): Promise<MetricsScore | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<MetricsScore>(KV);
    return all.find((m) => m.sessionId === sessionId) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM metrics_scores WHERE session_id = $1 LIMIT 1`, [sessionId]
  );
  return rowToMetrics(rows[0]);
}

export async function listMetricsByUser(
  userId: string, opts: { limit?: number; sinceCreatedAt?: string } = {}
): Promise<MetricsScore[]> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<MetricsScore>(KV);
    let filtered = all.filter((m) => m.userId === userId
      && (!opts.sinceCreatedAt || new Date(m.createdAt).getTime() >= new Date(opts.sinceCreatedAt).getTime()));
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (opts.limit) filtered = filtered.slice(0, Math.max(1, Math.floor(opts.limit)));
    return filtered;
  }
  const pool = await getPool();
  const where: string[] = ['user_id = $1'];
  const params: any[] = [userId];
  if (opts.sinceCreatedAt !== undefined) { params.push(opts.sinceCreatedAt); where.push(`created_at >= $${params.length}`); }
  const limit = opts.limit !== undefined ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM metrics_scores WHERE ${where.join(' AND ')} ORDER BY created_at DESC ${limit}`,
    params
  );
  return rows.map((r) => rowToMetrics(r)!).filter(Boolean);
}

export async function listMetricsBySessionIds(sessionIds: string[]): Promise<MetricsScore[]> {
  if (sessionIds.length === 0) return [];
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<MetricsScore>(KV);
    const set = new Set(sessionIds);
    return all.filter((m) => set.has(m.sessionId));
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM metrics_scores WHERE session_id = ANY($1::text[])`, [sessionIds]
  );
  return rows.map((r) => rowToMetrics(r)!).filter(Boolean);
}

export async function listMetricsByUsers(userIds: string[]): Promise<MetricsScore[]> {
  if (userIds.length === 0) return [];
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<MetricsScore>(KV);
    const set = new Set(userIds);
    return all.filter((m) => set.has(m.userId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM metrics_scores WHERE user_id = ANY($1::text[]) ORDER BY created_at DESC`,
    [userIds]
  );
  return rows.map((r) => rowToMetrics(r)!).filter(Boolean);
}

export async function deleteMetricsByUser(userId: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<MetricsScore>(KV);
    await kvSetCollection(KV, all.filter((m) => m.userId !== userId));
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM metrics_scores WHERE user_id = $1`, [userId]);
}

export async function deleteAllMetrics(): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvSetCollection(KV, []);
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM metrics_scores`);
}

export async function countAllMetrics(): Promise<number> {
  if (!(await isPostgresBackend())) {
    return (await kvGetCollection<MetricsScore>(KV)).length;
  }
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM metrics_scores`);
  return rows[0]?.n ?? 0;
}

export async function upsertMetricsScore(m: MetricsScore): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvUpsert<MetricsScore>(KV, m, (x) => x.sessionId === m.sessionId);
    return;
  }
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
