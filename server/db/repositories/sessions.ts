/**
 * sessions repository (Task #157 + Task #158 dual-mode)
 */
import type { Session } from '@noilink/shared';
import {
  getPool, rowToCamel, isPostgresBackend,
  kvGetCollection, kvSetCollection, kvUpsert, kvDelete,
} from './util.js';

const KV = 'sessions';

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
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Session>(KV);
    return all.find((s) => s.id === id) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $1 LIMIT 1`, [id]
  );
  return rowToSession(rows[0]);
}

export interface ListSessionsOpts {
  userId?: string;
  isComposite?: boolean;
  isValid?: boolean;
  sinceCreatedAt?: string;
  beforeCreatedAt?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

function kvFilter(s: Session, opts: ListSessionsOpts): boolean {
  if (opts.userId !== undefined && s.userId !== opts.userId) return false;
  if (opts.isComposite !== undefined && Boolean(s.isComposite) !== opts.isComposite) return false;
  if (opts.isValid !== undefined && Boolean(s.isValid) !== opts.isValid) return false;
  if (opts.sinceCreatedAt && new Date(s.createdAt).getTime() < new Date(opts.sinceCreatedAt).getTime()) return false;
  if (opts.beforeCreatedAt && new Date(s.createdAt).getTime() >= new Date(opts.beforeCreatedAt).getTime()) return false;
  return true;
}

export async function listSessions(opts: ListSessionsOpts = {}): Promise<Session[]> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Session>(KV);
    let filtered = all.filter((s) => kvFilter(s, opts));
    const dir = opts.order === 'asc' ? 1 : -1;
    filtered.sort((a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));
    if (opts.limit !== undefined) filtered = filtered.slice(0, Math.max(1, Math.floor(opts.limit)));
    return filtered;
  }
  const pool = await getPool();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.userId !== undefined) { params.push(opts.userId); where.push(`user_id = $${params.length}`); }
  if (opts.isComposite !== undefined) { params.push(opts.isComposite); where.push(`is_composite = $${params.length}`); }
  if (opts.isValid !== undefined) { params.push(opts.isValid); where.push(`is_valid = $${params.length}`); }
  if (opts.sinceCreatedAt !== undefined) { params.push(opts.sinceCreatedAt); where.push(`created_at >= $${params.length}`); }
  if (opts.beforeCreatedAt !== undefined) { params.push(opts.beforeCreatedAt); where.push(`created_at < $${params.length}`); }
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
    userId, isComposite: true, isValid: true,
    sinceCreatedAt: opts.sinceCreatedAt, limit: opts.limit, order: 'desc',
  });
}

export async function upsertSession(s: Session): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvUpsert<Session>(KV, s, (x) => x.id === s.id);
    return;
  }
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
  if (!(await isPostgresBackend())) {
    await kvDelete<Session>(KV, (s) => s.id === id);
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [id]);
}

export async function listSessionsByUsers(
  userIds: string[],
  opts: { isComposite?: boolean; isValid?: boolean; sinceCreatedAt?: string } = {}
): Promise<Session[]> {
  if (userIds.length === 0) return [];
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Session>(KV);
    const set = new Set(userIds);
    let filtered = all.filter((s) => set.has(s.userId) && kvFilter(s, opts));
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return filtered;
  }
  const pool = await getPool();
  const params: any[] = [userIds];
  const where: string[] = [`user_id = ANY($1::text[])`];
  if (opts.isComposite !== undefined) { params.push(opts.isComposite); where.push(`is_composite = $${params.length}`); }
  if (opts.isValid !== undefined) { params.push(opts.isValid); where.push(`is_valid = $${params.length}`); }
  if (opts.sinceCreatedAt !== undefined) { params.push(opts.sinceCreatedAt); where.push(`created_at >= $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
    params
  );
  return rows.map((r) => rowToSession(r)!).filter(Boolean);
}

export async function findPreviousScoredSessionForUser(
  userId: string, excludingId: string | null
): Promise<Session | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Session>(KV);
    const filtered = all
      .filter((s) => s.userId === userId
        && s.score !== undefined && s.score !== null
        && (!excludingId || s.id !== excludingId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return filtered[0] ?? null;
  }
  const pool = await getPool();
  const params: any[] = [userId];
  let extra = '';
  if (excludingId) { params.push(excludingId); extra = `AND id <> $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT ${SESSION_COLUMNS} FROM sessions
     WHERE user_id = $1 AND score IS NOT NULL ${extra}
     ORDER BY created_at DESC LIMIT 1`, params
  );
  return rowToSession(rows[0]);
}

