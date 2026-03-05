/**
 * Metrics API 라우트
 * 원시 메트릭 및 점수 관리
 */

import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { calculateAllMetrics } from '../services/score-calculator.js';
import type { RawMetrics, MetricsScore } from '@noilink/shared';

const router = Router();

/**
 * POST /api/metrics/raw
 * 원시 메트릭 저장
 */
router.post('/raw', async (req: Request, res: Response) => {
  try {
    const rawMetrics: RawMetrics = req.body;
    
    if (!rawMetrics.sessionId || !rawMetrics.userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sessionId, userId',
      });
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
router.post('/calculate', async (req: Request, res: Response) => {
  try {
    const rawMetrics: RawMetrics = req.body;
    
    if (!rawMetrics.sessionId || !rawMetrics.userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sessionId, userId',
      });
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
router.get('/session/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    
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
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
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
