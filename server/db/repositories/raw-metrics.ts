/**
 * raw_metrics repository (Task #157)
 */
import type { RawMetrics } from '@noilink/shared';
import { getPool, rowToCamel } from './util.js';

const COLS = `
  session_id, user_id, touch_count, hit_count, rt_mean, rt_sd,
  by_mode_metrics, rhythm, memory, comprehension, focus, judgment, agility, endurance, recovery,
  created_at
`;

function rowToRaw(row: any): RawMetrics | null {
  if (!row) return null;
  const c = rowToCamel<any>(row)!;
  if (c.createdAt instanceof Date) c.createdAt = c.createdAt.toISOString();
  return c as RawMetrics;
}

export async function findRawMetricsBySessionId(sessionId: string): Promise<RawMetrics | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM raw_metrics WHERE session_id = $1 LIMIT 1`,
    [sessionId]
  );
  return rowToRaw(rows[0]);
}

export async function listRawMetricsByUser(
  userId: string,
  opts: { limit?: number; sinceCreatedAt?: string } = {}
): Promise<RawMetrics[]> {
  const pool = await getPool();
  const where: string[] = ['user_id = $1'];
  const params: any[] = [userId];
  if (opts.sinceCreatedAt !== undefined) {
    params.push(opts.sinceCreatedAt);
    where.push(`created_at >= $${params.length}`);
  }
  const limit = opts.limit !== undefined ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM raw_metrics WHERE ${where.join(' AND ')} ORDER BY created_at DESC ${limit}`,
    params
  );
  return rows.map((r) => rowToRaw(r)!).filter(Boolean);
}

export async function upsertRawMetrics(r: RawMetrics): Promise<void> {
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
