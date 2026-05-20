/**
 * ble_abort_events / ack_banner_events / inquiries repository (Task #157)
 */
import { getPool } from './util.js';

export interface GenericEvent {
  id: string;
  userId?: string;
  sessionId?: string;
  createdAt: string;
  [key: string]: unknown;
}

function rowToEvent(row: any): GenericEvent | null {
  if (!row) return null;
  const payload = row.payload ?? {};
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  return {
    ...payload,
    id: row.id,
    userId: row.user_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    createdAt,
  } as GenericEvent;
}

type EventTable = 'ble_abort_events' | 'ack_banner_events' | 'inquiries';

async function listEvents(
  table: EventTable,
  opts: { userId?: string; limit?: number; sinceCreatedAt?: string } = {}
): Promise<GenericEvent[]> {
  const pool = await getPool();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.userId) {
    params.push(opts.userId);
    where.push(`user_id = $${params.length}`);
  }
  if (opts.sinceCreatedAt) {
    params.push(opts.sinceCreatedAt);
    where.push(`created_at >= $${params.length}`);
  }
  const limit = opts.limit !== undefined ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const { rows } = await pool.query(
    `SELECT id, user_id, session_id, payload, created_at FROM ${table}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC ${limit}`,
    params
  );
  return rows.map((r) => rowToEvent(r)!).filter(Boolean);
}

async function insertEvent(table: EventTable, ev: GenericEvent): Promise<void> {
  const pool = await getPool();
  const { id, userId, sessionId, createdAt, ...rest } = ev;
  await pool.query(
    `INSERT INTO ${table} (id, user_id, session_id, payload, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload`,
    [id, userId ?? null, sessionId ?? null, JSON.stringify(rest), createdAt]
  );
}

export const listBleAbortEvents = (opts?: Parameters<typeof listEvents>[1]) =>
  listEvents('ble_abort_events', opts);
export const insertBleAbortEvent = (ev: GenericEvent) => insertEvent('ble_abort_events', ev);

export const listAckBannerEvents = (opts?: Parameters<typeof listEvents>[1]) =>
  listEvents('ack_banner_events', opts);
export const insertAckBannerEvent = (ev: GenericEvent) => insertEvent('ack_banner_events', ev);

export const listInquiries = (opts?: Parameters<typeof listEvents>[1]) =>
  listEvents('inquiries', opts);
export const insertInquiry = (ev: GenericEvent) => insertEvent('inquiries', ev);