export async function updateSessionScore(id: string, score: number): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Session>(KV);
    const idx = all.findIndex((s) => s.id === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], score };
      await kvSetCollection(KV, all);
    }
    return;
  }
  const pool = await getPool();
  await pool.query(`UPDATE sessions SET score = $1 WHERE id = $2`, [score, id]);
}

/**
 * 합동(composite) 세션의 `meta.participantIds` 배열에서 `userId` 만 제거한다.
 * Task #162 — `deleteSessionsByUser(userId)` 가 본인이 1차 사용자(userId 컬럼)
 * 인 세션만 정리하기 때문에, 본인이 다른 사용자의 합동 세션에 보조 참여자로만
 * 등록된 케이스에서 탈퇴 후에도 식별자가 잔존하는 문제를 막는다.
 *
 * 세션 row 자체는 보존하고 배열에서 본인 id 만 splice — 다른 참여자의 결과가
 * 사라지지 않도록. 배열이 빈 배열이 되어도 row 는 유지한다 (드물지만 1인
 * 참여 합동 세션이 있을 수 있고, 본인이 1차 사용자라면 이미 별도로 row 자체가
 * 삭제됐을 것).
 */
export async function deleteCompositeParticipantByUser(userId: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Session>(KV);
    let changed = false;
    const next = all.map((s) => {
      const ids = (s.meta as any)?.participantIds;
      if (!Array.isArray(ids) || !ids.includes(userId)) return s;
      changed = true;
      const filtered = ids.filter((id: unknown) => id !== userId);
      return { ...s, meta: { ...(s.meta as any), participantIds: filtered } } as Session;
    });
    if (changed) await kvSetCollection(KV, next);
    return;
  }
  const pool = await getPool();
  // jsonb_set 으로 participantIds 배열에서 해당 userId 만 제외한 새 배열로 교체.
  // 필터 결과가 0건이면 jsonb_agg 가 NULL 을 반환하므로 COALESCE 로 빈 배열 보장.
  await pool.query(
    `UPDATE sessions
       SET meta = jsonb_set(
         meta,
         '{participantIds}',
         COALESCE(
           (SELECT jsonb_agg(elem)
              FROM jsonb_array_elements(meta->'participantIds') AS elem
              WHERE elem <> to_jsonb($1::text)),
           '[]'::jsonb
         )
       )
     WHERE meta ? 'participantIds'
       AND jsonb_typeof(meta->'participantIds') = 'array'
       AND meta->'participantIds' @> to_jsonb(ARRAY[$1::text])`,
    [userId]
  );
}

export async function deleteSessionsByUser(userId: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Session>(KV);
    await kvSetCollection(KV, all.filter((s) => s.userId !== userId));
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

export async function deleteAllSessions(): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvSetCollection(KV, []);
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM sessions`);
}

export async function countAllSessions(): Promise<number> {
  if (!(await isPostgresBackend())) {
    return (await kvGetCollection<Session>(KV)).length;
  }
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM sessions`);
  return rows[0]?.n ?? 0;
}

export async function countSessionsByUser(
  userId: string,
  opts: { isComposite?: boolean; isValid?: boolean; sinceCreatedAt?: string } = {}
): Promise<number> {
  if (!(await isPostgresBackend())) {
    const list = await listSessions({ userId, ...opts });
    return list.length;
  }
  const pool = await getPool();
  const where: string[] = ['user_id = $1'];
  const params: any[] = [userId];
  if (opts.isComposite !== undefined) { params.push(opts.isComposite); where.push(`is_composite = $${params.length}`); }
  if (opts.isValid !== undefined) { params.push(opts.isValid); where.push(`is_valid = $${params.length}`); }
  if (opts.sinceCreatedAt !== undefined) { params.push(opts.sinceCreatedAt); where.push(`created_at >= $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sessions WHERE ${where.join(' AND ')}`, params
  );
  return rows[0]?.n ?? 0;
}
