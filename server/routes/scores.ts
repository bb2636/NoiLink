import { Router, Request, Response } from 'express';
import { db } from '../db.js';

const router = Router();

/**
 * POST /api/scores
 * 사용자 점수 저장
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { userId, gameId, score, accuracy, timeSpent, level } = req.body;
    
    if (!userId || !gameId || score === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, gameId, score'
      });
    }
    
    const scoreData = {
      id: `score_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      gameId,
      score: Number(score),
      accuracy: accuracy ? Number(accuracy) : null,
      timeSpent: timeSpent ? Number(timeSpent) : null,
      level: level || 1,
      createdAt: new Date().toISOString()
    };
    
    // scores 배열에 추가
    const scores = await db.get('scores') || [];
    scores.push(scoreData);
    await db.set('scores', scores);
    
    // 사용자의 최고 점수 업데이트
    const userScores = scores.filter((s: any) => s.userId === userId && s.gameId === gameId);
    const bestScore = Math.max(...userScores.map((s: any) => s.score));
    
    // users 데이터 업데이트
    const users = await db.get('users') || [];
    const userIndex = users.findIndex((u: any) => u.id === userId);
    
    if (userIndex !== -1) {
      if (!users[userIndex].bestScores) {
        users[userIndex].bestScores = {};
      }
      users[userIndex].bestScores[gameId] = bestScore;
      users[userIndex].totalGamesPlayed = (users[userIndex].totalGamesPlayed || 0) + 1;
      await db.set('users', users);
    }
    
    res.status(201).json({ success: true, data: scoreData });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/scores/user/:userId
 * 특정 사용자의 모든 점수 조회
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const scores = await db.get('scores') || [];
    const userScores = scores.filter((s: any) => s.userId === userId);
    
    res.json({ success: true, data: userScores });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/scores/game/:gameId
 * 특정 게임의 랭킹 조회
 */
router.get('/game/:gameId', async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const { limit = 100 } = req.query;
    
    const scores = await db.get('scores') || [];
    const gameScores = scores
      .filter((s: any) => s.gameId === gameId)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, Number(limit));
    
    res.json({ success: true, data: gameScores });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/scores/leaderboard
 * 전체 랭킹 조회
 */
router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const { limit = 100 } = req.query;
    
    const scores = await db.get('scores') || [];
    const users = await db.get('users') || [];
    
    // 사용자별 최고 점수 집계
    const userBestScores: Record<string, number> = {};
    
    scores.forEach((score: any) => {
      const key = `${score.userId}_${score.gameId}`;
      if (!userBestScores[key] || score.score > userBestScores[key]) {
        userBestScores[key] = score.score;
      }
    });
    
    // 전체 점수 합계 계산
    const leaderboard = users.map((user: any) => {
      const userScores = scores.filter((s: any) => s.userId === user.id);
      const totalScore = userScores.reduce((sum: number, s: any) => sum + s.score, 0);
      const bestScores = user.bestScores || {};
      
      return {
        userId: user.id,
        username: user.username || user.name,
        totalScore,
        bestScores,
        gamesPlayed: userScores.length,
        averageScore: userScores.length > 0 ? totalScore / userScores.length : 0
      };
    })
    .sort((a: any, b: any) => b.totalScore - a.totalScore)
    .slice(0, Number(limit));
    
    res.json({ success: true, data: leaderboard });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
