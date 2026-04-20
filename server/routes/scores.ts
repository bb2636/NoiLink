import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { userCanActOnTargetUserId } from '../utils/session-user-policy.js';
import { withKeyLock } from '../utils/key-mutex.js';
import type { User } from '@noilink/shared';

const router = Router();
const KV_LOCK = { SCORES: 'lock:db:scores', USERS: 'lock:db:users' };

router.post('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { userId, gameId, score, accuracy, timeSpent, level } = req.body;
    
    if (!userId || !gameId || score === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, gameId, score'
      });
    }

    const users: User[] = (await db.get('users')) || [];
    if (!userCanActOnTargetUserId(authReq.user, userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
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

    // mutex: scores 배열 RMW 보호 (동시 푸시로 인한 데이터 유실 방지)
    let bestScore = scoreData.score;
    await withKeyLock(KV_LOCK.SCORES, async () => {
      const scores = await db.get('scores') || [];
      scores.push(scoreData);
      await db.set('scores', scores);
      const userScores = scores.filter((s: any) => s.userId === userId && s.gameId === gameId);
      bestScore = Math.max(...userScores.map((s: any) => s.score));
    });

    // mutex: users RMW (bestScores/totalGamesPlayed) 보호
    await withKeyLock(KV_LOCK.USERS, async () => {
      const currentUsers = await db.get('users') || [];
      const userIndex = currentUsers.findIndex((u: any) => u.id === userId);
      if (userIndex !== -1) {
        const u = currentUsers[userIndex] as any;
        if (!u.bestScores) u.bestScores = {};
        u.bestScores[gameId] = bestScore;
        u.totalGamesPlayed = (u.totalGamesPlayed || 0) + 1;
        await db.set('users', currentUsers);
      }
    });

    res.status(201).json({ success: true, data: scoreData });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

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

router.get('/game/:gameId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

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

router.get('/leaderboard', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { limit = 100 } = req.query;
    
    const scores = await db.get('scores') || [];
    const users = await db.get('users') || [];
    
    const leaderboard = users.map((user: any) => {
      const userScores = scores.filter((s: any) => s.userId === user.id);
      const totalScore = userScores.reduce((sum: number, s: any) => sum + s.score, 0);
      
      return {
        userId: user.id,
        username: user.username || user.name,
        totalScore,
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
