/**
 * daily_conditions / daily_missions repository (Task #157)
 */
import type { DailyCondition, DailyMission } from '@noilink/shared';
import { getPool } from './util.js';

function rowToCondition(row: any): DailyCondition | null {
  if (!row) return null;
  const payload = row.payload ?? {};
  return { ...payload, userId: row.user_id, date: row.date } as DailyCondition;
}

export async function findDailyCondition(
  userId: string,
  date: string
): Promise<DailyCondition | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT user_id, date, payload FROM daily_conditions WHERE user_id = $1 AND date = $2 LIMIT 1`,
    [userId, date]
  );
  return rowToCondition(rows[0]);
}

export async function listDailyConditionsByUser(
  userId: string,
  opts: { sinceDate?: string; limit?: number } = {}
): Promise<DailyCondition[]> {
  const pool = await getPool();
  const where: string[] = ['user_id = $1'];
  const params: any[] = [userId];
  if (opts.sinceDate) {
    params.push(opts.sinceDate);
    where.push(`date >= $${params.length}`);
  }
  const limit = opts.limit !== undefined ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const { rows } = await pool.query(
    `SELECT user_id, date, payload FROM daily_conditions
     WHERE ${where.join(' AND ')} ORDER BY date DESC ${limit}`,
    params
  );
  return rows.map((r) => rowToCondition(r)!).filter(Boolean);
}

export async function upsertDailyCondition(c: DailyCondition): Promise<void> {
  const pool = await getPool();
  const { userId, date, ...rest } = c;
  await pool.query(
    `INSERT INTO daily_conditions (user_id, date, payload, calculated_at)
     VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, date) DO UPDATE SET
       payload=EXCLUDED.payload, calculated_at=CURRENT_TIMESTAMP`,
    [userId, date, JSON.stringify(rest)]
  );
}

function rowToMission(row: any): DailyMission | null {
  if (!row) return null;
  const payload = row.payload ?? {};
  return { ...payload, userId: row.user_id, date: row.date } as DailyMission;
}

export async function findDailyMission(
  userId: string,
  date: string
): Promise<DailyMission | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT user_id, date, payload FROM daily_missions WHERE user_id = $1 AND date = $2 LIMIT 1`,
    [userId, date]
  );
  return rowToMission(rows[0]);
}

export async function upsertDailyMission(m: DailyMission): Promise<void> {
  const pool = await getPool();
  const { userId, date, ...rest } = m;
  await pool.query(
    `INSERT INTO daily_missions (user_id, date, payload, created_at)
     VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, date) DO UPDATE SET payload=EXCLUDED.payload`,
    [userId, date, JSON.stringify(rest)]
  );
}
