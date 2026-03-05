import { Router, Request, Response } from 'express';
import { db } from '../db.js';

const router = Router();

/**
 * GET /api/training/games
 * 모든 트레이닝 게임 목록 조회
 */
router.get('/games', async (req: Request, res: Response) => {
  try {
    const games = await db.get('games') || [];
    res.json({ success: true, data: games });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/training/games/:gameId
 * 특정 게임 정보 조회
 */
router.get('/games/:gameId', async (req: Request, res: Response) => {
  try {
    const { gameId } = req.params;
    const games = await db.get('games') || [];
    const game = games.find((g: any) => g.id === gameId);
    
    if (!game) {
      return res.status(404).json({ success: false, error: 'Game not found' });
    }
    
    res.json({ success: true, data: game });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/training/games
 * 새 게임 생성 (관리자용)
 */
router.post('/games', async (req: Request, res: Response) => {
  try {
    const gameData = req.body;
    const games = await db.get('games') || [];
    
    const newGame = {
      id: gameData.id || `game_${Date.now()}`,
      name: gameData.name,
      description: gameData.description,
      category: gameData.category,
      difficulty: gameData.difficulty,
      createdAt: new Date().toISOString(),
      ...gameData
    };
    
    games.push(newGame);
    await db.set('games', games);
    
    res.status(201).json({ success: true, data: newGame });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
