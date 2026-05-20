/**
 * reports / org_insight_reports repository (Task #157)
 */
import type { Report, OrganizationInsightReport, BrainimalType } from '@noilink/shared';
import { getPool } from './util.js';

const REPORT_COLS = `id, user_id, report_version, brainimal_type, confidence, payload, created_at`;

function rowToReport(row: any): Report | null {
  if (!row) return null;
  const payload = row.payload ?? {};
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  // payload 에는 분리 보관된 컬럼이 들어있지 않으므로 별도로 머지.
  return {
    ...payload,
    id: row.id,
    userId: row.user_id,
    reportVersion: row.report_version ?? payload.reportVersion,
    brainimalType: row.brainimal_type ?? payload.brainimalType,
    confidence: row.confidence ?? payload.confidence,
    createdAt,
  } as Report;
}

export async function findLatestReportByUser(userId: string): Promise<Report | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${REPORT_COLS} FROM reports
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return rowToReport(rows[0]);
}

export async function listReportsByUser(
  userId: string,
  opts: { limit?: number } = {}
): Promise<Report[]> {
  const pool = await getPool();
  const limit = opts.limit !== undefined ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const { rows } = await pool.query(
    `SELECT ${REPORT_COLS} FROM reports
     WHERE user_id = $1 ORDER BY created_at DESC ${limit}`,
    [userId]
  );
  return rows.map((r) => rowToReport(r)!).filter(Boolean);
}

export async function insertReport(report: Report): Promise<void> {
  const pool = await getPool();
  const { id, userId, reportVersion, brainimalType, confidence, createdAt, ...rest } = report;
  await pool.query(
    `INSERT INTO reports (id, user_id, report_version, brainimal_type, confidence, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (id) DO UPDATE SET
       report_version=EXCLUDED.report_version, brainimal_type=EXCLUDED.brainimal_type,
       confidence=EXCLUDED.confidence, payload=EXCLUDED.payload`,
    [
      id, userId, reportVersion ?? null, brainimalType ?? null, confidence ?? null,
      JSON.stringify(rest), createdAt,
    ]
  );
}

function rowToOrgInsight(row: any): OrganizationInsightReport | null {
  if (!row) return null;
  const payload = row.payload ?? {};
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
  return {
    ...payload,
    id: row.id,
    organizationId: row.organization_id,
    createdAt,
  } as OrganizationInsightReport;
}

export async function findLatestOrgInsightReport(
  organizationId: string
): Promise<OrganizationInsightReport | null> {
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT id, organization_id, payload, created_at FROM org_insight_reports
     WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [organizationId]
  );
  return rowToOrgInsight(rows[0]);
}

export async function insertOrgInsightReport(
  report: OrganizationInsightReport
): Promise<void> {
  const pool = await getPool();
  const { id, organizationId, createdAt, ...rest } = report;
  await pool.query(
    `INSERT INTO org_insight_reports (id, organization_id, payload, created_at)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload`,
    [id, organizationId, JSON.stringify(rest), createdAt]
  );
}
