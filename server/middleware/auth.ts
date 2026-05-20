/**
 * 인증 미들웨어
 */
import { Request, Response, NextFunction } from 'express';
import { findUserById } from '../db/repositories/index.js';
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
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    let user: User | null = null;

    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        user = await findUserById(payload.userId);
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

    const user = await findUserById(payload.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
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
 * 일반 인증 미들웨어 (선택적)
 */
export async function optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);

    if (token) {
      const payload = verifyToken(token);
      if (payload) {
        const user = await findUserById(payload.userId);
        if (user) {
          req.user = user;
        }
      }
    }

    next();
  } catch (error) {
    next();
  }
}
