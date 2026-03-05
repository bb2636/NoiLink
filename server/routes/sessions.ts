/**
 * Sessions API 라우트
 * 트레이닝 세션 관리
 */

import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import type { Session, PhaseMeta, TrainingMode, Level } from '@noilink/shared';

const router = Router();

/**
 * POST /api/sessions
 * 새 트레이닝 세션 생성
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      userId,
      mode,
      bpm,
      level,
      duration,
      score,
      isComposite,
      isValid,
      phases,
    } = req.body;
    
    if (!userId || !mode || !bpm || !level) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, mode, bpm, level',
      });
    }
    
    const session: Session = {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      mode: mode as TrainingMode,
      bpm: Number(bpm),
      level: Number(level) as Level,
      duration: duration ? Number(duration) : 0,
      score: score !== undefined ? Number(score) : undefined,
      isComposite: Boolean(isComposite),
      isValid: isValid !== undefined ? Boolean(isValid) : true,
      phases: (phases || []) as PhaseMeta[],
      createdAt: new Date().toISOString(),
    };
    
    const sessions = await db.get('sessions') || [];
    sessions.push(session);
    await db.set('sessions', sessions);
    
    // 사용자 정보 업데이트 (lastTrainingDate, streak)
    const users = await db.get('users') || [];
    const userIndex = users.findIndex((u: any) => u.id === userId);
    if (userIndex !== -1) {
      const today = new Date().toISOString().split('T')[0];
      const lastDate = users[userIndex].lastTrainingDate
        ? new Date(users[userIndex].lastTrainingDate).toISOString().split('T')[0]
        : null;
      
      if (lastDate !== today) {
        // 새로운 날짜면 streak 업데이트
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        if (lastDate === yesterdayStr) {
          users[userIndex].streak = (users[userIndex].streak || 0) + 1;
        } else if (lastDate !== today) {
          users[userIndex].streak = 1;
        }
        
        users[userIndex].lastTrainingDate = new Date().toISOString();
        await db.set('users', users);
      }
    }
    
    res.status(201).json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/sessions/user/:userId
 * 사용자별 세션 조회
 */
router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { limit = 50, mode, isComposite, isValid } = req.query;
    
    const sessions = await db.get('sessions') || [];
    let userSessions = sessions.filter((s: Session) => s.userId === userId);
    
    // 필터링
    if (mode) {
      userSessions = userSessions.filter((s: Session) => s.mode === mode);
    }
    if (isComposite !== undefined) {
      userSessions = userSessions.filter((s: Session) => s.isComposite === (isComposite === 'true'));
    }
    if (isValid !== undefined) {
      userSessions = userSessions.filter((s: Session) => s.isValid === (isValid === 'true'));
    }
    
    // 정렬 (최신순)
    userSessions.sort((a: Session, b: Session) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    
    // 제한
    const limited = userSessions.slice(0, Number(limit));
    
    res.json({ success: true, data: limited });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/sessions/:sessionId
 * 특정 세션 조회
 */
router.get('/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const sessions = await db.get('sessions') || [];
    const session = sessions.find((s: Session) => s.id === sessionId);
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    res.json({ success: true, data: session });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/sessions/:sessionId
 * 세션 업데이트
 */
router.put('/:sessionId', async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const updateData = req.body;
    
    const sessions = await db.get('sessions') || [];
    const sessionIndex = sessions.findIndex((s: Session) => s.id === sessionId);
    
    if (sessionIndex === -1) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    
    sessions[sessionIndex] = {
      ...sessions[sessionIndex],
      ...updateData,
      id: sessionId, // ID는 변경 불가
    };
    
    await db.set('sessions', sessions);
    
    res.json({ success: true, data: sessions[sessionIndex] });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
