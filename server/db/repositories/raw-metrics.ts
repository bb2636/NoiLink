/**
 * raw_metrics repository (Task #157 + Task #158 dual-mode)
 */
import type { RawMetrics } from '@noilink/shared';
import {
  getPool, rowToCamel, isPostgresBackend,
  kvGetCollection, kvSetCollection, kvUpsert,
} from './util.js';

const KV = 'rawMetrics';
const COLS = `
  session_id, user_id, touch_count, hit_count, rt_mean, rt_sd,
  by_mode_metrics, rhythm, memory, comprehension, focus, judgment, agility, endurance, recovery,
  created_at
`;

function rowToRaw(row: any): RawMetrics | null {
  if (!row) return null;
  // rt_sd → rtSD 약어 alias 는 util.ts 의 ACRONYM_FIELD_ALIASES 가 처리.
  // (Task #159 회귀가 Task #161 에서 중앙화됐다.)
  const c = rowToCamel<any>(row)!;
  if (c.createdAt instanceof Date) c.createdAt = c.createdAt.toISOString();
  return c as RawMetrics;
}

export async function findRawMetricsBySessionId(sessionId: string): Promise<RawMetrics | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<RawMetrics>(KV);
    return all.find((r) => r.sessionId === sessionId) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM raw_metrics WHERE session_id = $1 LIMIT 1`, [sessionId]
  );
  return rowToRaw(rows[0]);
}

export async function listRawMetricsByUser(
  userId: string, opts: { limit?: number; sinceCreatedAt?: string } = {}
): Promise<RawMetrics[]> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<RawMetrics>(KV);
    let filtered = all.filter((r) => r.userId === userId
      && (!opts.sinceCreatedAt || new Date(r.createdAt).getTime() >= new Date(opts.sinceCreatedAt).getTime()));
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
    `SELECT ${COLS} FROM raw_metrics WHERE ${where.join(' AND ')} ORDER BY created_at DESC ${limit}`,
    params
  );
  return rows.map((r) => rowToRaw(r)!).filter(Boolean);
}

export async function deleteRawMetricsByUser(userId: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<RawMetrics>(KV);
    await kvSetCollection(KV, all.filter((r) => r.userId !== userId));
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM raw_metrics WHERE user_id = $1`, [userId]);
}

export async function deleteAllRawMetrics(): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvSetCollection(KV, []);
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM raw_metrics`);
}

export async function countAllRawMetrics(): Promise<number> {
  if (!(await isPostgresBackend())) {
    return (await kvGetCollection<RawMetrics>(KV)).length;
  }
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM raw_metrics`);
  return rows[0]?.n ?? 0;
}

export async function listAllRawMetrics(): Promise<RawMetrics[]> {
  if (!(await isPostgresBackend())) {
    return kvGetCollection<RawMetrics>(KV);
  }
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT ${COLS} FROM raw_metrics ORDER BY created_at DESC`);
  return rows.map((r) => rowToRaw(r)!).filter(Boolean);
}

export async function upsertRawMetrics(r: RawMetrics): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvUpsert<RawMetrics>(KV, r, (x) => x.sessionId === r.sessionId);
    return;
  }
  const pool = await getPool();
  await pool.query(
    `INSERT INTO raw_metrics (
      session_id, user_id, touch_count, hit_count, rt_mean, rt_sd,
      by_mode_metrics, rhythm, memory, comprehension, focus, judgment, agility, endurance, recovery,
      created_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,
      $7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,
      $16
    )
    ON CONFLICT (session_id) DO UPDATE SET
      user_id=EXCLUDED.user_id, touch_count=EXCLUDED.touch_count, hit_count=EXCLUDED.hit_count,
      rt_mean=EXCLUDED.rt_mean, rt_sd=EXCLUDED.rt_sd,
      by_mode_metrics=EXCLUDED.by_mode_metrics, rhythm=EXCLUDED.rhythm,
      memory=EXCLUDED.memory, comprehension=EXCLUDED.comprehension,
      focus=EXCLUDED.focus, judgment=EXCLUDED.judgment,
      agility=EXCLUDED.agility, endurance=EXCLUDED.endurance, recovery=EXCLUDED.recovery`,
    [
      r.sessionId, r.userId, r.touchCount ?? null, r.hitCount ?? null,
      r.rtMean ?? null, r.rtSD ?? null,
      r.byModeMetrics ? JSON.stringify(r.byModeMetrics) : null,
      r.rhythm ? JSON.stringify(r.rhythm) : null,
      r.memory ? JSON.stringify(r.memory) : null,
      r.comprehension ? JSON.stringify(r.comprehension) : null,
      r.focus ? JSON.stringify(r.focus) : null,
      r.judgment ? JSON.stringify(r.judgment) : null,
      r.agility ? JSON.stringify(r.agility) : null,
      r.endurance ? JSON.stringify(r.endurance) : null,
      r.recovery ? JSON.stringify(r.recovery) : null,
      r.createdAt,
    ]
  );
}
