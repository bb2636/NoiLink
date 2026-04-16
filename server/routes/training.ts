import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

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

router.post('/games', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, description, category, difficulty } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Game name is required' });
    }

    const games = await db.get('games') || [];
    
    const newGame = {
      id: `game_${Date.now()}`,
      name,
      description: description || '',
      category: category || 'general',
      difficulty: difficulty || 'medium',
      createdAt: new Date().toISOString(),
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
