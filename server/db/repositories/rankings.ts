/**
 * rankings repository (Task #157 + Task #158 dual-mode)
 *
 * KV 컬렉션 'rankings' 는 RankingEntry[] 단일 배열.
 * Postgres 는 ranking_type/organization_id/user_id 컬럼 + payload JSONB 로 정규화.
 */
import type { RankingEntry, RankingType } from '@noilink/shared';
import {
  getPool, isPostgresBackend, kvGetCollection, kvSetCollection,
} from './util.js';

const KV = 'rankings';

function rowToEntry(row: any): RankingEntry | null {
  if (!row) return null;
  return row.payload as RankingEntry;
}

export async function listRankings(opts: {
  rankingType?: RankingType;
  organizationId?: string;
  userId?: string;
} = {}): Promise<RankingEntry[]> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<RankingEntry>(KV);
    return all.filter((e) => {
      if (opts.rankingType && e.rankingType !== opts.rankingType) return false;
      if (opts.organizationId && (e as any).organizationId !== opts.organizationId) return false;
      if (opts.userId && (e as any).userId !== opts.userId) return false;
      return true;
    });
  }
  const pool = await getPool();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.rankingType) { params.push(opts.rankingType); where.push(`ranking_type = $${params.length}`); }
  if (opts.organizationId) { params.push(opts.organizationId); where.push(`organization_id = $${params.length}`); }
  if (opts.userId) { params.push(opts.userId); where.push(`user_id = $${params.length}`); }
  const { rows } = await pool.query(
    `SELECT payload FROM rankings ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY rank ASC NULLS LAST, score DESC NULLS LAST`, params
  );
  return rows.map((r) => rowToEntry(r)!).filter(Boolean);
}

export async function replaceAllRankings(entries: RankingEntry[]): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvSetCollection(KV, entries);
    return;
  }
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM rankings');
    for (const e of entries) {
      await client.query(
        `INSERT INTO rankings (id, user_id, organization_id, ranking_type, score, rank, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CURRENT_TIMESTAMP)`,
        [
          (e as any).id ?? `${e.rankingType}_${(e as any).userId ?? 'unknown'}_${e.rank ?? 0}`,
          (e as any).userId ?? null,
          (e as any).organizationId ?? null,
          e.rankingType ?? null,
          (e as any).score ?? null,
          e.rank ?? null,
          JSON.stringify(e),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function clearRankings(): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvSetCollection(KV, []);
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM rankings`);
}
