/**
 * Reports API 라우트
 * 리포트 생성 및 조회
 */

import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import type { Report, User } from '@noilink/shared';
import { generateAndSavePersonalReport } from '../services/personal-report.js';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { userCanActOnTargetUserId, canAccessOrganizationResource } from '../utils/session-user-policy.js';
import {
  generateAndSaveOrganizationInsightReport,
  getLatestOrganizationInsightReport,
} from '../services/organization-insight-report.js';

const router = Router();

/**
 * POST /api/reports/generate
 * 개인 리포트 생성
 */
router.post('/generate', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: userId',
      });
    }

    const users: User[] = (await db.get('users')) || [];
    if (!userCanActOnTargetUserId(authReq.user, userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const user = users.find((u: { id: string }) => u.id === userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const report = await generateAndSavePersonalReport(userId);
    if (!report) {
      return res.status(400).json({
        success: false,
        error:
          'Insufficient data: Need at least 3 valid composite sessions with metrics',
      });
    }

    res.status(201).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/reports/organization/generate
 * 기관 인사이트 리포트 생성
 */
router.post('/organization/generate', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { organizationId } = req.body;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: organizationId',
      });
    }
    if (!canAccessOrganizationResource(authReq.user, organizationId)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const report = await generateAndSaveOrganizationInsightReport(organizationId);
    if (!report) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient organization data or no member metrics',
      });
    }

    res.status(201).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/reports/organization/:organizationId
 * 최신 기관 리포트 (없으면 생성 시도)
 */
router.get('/organization/:organizationId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { organizationId } = req.params;
    if (!canAccessOrganizationResource(authReq.user, organizationId)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    let report = await getLatestOrganizationInsightReport(organizationId);
    if (!report) {
      report = await generateAndSaveOrganizationInsightReport(organizationId);
    }
    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'No organization report available',
      });
    }
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/reports/user/:userId
 * 사용자별 리포트 조회
 */
router.get('/user/:userId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { userId } = req.params;
    const users: User[] = (await db.get('users')) || [];
    if (!userCanActOnTargetUserId(authReq.user, userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const { limit = 10 } = req.query;

    const reports = (await db.get('reports')) || [];
    const userReports = reports
      .filter((r: Report) => r.userId === userId)
      .sort(
        (a: Report, b: Report) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, Number(limit));

    res.json({ success: true, data: userReports });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/reports/:reportId
 * 특정 리포트 조회
 */
router.get('/:reportId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { reportId } = req.params;
    const reports = (await db.get('reports')) || [];
    const report = reports.find((r: Report) => r.id === reportId);

    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    const users: User[] = (await db.get('users')) || [];
    if (!userCanActOnTargetUserId(authReq.user, report.userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
