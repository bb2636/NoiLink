/**
 * Rankings API 라우트
 * 랭킹 시스템 (3종)
 */

import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import type { RankingEntry, RankingType, Session, User } from '@noilink/shared';

const router = Router();

/**
 * 랭킹 계산 및 업데이트
 */
async function calculateRankings(): Promise<void> {
  const users = await db.get('users') || [];
  const sessions = await db.get('sessions') || [];
  const rankings: RankingEntry[] = [];
  
  const now = Date.now();
  const fourteenDaysAgo = now - (14 * 24 * 60 * 60 * 1000);
  
  for (const user of users) {
    const userSessions = sessions.filter((s: Session) => 
      s.userId === user.id &&
      new Date(s.createdAt).getTime() >= fourteenDaysAgo
    );
    
    // 1. 종합 트레이닝 점수 랭킹
    const compositeSessions = userSessions
      .filter((s: Session) => s.isComposite && s.isValid && s.score !== undefined)
      .map((s: Session) => ({
        ...s,
        weightedScore: (s.score || 0) * 1.2, // 가중치 1.2배
      }))
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, 3); // 상위 3회
    
    if (compositeSessions.length > 0) {
      const rankingScore = compositeSessions.reduce((sum, s) => sum + s.weightedScore, 0) / compositeSessions.length;
      
      rankings.push({
        userId: user.id,
        username: user.userType === 'ORGANIZATION' ? user.name : user.username,
        userType: user.userType,
        organizationId: user.organizationId,
        rankingType: 'COMPOSITE_SCORE',
        score: Math.round(rankingScore),
        rank: 0, // 나중에 정렬 후 설정
        metadata: {
          sessionCount: compositeSessions.length,
        },
        calculatedAt: new Date().toISOString(),
      });
    }
    
    // 2. 트레이닝 합계 시간 랭킹
    const totalTime = userSessions.reduce((sum: number, s: Session) => sum + s.duration, 0);
    
    if (totalTime > 0) {
      rankings.push({
        userId: user.id,
        username: user.userType === 'ORGANIZATION' ? user.name : user.username,
        userType: user.userType,
        organizationId: user.organizationId,
        rankingType: 'TOTAL_TIME',
        score: Math.round(totalTime / 1000), // ms를 초로 변환
        rank: 0,
        metadata: {
          sessionCount: userSessions.length,
        },
        calculatedAt: new Date().toISOString(),
      });
    }
    
    // 3. 연속 트레이닝(스트릭) 랭킹
    if (user.streak > 0) {
      rankings.push({
        userId: user.id,
        username: user.userType === 'ORGANIZATION' ? user.name : user.username,
        userType: user.userType,
        organizationId: user.organizationId,
        rankingType: 'STREAK',
        score: user.streak,
        rank: 0,
        metadata: {},
        calculatedAt: new Date().toISOString(),
      });
    }
  }
  
  // 랭킹 타입별로 정렬 및 순위 설정
  const rankingTypes: RankingType[] = ['COMPOSITE_SCORE', 'TOTAL_TIME', 'STREAK'];
  
  for (const type of rankingTypes) {
    const typeRankings = rankings
      .filter((r) => r.rankingType === type)
      .sort((a, b) => {
        // 점수 > 횟수/시간 > 달성 시각 (오름차순, 선착순 우대)
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return new Date(a.calculatedAt).getTime() - new Date(b.calculatedAt).getTime();
      });
    
    typeRankings.forEach((r, index) => {
      r.rank = index + 1;
    });
  }
  
  await db.set('rankings', rankings);
}

/**
 * GET /api/rankings
 * 랭킹 조회
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { type, limit = 100, organizationId } = req.query;
    
    // 랭킹 재계산
    await calculateRankings();
    
    let rankings = await db.get('rankings') || [];
    
    // 필터링
    if (type) {
      rankings = rankings.filter((r: RankingEntry) => r.rankingType === type);
    }
    if (organizationId) {
      rankings = rankings.filter((r: RankingEntry) => r.organizationId === organizationId);
    }
    
    // 타입별로 그룹화
    const grouped: Record<string, RankingEntry[]> = {};
    for (const ranking of rankings) {
      if (!grouped[ranking.rankingType]) {
        grouped[ranking.rankingType] = [];
      }
      grouped[ranking.rankingType].push(ranking);
    }
    
    // 각 타입별로 정렬
    for (const type in grouped) {
      grouped[type].sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return new Date(a.calculatedAt).getTime() - new Date(b.calculatedAt).getTime();
      });
    }
    
    // 제한 적용
    if (limit) {
      for (const type in grouped) {
        grouped[type] = grouped[type].slice(0, Number(limit));
      }
    }
    
    res.json({ success: true, data: grouped });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/rankings/user/:userId
 * 사용자별 랭킹 조회
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    await calculateRankings();
    
    const rankings = await db.get('rankings') || [];
    const userRankings = rankings.filter((r: RankingEntry) => r.userId === userId);
    
    res.json({ success: true, data: userRankings });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
