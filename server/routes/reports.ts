/**
 * Reports API 라우트
 * 리포트 생성 및 조회
 */

import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { determineBrainimalType } from '../services/brainimal-detector.js';
import { generateReport } from '../services/report-generator.js';
import type { Report, MetricsScore, Session } from '@noilink/shared';

const router = Router();

/**
 * POST /api/reports/generate
 * 리포트 생성
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: userId',
      });
    }
    
    // 사용자 정보 조회
    const users = await db.get('users') || [];
    const user = users.find((u: any) => u.id === userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // 최근 5회 유효 종합 트레이닝 세션 조회
    const sessions = await db.get('sessions') || [];
    const userSessions = sessions
      .filter((s: Session) => s.userId === userId && s.isComposite && s.isValid)
      .sort((a: Session, b: Session) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 5);
    
    if (userSessions.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient data: Need at least 3 valid composite sessions',
      });
    }
    
    // 메트릭 점수 조회
    const metricsScores = await db.get('metricsScores') || [];
    const recentScores = userSessions
      .map((s: Session) => metricsScores.find((m: MetricsScore) => m.sessionId === s.id))
      .filter((m: MetricsScore | undefined): m is MetricsScore => m !== undefined);
    
    if (recentScores.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient metrics data',
      });
    }
    
    // 브레이니멀 타입 결정
    const { type: brainimalType, confidence } = determineBrainimalType(recentScores);
    if (!brainimalType) {
      return res.status(400).json({
        success: false,
        error: 'Unable to determine brainimal type',
      });
    }
    
    // 리포트 버전 계산 (종합 훈련 횟수)
    const reportVersion = userSessions.length;
    
    // 최신 메트릭 점수 사용
    const latestMetrics = recentScores[0];
    
    // 리포트 생성
    const report = generateReport(
      userId,
      user.name,
      reportVersion,
      brainimalType,
      latestMetrics,
      confidence
    );
    
    // 리포트 저장
    const reports = await db.get('reports') || [];
    reports.push(report);
    await db.set('reports', reports);
    
    // 사용자 브레이니멀 타입 업데이트
    const userIndex = users.findIndex((u: any) => u.id === userId);
    if (userIndex !== -1) {
      users[userIndex].brainimalType = brainimalType;
      users[userIndex].brainimalConfidence = confidence;
      await db.set('users', users);
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
 * GET /api/reports/user/:userId
 * 사용자별 리포트 조회
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { limit = 10 } = req.query;
    
    const reports = await db.get('reports') || [];
    const userReports = reports
      .filter((r: Report) => r.userId === userId)
      .sort((a: Report, b: Report) => 
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
router.get('/:reportId', async (req: Request, res: Response) => {
  try {
    const { reportId } = req.params;
    const reports = await db.get('reports') || [];
    const report = reports.find((r: Report) => r.id === reportId);
    
    if (!report) {
      return res.status(404).json({ success: false, error: 'Report not found' });
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
