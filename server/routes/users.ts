import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import { generateToken } from '../utils/jwt.js';

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
    
    const { userType = 'PERSONAL', organizationId, password, phone } = req.body;
    
    // ADMIN 타입은 회원가입으로 생성 불가
    if (userType === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Admin accounts cannot be created through signup'
      });
    }
    
    const newUser = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      username,
      email: email || undefined,
      name: name || username,
      phone: phone || undefined,
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
    
    // 비밀번호 저장 (실제 운영 시 해시화 필요)
    if (password && email) {
      const passwords = await db.get('passwords') || [];
      passwords.push({
        userId: newUser.id,
        email: email,
        password: password, // 실제 운영 시 bcrypt 등으로 해시화
        createdAt: new Date().toISOString(),
      });
      await db.set('passwords', passwords);
    }
    
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
 * GET /api/users/check-username/:username
 * 사용자명(닉네임) 중복 체크
 */
router.get('/check-username/:username', async (req: Request, res: Response) => {
  try {
    const { username } = req.params;
    const users = await db.get('users') || [];
    const existingUser = users.find((u: any) => u.username === username);
    
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'Username already exists'
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/users/check-name/:name
 * 이름 중복 체크
 */
router.get('/check-name/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const users = await db.get('users') || [];
    const existingUser = users.find((u: any) => u.name === name);
    
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: 'Name already exists'
      });
    }
    
    res.json({ success: true });
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

/**
 * POST /api/users/login
 * 로그인 (이메일/비밀번호)
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }
    
    const users = await db.get('users') || [];
    const passwords = await db.get('passwords') || [];
    
    // 이메일로 사용자 찾기
    const user = users.find((u: any) => u.email === email);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }
    
    // 비밀번호 확인
    const passwordRecord = passwords.find((p: any) => p.userId === user.id);
    if (!passwordRecord || passwordRecord.password !== password) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }
    
    // 마지막 로그인 시간 업데이트
    const userIndex = users.findIndex((u: any) => u.id === user.id);
    if (userIndex !== -1) {
      users[userIndex].lastLoginAt = new Date().toISOString();
      await db.set('users', users);
    }
    
    // JWT 토큰 생성
    const token = generateToken(user as any);
    
    res.json({ 
      success: true, 
      data: {
        ...user,
        lastLoginAt: new Date().toISOString()
      },
      token
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/users/me
 * 현재 로그인한 사용자 정보 조회 (JWT 토큰 기반)
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const { extractTokenFromHeader, verifyToken } = await import('../utils/jwt.js');
    
    const token = extractTokenFromHeader(authHeader);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    
    const users = await db.get('users') || [];
    const user = users.find((u: any) => u.id === payload.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
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
 * PUT /api/users/me
 * 현재 로그인한 사용자 프로필 수정 (JWT 토큰 기반)
 */
router.put('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const { extractTokenFromHeader, verifyToken } = await import('../utils/jwt.js');
    
    const token = extractTokenFromHeader(authHeader);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    
    const { username, currentPassword, newPassword } = req.body;
    const users = await db.get('users') || [];
    const userIndex = users.findIndex((u: any) => u.id === payload.userId);
    
    if (userIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const user = users[userIndex];
    
    // 비밀번호 변경이 요청된 경우
    if (currentPassword && newPassword) {
      const passwords = await db.get('passwords') || [];
      const passwordEntry = passwords.find((p: any) => p.userId === user.id || p.email === user.email);
      
      if (!passwordEntry || passwordEntry.password !== currentPassword) {
        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }
      
      // 새 비밀번호로 업데이트
      passwordEntry.password = newPassword;
      passwordEntry.updatedAt = new Date().toISOString();
      await db.set('passwords', passwords);
    }
    
    // 닉네임(username) 변경
    if (username && username !== user.username) {
      // 중복 확인
      const existingUser = users.find((u: any) => u.username === username && u.id !== user.id);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: 'Username already exists'
        });
      }
      
      user.username = username;
    }
    
    user.updatedAt = new Date().toISOString();
    users[userIndex] = user;
    await db.set('users', users);
    
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/users/find-by-phone/:phone
 * 휴대폰 번호로 사용자 찾기 (비밀번호 찾기용)
 */
router.get('/find-by-phone/:phone', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    
    if (!phone || phone.length !== 11) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number'
      });
    }
    
    const users = await db.get('users') || [];
    // 휴대폰 번호로 사용자 찾기 (users에 phone 필드가 있다고 가정)
    const user = users.find((u: any) => {
      // phone 필드가 있으면 직접 비교, 없으면 다른 방법으로 찾기
      if (u.phone) {
        const userPhone = u.phone.replace(/[^0-9]/g, '');
        return userPhone === phone;
      }
      return false;
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // 이메일만 반환 (보안상 비밀번호는 제외)
    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        phone: user.phone,
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/users/reset-password
 * 비밀번호 재설정
 */
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { phone, password } = req.body;
    
    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        error: 'Phone and password are required'
      });
    }
    
    const users = await db.get('users') || [];
    const passwords = await db.get('passwords') || [];
    
    // 휴대폰 번호로 사용자 찾기
    const user = users.find((u: any) => {
      if (u.phone) {
        const userPhone = u.phone.replace(/[^0-9]/g, '');
        return userPhone === phone.replace(/[^0-9]/g, '');
      }
      return false;
    });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // 비밀번호 업데이트
    const passwordIndex = passwords.findIndex((p: any) => p.userId === user.id);
    if (passwordIndex !== -1) {
      passwords[passwordIndex].password = password; // 실제 운영 시 bcrypt로 해시화
      passwords[passwordIndex].updatedAt = new Date().toISOString();
    } else {
      // 비밀번호 레코드가 없으면 새로 생성
      passwords.push({
        userId: user.id,
        email: user.email,
        password: password, // 실제 운영 시 bcrypt로 해시화
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    
    await db.set('passwords', passwords);
    
    res.json({
      success: true,
      data: { message: 'Password reset successfully' }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
