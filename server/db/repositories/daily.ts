/**
 * daily_conditions / daily_missions repository (Task #157 + Task #158 dual-mode)
 */
import type { DailyCondition, DailyMission } from '@noilink/shared';
import {
  getPool, isPostgresBackend, kvGetCollection, kvSetCollection, kvUpsert,
} from './util.js';

const KV_COND = 'dailyConditions';
const KV_MISS = 'dailyMissions';

function rowToCondition(row: any): DailyCondition | null {
  if (!row) return null;
  const payload = row.payload ?? {};
  return { ...payload, userId: row.user_id, date: row.date } as DailyCondition;
}

export async function findDailyCondition(
  userId: string, date: string
): Promise<DailyCondition | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<DailyCondition>(KV_COND);
    return all.find((c) => c.userId === userId && c.date === date) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT user_id, date, payload FROM daily_conditions WHERE user_id = $1 AND date = $2 LIMIT 1`,
    [userId, date]
  );
  return rowToCondition(rows[0]);
}

export async function listDailyConditionsByUser(
  userId: string, opts: { sinceDate?: string; limit?: number } = {}
): Promise<DailyCondition[]> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<DailyCondition>(KV_COND);
    let mine = all.filter((c) => c.userId === userId
      && (!opts.sinceDate || c.date >= opts.sinceDate));
    mine.sort((a, b) => (a.date < b.date ? 1 : -1));
    if (opts.limit) mine = mine.slice(0, Math.max(1, Math.floor(opts.limit)));
    return mine;
  }
  const pool = await getPool();
  const where: string[] = ['user_id = $1'];
  const params: any[] = [userId];
  if (opts.sinceDate) { params.push(opts.sinceDate); where.push(`date >= $${params.length}`); }
  const limit = opts.limit !== undefined ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const { rows } = await pool.query(
    `SELECT user_id, date, payload FROM daily_conditions
     WHERE ${where.join(' AND ')} ORDER BY date DESC ${limit}`, params
  );
  return rows.map((r) => rowToCondition(r)!).filter(Boolean);
}

export async function upsertDailyCondition(c: DailyCondition): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvUpsert<DailyCondition>(KV_COND, c, (x) => x.userId === c.userId && x.date === c.date);
    return;
  }
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
  userId: string, date: string
): Promise<DailyMission | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<DailyMission>(KV_MISS);
    return all.find((m) => m.userId === userId && m.date === date) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT user_id, date, payload FROM daily_missions WHERE user_id = $1 AND date = $2 LIMIT 1`,
    [userId, date]
  );
  return rowToMission(rows[0]);
}

export async function deleteDailyConditionsByUser(userId: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<DailyCondition>(KV_COND);
    await kvSetCollection(KV_COND, all.filter((c) => c.userId !== userId));
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM daily_conditions WHERE user_id = $1`, [userId]);
}

export async function deleteAllDailyConditions(): Promise<void> {
  if (!(await isPostgresBackend())) { await kvSetCollection(KV_COND, []); return; }
  const pool = await getPool();
  await pool.query(`DELETE FROM daily_conditions`);
}

export async function countAllDailyConditions(): Promise<number> {
  if (!(await isPostgresBackend())) {
    return (await kvGetCollection<DailyCondition>(KV_COND)).length;
  }
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM daily_conditions`);
  return rows[0]?.n ?? 0;
}

export async function deleteDailyMissionsByUser(userId: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<DailyMission>(KV_MISS);
    await kvSetCollection(KV_MISS, all.filter((m) => m.userId !== userId));
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM daily_missions WHERE user_id = $1`, [userId]);
}

export async function deleteAllDailyMissions(): Promise<void> {
  if (!(await isPostgresBackend())) { await kvSetCollection(KV_MISS, []); return; }
  const pool = await getPool();
  await pool.query(`DELETE FROM daily_missions`);
}

export async function countAllDailyMissions(): Promise<number> {
  if (!(await isPostgresBackend())) {
    return (await kvGetCollection<DailyMission>(KV_MISS)).length;
  }
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM daily_missions`);
  return rows[0]?.n ?? 0;
}

export async function upsertDailyMission(m: DailyMission): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvUpsert<DailyMission>(KV_MISS, m, (x) => x.userId === m.userId && x.date === m.date);
    return;
  }
  const pool = await getPool();
  const { userId, date, ...rest } = m;
  await pool.query(
    `INSERT INTO daily_missions (user_id, date, payload, created_at)
     VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, date) DO UPDATE SET payload=EXCLUDED.payload`,
    [userId, date, JSON.stringify(rest)]
  );
}
