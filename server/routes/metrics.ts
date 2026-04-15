/**
 * Metrics API 라우트
 * 원시 메트릭 및 점수 관리
 */

import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { calculateAllMetrics } from '../services/score-calculator.js';
import { generateAndSavePersonalReport } from '../services/personal-report.js';
import type { RawMetrics, MetricsScore, Session, User } from '@noilink/shared';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { userCanActOnTargetUserId } from '../utils/session-user-policy.js';

const router = Router();

async function assertActorForRawMetrics(
  authReq: AuthRequest,
  rawMetrics: RawMetrics
): Promise<{ status: number; error: string } | null> {
  if (!authReq.user) {
    return { status: 401, error: 'Authentication required' };
  }
  const users: User[] = (await db.get('users')) || [];
  if (!userCanActOnTargetUserId(authReq.user, rawMetrics.userId, users)) {
    return { status: 403, error: 'Forbidden' };
  }
  const sessions: Session[] = (await db.get('sessions')) || [];
  const session = sessions.find((s) => s.id === rawMetrics.sessionId);
  if (!session) {
    return { status: 404, error: 'Session not found' };
  }
  if (session.userId !== rawMetrics.userId) {
    return { status: 400, error: 'userId does not match session' };
  }
  return null;
}

/**
 * POST /api/metrics/raw
 * 원시 메트릭 저장
 */
router.post('/raw', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const rawMetrics: RawMetrics = req.body;
    
    if (!rawMetrics.sessionId || !rawMetrics.userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sessionId, userId',
      });
    }

    const denied = await assertActorForRawMetrics(authReq, rawMetrics);
    if (denied) {
      return res.status(denied.status).json({ success: false, error: denied.error });
    }
    
    rawMetrics.createdAt = rawMetrics.createdAt || new Date().toISOString();
    
    const rawMetricsList = await db.get('rawMetrics') || [];
    rawMetricsList.push(rawMetrics);
    await db.set('rawMetrics', rawMetricsList);
    
    res.status(201).json({ success: true, data: rawMetrics });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/metrics/calculate
 * 원시 메트릭으로부터 점수 계산
 */
router.post('/calculate', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const rawMetrics: RawMetrics = req.body;
    
    if (!rawMetrics.sessionId || !rawMetrics.userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sessionId, userId',
      });
    }

    const denied = await assertActorForRawMetrics(authReq, rawMetrics);
    if (denied) {
      return res.status(denied.status).json({ success: false, error: denied.error });
    }
    
    // 점수 계산
    const metricsScore = await calculateAllMetrics(rawMetrics);
    
    // 원시 메트릭 저장
    rawMetrics.createdAt = rawMetrics.createdAt || new Date().toISOString();
    const rawMetricsList = await db.get('rawMetrics') || [];
    rawMetricsList.push(rawMetrics);
    await db.set('rawMetrics', rawMetricsList);
    
    // 점수 저장
    const metricsScores = await db.get('metricsScores') || [];
    metricsScores.push(metricsScore);
    await db.set('metricsScores', metricsScores);
    
    // 세션 점수 업데이트
    const sessions = await db.get('sessions') || [];
    const sessionIndex = sessions.findIndex((s: any) => s.id === rawMetrics.sessionId);
    if (sessionIndex !== -1) {
      // 종합 점수 계산 (6대 지표 평균)
      const scores = [
        metricsScore.memory,
        metricsScore.comprehension,
        metricsScore.focus,
        metricsScore.judgment,
        metricsScore.agility,
        metricsScore.endurance,
      ].filter((s): s is number => s !== undefined);
      
      if (scores.length > 0) {
        const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
        sessions[sessionIndex].score = Math.round(avgScore);
      }
      
      await db.set('sessions', sessions);
    }

    void generateAndSavePersonalReport(rawMetrics.userId);
    
    res.status(201).json({ success: true, data: metricsScore });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/metrics/session/:sessionId
 * 세션별 메트릭 조회
 */
router.get('/session/:sessionId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { sessionId } = req.params;

    const sessions: Session[] = (await db.get('sessions')) || [];
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    const users: User[] = (await db.get('users')) || [];
    if (!userCanActOnTargetUserId(authReq.user, session.userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    const rawMetricsList = await db.get('rawMetrics') || [];
    const metricsScores = await db.get('metricsScores') || [];
    
    const rawMetrics = rawMetricsList.find((m: RawMetrics) => m.sessionId === sessionId);
    const metricsScore = metricsScores.find((m: MetricsScore) => m.sessionId === sessionId);
    
    res.json({
      success: true,
      data: {
        raw: rawMetrics || null,
        score: metricsScore || null,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/metrics/user/:userId
 * 사용자별 메트릭 조회
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
    const { limit = 50 } = req.query;
    
    const metricsScores = await db.get('metricsScores') || [];
    const userScores = metricsScores
      .filter((m: MetricsScore) => m.userId === userId)
      .sort((a: MetricsScore, b: MetricsScore) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, Number(limit));
    
    res.json({ success: true, data: userScores });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
