/**
 * 인증 미들웨어
 */
import { Request, Response, NextFunction } from 'express';
import { db } from '../db.js';
import { verifyToken, extractTokenFromHeader } from '../utils/jwt.js';
import type { User } from '@noilink/shared';

export interface AuthRequest extends Request {
  user?: User;
}

/**
 * 관리자 권한 체크 미들웨어
 */
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // 먼저 JWT 토큰으로 인증 시도
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);
    
    let user: User | undefined;
    
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        const users = await db.get('users') || [];
        user = users.find((u: any) => u.id === payload.userId) as User;
      }
    }
    
    // JWT 토큰이 없거나 유효하지 않으면 x-user-id 헤더 확인 (하위 호환성)
    if (!user) {
      const userId = req.headers['x-user-id'] as string;
      if (userId) {
        const users = await db.get('users') || [];
        user = users.find((u: any) => u.id === userId) as User;
      }
    }
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    if (user.userType !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * JWT 토큰 기반 인증 미들웨어
 */
export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please provide a valid token.'
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
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }
    
    req.user = user as User;
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * 일반 인증 미들웨어 (선택적)
 */
export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);
    
    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        const users = await db.get('users') || [];
        const user = users.find((u: any) => u.id === payload.userId);
        if (user) {
          req.user = user as User;
        }
      }
    }
    
    // 기존 x-user-id 헤더도 지원 (하위 호환성)
    const userId = req.headers['x-user-id'] as string;
    if (userId && !req.user) {
      const users = await db.get('users') || [];
      const user = users.find((u: any) => u.id === userId);
      if (user) {
        req.user = user as User;
      }
    }
    
    next();
  } catch (error) {
    next();
  }
}
