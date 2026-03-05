import { Router, Request, Response } from 'express';
import { db } from '../db.js';

const router = Router();

/**
 * POST /api/users
 * 새 사용자 생성 (회원가입)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { username, email, name, deviceId } = req.body;
    
    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'Username is required'
      });
    }
    
    const users = await db.get('users') || [];
    
    // 중복 체크
    const existingUser = users.find((u: any) => u.username === username || u.email === email);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'User already exists'
      });
    }
    
    const { userType = 'PERSONAL', organizationId } = req.body;
    
    const newUser = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      username,
      email: email || undefined,
      name: name || username,
      userType: userType || 'PERSONAL',
      organizationId: organizationId || undefined,
      deviceId: deviceId || undefined,
      brainimalType: undefined,
      brainimalConfidence: undefined,
      streak: 0,
      lastTrainingDate: undefined,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      updatedAt: undefined,
    };
    
    users.push(newUser);
    await db.set('users', users);
    
    res.status(201).json({ success: true, data: newUser });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/users/:userId
 * 특정 사용자 정보 조회
 */
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const users = await db.get('users') || [];
    const user = users.find((u: any) => u.id === userId);
    
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/users/:userId
 * 사용자 정보 업데이트
 */
router.put('/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const updateData = req.body;
    
    const users = await db.get('users') || [];
    const userIndex = users.findIndex((u: any) => u.id === userId);
    
    if (userIndex === -1) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    users[userIndex] = {
      ...users[userIndex],
      ...updateData,
      id: userId, // ID는 변경 불가
      updatedAt: new Date().toISOString()
    };
    
    await db.set('users', users);
    
    res.json({ success: true, data: users[userIndex] });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/users/:userId/stats
 * 사용자 통계 조회
 */
router.get('/:userId/stats', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const users = await db.get('users') || [];
    const scores = await db.get('scores') || [];
    
    const user = users.find((u: any) => u.id === userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const userScores = scores.filter((s: any) => s.userId === userId);
    
    const stats = {
      totalGamesPlayed: userScores.length,
      totalScore: userScores.reduce((sum: number, s: any) => sum + s.score, 0),
      averageScore: userScores.length > 0 
        ? userScores.reduce((sum: number, s: any) => sum + s.score, 0) / userScores.length 
        : 0,
      bestScores: user.bestScores || {},
      gamesByCategory: {} as Record<string, number>,
      accuracy: userScores.length > 0
        ? userScores
            .filter((s: any) => s.accuracy !== null)
            .reduce((sum: number, s: any) => sum + (s.accuracy || 0), 0) / 
          userScores.filter((s: any) => s.accuracy !== null).length
        : 0
    };
    
    // 카테고리별 게임 수 집계
    const games = await db.get('games') || [];
    userScores.forEach((score: any) => {
      const game = games.find((g: any) => g.id === score.gameId);
      if (game && game.category) {
        stats.gamesByCategory[game.category] = (stats.gamesByCategory[game.category] || 0) + 1;
      }
    });
    
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
