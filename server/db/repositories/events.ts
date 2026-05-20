/**
 * ble_abort_events / ack_banner_events / inquiries repository (Task #157 + Task #158 dual-mode)
 */
import {
  getPool, isPostgresBackend, kvGetCollection, kvSetCollection,
} from './util.js';

export interface GenericEvent {
  id: string;
  userId?: string;
  sessionId?: string;
  createdAt: string;
  [key: string]: unknown;
}

type EventTable = 'ble_abort_events' | 'ack_banner_events' | 'inquiries';

const KV_BY_TABLE: Record<EventTable, string> = {
  ble_abort_events: 'bleAbortEvents',
  ack_banner_events: 'ackBannerEvents',
  inquiries: 'inquiries',
};

function rowToEvent(row: any): GenericEvent | null {
  if (!row) return null;
  const payload = row.payload ?? {};
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  return {
    ...payload,
    id: row.id,
    userId: row.user_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    createdAt,
  } as GenericEvent;
}

async function listEvents(
  table: EventTable,
  opts: { userId?: string; limit?: number; sinceCreatedAt?: string } = {}
): Promise<GenericEvent[]> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<any>(KV_BY_TABLE[table]);
    let filtered = all.filter((e) =>
      (!opts.userId || e.userId === opts.userId) &&
      (!opts.sinceCreatedAt || new Date(e.createdAt ?? e.occurredAt ?? 0).getTime() >= new Date(opts.sinceCreatedAt).getTime())
    );
    filtered.sort((a, b) => new Date(b.createdAt ?? b.occurredAt ?? 0).getTime() - new Date(a.createdAt ?? a.occurredAt ?? 0).getTime());
    if (opts.limit) filtered = filtered.slice(0, Math.max(1, Math.floor(opts.limit)));
    return filtered;
  }
  const pool = await getPool();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.userId) { params.push(opts.userId); where.push(`user_id = $${params.length}`); }
  if (opts.sinceCreatedAt) { params.push(opts.sinceCreatedAt); where.push(`created_at >= $${params.length}`); }
  const limit = opts.limit !== undefined ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const { rows } = await pool.query(
    `SELECT id, user_id, session_id, payload, created_at FROM ${table}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC ${limit}`, params
  );
  return rows.map((r) => rowToEvent(r)!).filter(Boolean);
}

async function insertEvent(table: EventTable, ev: GenericEvent): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<any>(KV_BY_TABLE[table]);
    all.push(ev);
    await kvSetCollection(KV_BY_TABLE[table], all);
    return;
  }
  const pool = await getPool();
  const { id, userId, sessionId, createdAt, ...rest } = ev;
  await pool.query(
    `INSERT INTO ${table} (id, user_id, session_id, payload, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload`,
    [id, userId ?? null, sessionId ?? null, JSON.stringify(rest), createdAt]
  );
}

async function deleteAllEvents(table: EventTable): Promise<void> {
  if (!(await isPostgresBackend())) { await kvSetCollection(KV_BY_TABLE[table], []); return; }
  const pool = await getPool();
  await pool.query(`DELETE FROM ${table}`);
}

async function deleteEventsByUser(table: EventTable, userId: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<any>(KV_BY_TABLE[table]);
    await kvSetCollection(KV_BY_TABLE[table], all.filter((e) => e.userId !== userId));
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
}

async function countAllEvents(table: EventTable): Promise<number> {
  if (!(await isPostgresBackend())) {
    return (await kvGetCollection<any>(KV_BY_TABLE[table])).length;
  }
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0]?.n ?? 0;
}

async function deleteEventById(table: EventTable, id: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<any>(KV_BY_TABLE[table]);
    await kvSetCollection(KV_BY_TABLE[table], all.filter((e) => e.id !== id));
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

async function findEventById(table: EventTable, id: string): Promise<GenericEvent | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<any>(KV_BY_TABLE[table]);
    return all.find((e) => e.id === id) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT id, user_id, session_id, payload, created_at FROM ${table} WHERE id = $1 LIMIT 1`, [id]
  );
  return rowToEvent(rows[0]);
}

export const listBleAbortEvents = (opts?: Parameters<typeof listEvents>[1]) => listEvents('ble_abort_events', opts);
export const insertBleAbortEvent = (ev: GenericEvent) => insertEvent('ble_abort_events', ev);
export const deleteAllBleAbortEvents = () => deleteAllEvents('ble_abort_events');
export const countBleAbortEvents = () => countAllEvents('ble_abort_events');

export const listAckBannerEvents = (opts?: Parameters<typeof listEvents>[1]) => listEvents('ack_banner_events', opts);
export const insertAckBannerEvent = (ev: GenericEvent) => insertEvent('ack_banner_events', ev);
export const deleteAllAckBannerEvents = () => deleteAllEvents('ack_banner_events');
export const countAckBannerEvents = () => countAllEvents('ack_banner_events');

export const listInquiries = (opts?: Parameters<typeof listEvents>[1]) => listEvents('inquiries', opts);
export const insertInquiry = (ev: GenericEvent) => insertEvent('inquiries', ev);
export const deleteInquiriesByUser = (userId: string) => deleteEventsByUser('inquiries', userId);
export const deleteInquiry = (id: string) => deleteEventById('inquiries', id);
export const findInquiry = (id: string) => findEventById('inquiries', id);
