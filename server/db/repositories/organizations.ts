/**
 * organizations repository (Task #157 + Task #158 dual-mode)
 */
import type { Organization } from '@noilink/shared';
import {
  getPool, rowToCamel, isPostgresBackend,
  kvGetCollection, kvUpsert, kvDelete,
} from './util.js';

const KV = 'organizations';
const COLS = `id, name, admin_user_id, member_user_ids, created_at, updated_at, extra`;

function rowToOrg(row: any): Organization | null {
  if (!row) return null;
  const c = rowToCamel<any>(row)!;
  if (c.createdAt instanceof Date) c.createdAt = c.createdAt.toISOString();
  if (c.updatedAt instanceof Date) c.updatedAt = c.updatedAt.toISOString();
  if (!Array.isArray(c.memberUserIds)) c.memberUserIds = c.memberUserIds ?? [];
  if (c.extra && typeof c.extra === 'object') {
    const extra = c.extra;
    delete c.extra;
    return { ...extra, ...c } as Organization;
  }
  delete c.extra;
  return c as Organization;
}

export async function findOrganizationById(id: string): Promise<Organization | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Organization>(KV);
    return all.find((o) => o.id === id) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM organizations WHERE id = $1 LIMIT 1`, [id]
  );
  return rowToOrg(rows[0]);
}

export async function listOrganizations(): Promise<Organization[]> {
  if (!(await isPostgresBackend())) {
    return kvGetCollection<Organization>(KV);
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM organizations ORDER BY created_at ASC`
  );
  return rows.map((r) => rowToOrg(r)!).filter(Boolean);
}

export async function upsertOrganization(org: Organization): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvUpsert<Organization>(KV, org, (o) => o.id === org.id);
    return;
  }
  const pool = await getPool();
  const known = new Set(['id', 'name', 'adminUserId', 'memberUserIds', 'createdAt', 'updatedAt']);
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(org)) {
    if (!known.has(k)) extra[k] = (org as any)[k];
  }
  await pool.query(
    `INSERT INTO organizations (id, name, admin_user_id, member_user_ids, created_at, updated_at, extra)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, admin_user_id=EXCLUDED.admin_user_id,
       member_user_ids=EXCLUDED.member_user_ids, updated_at=EXCLUDED.updated_at,
       extra=EXCLUDED.extra`,
    [
      org.id, org.name, org.adminUserId ?? null,
      JSON.stringify(org.memberUserIds ?? []),
      org.createdAt, org.updatedAt ?? null,
      Object.keys(extra).length > 0 ? JSON.stringify(extra) : null,
    ]
  );
}

export async function deleteOrganization(id: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvDelete<Organization>(KV, (o) => o.id === id);
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [id]);
}
