/**
 * Home API 라우트
 * 홈 화면 데이터 (컨디션, 미션, 추천 트레이닝, 배너)
 */

import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import type { DailyCondition, DailyMission, Session, MetricsScore, User } from '@noilink/shared';

const router = Router();

/**
 * GET /api/home/condition/:userId
 * 오늘의 컨디션 조회
 */
router.get('/condition/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    
    // 오늘의 컨디션 조회
    const conditions = await db.get('dailyConditions') || [];
    let condition = conditions.find((c: DailyCondition) => 
      c.userId === userId && c.date === today
    );
    
    if (!condition) {
      // 최근 3회 트레이닝 데이터로 계산
      const sessions = await db.get('sessions') || [];
      const recentSessions = sessions
        .filter((s: Session) => s.userId === userId && s.isValid)
        .sort((a: Session, b: Session) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 3);
      
      if (recentSessions.length === 0) {
        // 데이터가 없을 때 기본 컨디션 반환
        condition = {
          userId,
          date: today,
          score: 70,
          badge: 'NORMAL',
          avgReactionTime: 0,
          avgAccuracy: 0,
          errorCount: 0,
          duration: 0,
          calculatedAt: new Date().toISOString(),
        };
        conditions.push(condition);
        await db.set('dailyConditions', conditions);
        return res.json({ success: true, data: condition });
      }
      
      const metricsScores = await db.get('metricsScores') || [];
      const recentScores = recentSessions
        .map((s: Session) => metricsScores.find((m: MetricsScore) => m.sessionId === s.id))
        .filter((m: MetricsScore | undefined): m is MetricsScore => m !== undefined);
      
      // 컨디션 점수 계산
      const avgRT = recentSessions.reduce((sum: number, s: Session) => sum + (s.duration || 0), 0) / recentSessions.length;
      const avgAcc = recentScores.length > 0
        ? recentScores.reduce((sum: number, m: MetricsScore) => {
            const scores = [
              m.memory, m.comprehension, m.focus,
              m.judgment, m.agility, m.endurance,
            ].filter((s): s is number => s !== undefined);
            return sum + (scores.reduce((a, b) => a + b, 0) / scores.length);
          }, 0) / recentScores.length
        : 0;
      
      const conditionScore = Math.min(100, Math.max(0,
        (avgRT / 1000 * 0.3) + (avgAcc * 0.4) + (recentSessions.length * 10 * 0.2)
      ));
      
      let badge: 'EXCELLENT' | 'GOOD' | 'NORMAL' | 'POOR';
      if (conditionScore >= 80) badge = 'EXCELLENT';
      else if (conditionScore >= 60) badge = 'GOOD';
      else if (conditionScore >= 40) badge = 'NORMAL';
      else badge = 'POOR';
      
      condition = {
        userId,
        date: today,
        score: Math.round(conditionScore),
        badge,
        avgReactionTime: avgRT,
        avgAccuracy: avgAcc,
        errorCount: 0, // TODO: 실제 오류 횟수 계산
        duration: recentSessions.reduce((sum: number, s: Session) => sum + s.duration, 0),
        calculatedAt: new Date().toISOString(),
      };
      
      conditions.push(condition);
      await db.set('dailyConditions', conditions);
    }
    
    res.json({ success: true, data: condition });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/home/mission/:userId
 * 오늘의 미션 조회
 */
router.get('/mission/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    
    // 오늘의 미션 조회
    const missions = await db.get('dailyMissions') || [];
    let mission = missions.find((m: DailyMission) => 
      m.userId === userId && m.date === today
    );
    
    if (!mission) {
      // 최근 세션 데이터로 미션 생성
      const sessions = await db.get('sessions') || [];
      const recentSessions = sessions
        .filter((s: Session) => s.userId === userId && s.isValid)
        .sort((a: Session, b: Session) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 5);
      
      const avgBPM = recentSessions.length > 0
        ? recentSessions.reduce((sum: number, s: Session) => sum + s.bpm, 0) / recentSessions.length
        : 80;
      
      const metricsScores = await db.get('metricsScores') || [];
      const recentScores = recentSessions
        .map((s: Session) => metricsScores.find((m: MetricsScore) => m.sessionId === s.id))
        .filter((m: MetricsScore | undefined): m is MetricsScore => m !== undefined);
      
      const avgAccuracy = recentScores.length > 0
        ? recentScores.reduce((sum: number, m: MetricsScore) => {
            const scores = [
              m.memory, m.comprehension, m.focus,
              m.judgment, m.agility, m.endurance,
            ].filter((s): s is number => s !== undefined);
            return sum + (scores.reduce((a, b) => a + b, 0) / scores.length);
          }, 0) / recentScores.length
        : 70;
      
      const targetBPM = Math.max(60, Math.min(120, avgBPM + 10));
      const targetAccuracy = Math.min(100, Math.round(avgAccuracy + 5));
      
      mission = {
        userId,
        date: today,
        targetBPM,
        targetAccuracy,
        description: `오늘은 ${targetBPM}BPM에서 정확도 ${targetAccuracy}% 달성해보기`,
        createdAt: new Date().toISOString(),
      };
      
      missions.push(mission);
      await db.set('dailyMissions', missions);
    }
    
    res.json({ success: true, data: mission });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/home/quickstart/:userId
 * AI 맞춤 트레이닝 추천
 */
router.get('/quickstart/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    // 사용자 정보 조회
    const users = await db.get('users') || [];
    const user = users.find((u: User) => u.id === userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // 최근 7일 6대 지표 평균 계산
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const sessions = await db.get('sessions') || [];
    const recentSessions = sessions
      .filter((s: Session) => 
        s.userId === userId && 
        s.isValid &&
        new Date(s.createdAt).getTime() >= sevenDaysAgo.getTime()
      );
    
    const metricsScores = await db.get('metricsScores') || [];
    const recentScores = recentSessions
      .map((s: Session) => metricsScores.find((m: MetricsScore) => m.sessionId === s.id))
      .filter((m: MetricsScore | undefined): m is MetricsScore => m !== undefined);
    
    if (recentScores.length === 0) {
      return res.json({
        success: true,
        data: {
          recommendedMode: 'COMPOSITE',
          recommendedBPM: 80,
          recommendedLevel: 3,
          reason: '데이터가 부족하여 종합 트레이닝을 추천합니다.',
        },
      });
    }
    
    // 최저 지표 찾기
    const metrics = [
      { mode: 'MEMORY', score: 0 },
      { mode: 'COMPREHENSION', score: 0 },
      { mode: 'FOCUS', score: 0 },
      { mode: 'JUDGMENT', score: 0 },
      { mode: 'AGILITY', score: 0 },
      { mode: 'ENDURANCE', score: 0 },
    ];
    
    for (const score of recentScores) {
      if (score.memory) metrics[0].score += score.memory;
      if (score.comprehension) metrics[1].score += score.comprehension;
      if (score.focus) metrics[2].score += score.focus;
      if (score.judgment) metrics[3].score += score.judgment;
      if (score.agility) metrics[4].score += score.agility;
      if (score.endurance) metrics[5].score += score.endurance;
    }
    
    const avgMetrics = metrics.map(m => ({
      ...m,
      score: m.score / recentScores.length,
    }));
    
    const weakest = avgMetrics.reduce((min, curr) => 
      curr.score < min.score ? curr : min
    );
    
    // 최근 3회 컨디션 변화율 계산 (피로도)
    const recentSessions3 = recentSessions.slice(0, 3);
    const fatigueLevel = recentSessions3.length >= 2
      ? Math.abs((recentSessions3[0].score || 0) - (recentSessions3[recentSessions3.length - 1].score || 0))
      : 0;
    
    const recommendedBPM = fatigueLevel > 10 ? 75 : 85;
    const recommendedLevel: 1 | 2 | 3 | 4 | 5 = fatigueLevel > 10 ? 2 : 4;
    
    res.json({
      success: true,
      data: {
        recommendedMode: weakest.mode,
        recommendedBPM,
        recommendedLevel,
        reason: `최근 ${weakest.mode} 지표가 가장 낮아 집중 훈련을 추천합니다.`,
        weakestMetric: weakest.mode,
        weakestScore: Math.round(weakest.score),
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
 * GET /api/home/banners
 * 홈 화면 배너 목록 조회 (일반 유저용)
 */
router.get('/banners', async (req: Request, res: Response) => {
  try {
    const banners = await db.get('banners') || [];
    // order 순서로 정렬
    const sortedBanners = banners.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    res.json({ success: true, data: sortedBanners });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
