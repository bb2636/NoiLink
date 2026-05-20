/**
 * terms repository (Task #157)
 */
import type { Terms, TermsType } from '@noilink/shared';
import { getPool, rowToCamel } from './util.js';

const COLS = `id, type, title, content, version, is_required, is_active, created_at, updated_at, created_by`;

function rowToTerms(row: any): Terms | null {
  if (!row) return null;
  const c = rowToCamel<any>(row)!;
  if (c.createdAt instanceof Date) c.createdAt = c.createdAt.toISOString();
  if (c.updatedAt instanceof Date) c.updatedAt = c.updatedAt.toISOString();
  return c as Terms;
}

export async function findTermsById(id: string): Promise<Terms | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM terms WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rowToTerms(rows[0]);
}

export async function listTermsByType(
  type: TermsType,
  opts: { activeOnly?: boolean } = {}
): Promise<Terms[]> {
  const pool = await getPool();
  const where = opts.activeOnly ? 'type = $1 AND is_active = TRUE' : 'type = $1';
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM terms WHERE ${where} ORDER BY version DESC`,
    [type]
  );
  return rows.map((r) => rowToTerms(r)!).filter(Boolean);
}

export async function listAllTerms(): Promise<Terms[]> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${COLS} FROM terms ORDER BY type, version DESC`
  );
  return rows.map((r) => rowToTerms(r)!).filter(Boolean);
}

export async function upsertTerms(t: Terms): Promise<void> {
  const pool = await getPool();
  await pool.query(
    `INSERT INTO terms (id, type, title, content, version, is_required, is_active, created_at, updated_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET
       type=EXCLUDED.type, title=EXCLUDED.title, content=EXCLUDED.content,
       version=EXCLUDED.version, is_required=EXCLUDED.is_required,
       is_active=EXCLUDED.is_active, updated_at=EXCLUDED.updated_at,
       created_by=EXCLUDED.created_by`,
    [
      t.id, t.type, t.title, t.content, t.version,
      t.isRequired ?? true, t.isActive ?? true,
      t.createdAt, t.updatedAt ?? null, t.createdBy ?? null,
    ]
  );
}

export async function deleteTerms(id: string): Promise<void> {
  const pool = await getPool();
  await pool.query(`DELETE FROM terms WHERE id = $1`, [id]);
}
