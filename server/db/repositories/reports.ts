/**
 * reports / org_insight_reports repository (Task #157 + Task #158 dual-mode)
 */
import type { Report, OrganizationInsightReport } from '@noilink/shared';
import {
  getPool, isPostgresBackend, kvGetCollection, kvSetCollection,
} from './util.js';

const KV_REPORTS = 'reports';
const KV_ORG = 'organizationInsightReports';

const REPORT_COLS = `id, user_id, report_version, brainimal_type, confidence, payload, created_at`;

function rowToReport(row: any): Report | null {
  if (!row) return null;
  const payload = row.payload ?? {};
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
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
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Report>(KV_REPORTS);
    const mine = all.filter((r) => r.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return mine[0] ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${REPORT_COLS} FROM reports
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]
  );
  return rowToReport(rows[0]);
}

export async function findReportById(reportId: string): Promise<Report | null> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Report>(KV_REPORTS);
    return all.find((r) => r.id === reportId) ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT ${REPORT_COLS} FROM reports WHERE id = $1 LIMIT 1`, [reportId]
  );
  return rowToReport(rows[0]);
}

export async function listReportsByUser(
  userId: string, opts: { limit?: number } = {}
): Promise<Report[]> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Report>(KV_REPORTS);
    let mine = all.filter((r) => r.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    if (opts.limit) mine = mine.slice(0, Math.max(1, Math.floor(opts.limit)));
    return mine;
  }
  const pool = await getPool();
  const limit = opts.limit !== undefined ? `LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
  const { rows } = await pool.query(
    `SELECT ${REPORT_COLS} FROM reports
     WHERE user_id = $1 ORDER BY created_at DESC ${limit}`, [userId]
  );
  return rows.map((r) => rowToReport(r)!).filter(Boolean);
}

export async function insertReport(report: Report): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Report>(KV_REPORTS);
    all.push(report);
    await kvSetCollection(KV_REPORTS, all);
    return;
  }
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
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
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
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<OrganizationInsightReport>(KV_ORG);
    const mine = all.filter((r) => r.organizationId === organizationId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return mine[0] ?? null;
  }
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT id, organization_id, payload, created_at FROM org_insight_reports
     WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, [organizationId]
  );
  return rowToOrgInsight(rows[0]);
}

export async function deleteReportsByUser(userId: string): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<Report>(KV_REPORTS);
    await kvSetCollection(KV_REPORTS, all.filter((r) => r.userId !== userId));
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM reports WHERE user_id = $1`, [userId]);
}

export async function deleteAllReports(): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvSetCollection(KV_REPORTS, []);
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM reports`);
}

export async function countAllReports(): Promise<number> {
  if (!(await isPostgresBackend())) {
    return (await kvGetCollection<Report>(KV_REPORTS)).length;
  }
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM reports`);
  return rows[0]?.n ?? 0;
}

export async function deleteAllOrgInsightReports(): Promise<void> {
  if (!(await isPostgresBackend())) {
    await kvSetCollection(KV_ORG, []);
    return;
  }
  const pool = await getPool();
  await pool.query(`DELETE FROM org_insight_reports`);
}

export async function countAllOrgInsightReports(): Promise<number> {
  if (!(await isPostgresBackend())) {
    return (await kvGetCollection<OrganizationInsightReport>(KV_ORG)).length;
  }
  const pool = await getPool();
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM org_insight_reports`);
  return rows[0]?.n ?? 0;
}

export async function insertOrgInsightReport(report: OrganizationInsightReport): Promise<void> {
  if (!(await isPostgresBackend())) {
    const all = await kvGetCollection<OrganizationInsightReport>(KV_ORG);
    all.push(report);
    await kvSetCollection(KV_ORG, all);
    return;
  }
  const pool = await getPool();
  const { id, organizationId, createdAt, ...rest } = report;
  await pool.query(
    `INSERT INTO org_insight_reports (id, organization_id, payload, created_at)
     VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload`,
    [id, organizationId, JSON.stringify(rest), createdAt]
  );
}
