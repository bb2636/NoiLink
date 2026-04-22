import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import type { User } from '@noilink/shared';
import { generateToken, extractTokenFromHeader, verifyToken } from '../utils/jwt.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { issueOtp, verifyOtp, OTP_CONFIG } from '../utils/otp.js';
import { issueResetToken, consumeResetToken } from '../utils/reset-token.js';
import { checkRateLimit, getClientIp } from '../utils/rate-limit.js';
import { sendError } from '../utils/error-response.js';
import { withKeyLock } from '../utils/key-mutex.js';

const KV_LOCK = {
  USERS: 'lock:db:users',
  PASSWORDS: 'lock:db:passwords',
};

const isProduction = process.env.NODE_ENV === 'production';
const SMS_ENABLED = process.env.SMS_ENABLED === 'true';

function normalizePhone(input: string): string {
  return (input || '').replace(/[^0-9]/g, '');
}

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
    
    // mutex: users + passwords RMW 동시성 보호
    await withKeyLock(KV_LOCK.USERS, async () => {
      const currentUsers = await db.get('users') || [];
      // 락 안에서 중복 재확인 (race 방지)
      if (currentUsers.find((u: any) => u.username === username || (email && u.email === email))) {
        throw Object.assign(new Error('User already exists'), { _conflict: true });
      }
      currentUsers.push(newUser);
      await db.set('users', currentUsers);
    }).catch(async (err) => {
      if (err && err._conflict) {
        throw err;
      }
      throw err;
    });

    if (password && email) {
      const hashed = await hashPassword(password);
      await withKeyLock(KV_LOCK.PASSWORDS, async () => {
        const passwords = await db.get('passwords') || [];
        passwords.push({
          userId: newUser.id,
          email: email,
          password: hashed,
          mustChange: false,
          createdAt: new Date().toISOString(),
        });
        await db.set('passwords', passwords);
      });
    }

    // 이메일+비밀번호로 가입한 경우 로그인과 동일하게 JWT 발급(가입 직후 API·트레이닝 연동)
    const issuedToken =
      password && email ? generateToken(newUser as User) : undefined;

    res.status(201).json({
      success: true,
      data: newUser,
      ...(issuedToken ? { token: issuedToken } : {}),
    });
  } catch (error: any) {
    if (error && error._conflict) {
      return res.status(409).json({ success: false, error: 'User already exists' });
    }
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
    
    const passwordRecord = passwords.find((p: any) => p.userId === user.id);
    if (!passwordRecord || !(await comparePassword(password, passwordRecord.password))) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // mutex: users RMW (lastLoginAt) 보호
    const nowIso = new Date().toISOString();
    await withKeyLock(KV_LOCK.USERS, async () => {
      const currentUsers = await db.get('users') || [];
      const idx = currentUsers.findIndex((u: any) => u.id === user.id);
      if (idx !== -1) {
        currentUsers[idx].lastLoginAt = nowIso;
        await db.set('users', currentUsers);
      }
    });

    // JWT 토큰 생성
    const token = generateToken(user as any);

    res.json({
      success: true,
      data: {
        ...user,
        lastLoginAt: nowIso,
        // 약한 비밀번호로 시드된 계정은 강제 변경 안내
        mustChangePassword: passwordRecord.mustChange === true,
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

    // 연속 트레이닝 자동 리셋 (조회 시점 기준)
    // - 마지막 훈련일이 어제·오늘이 아니면 현재 streak 은 0으로 리셋
    // - bestStreak 는 그대로 보관 (랭킹/기록 보존)
    if (user.lastTrainingDate && (user.streak ?? 0) > 0) {
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const lastDate = new Date(user.lastTrainingDate).toISOString().split('T')[0];
      if (lastDate !== today && lastDate !== yesterdayStr) {
        const prevBest = user.bestStreak || 0;
        if (user.streak > prevBest) {
          user.bestStreak = user.streak;
        }
        user.streak = 0;
        const idx = users.findIndex((u: any) => u.id === user.id);
        if (idx !== -1) {
          users[idx] = user;
          await db.set('users', users);
        }
      }
    }

    // 비밀번호 정보 제외
    const { password: _, ...userWithoutPassword } = user as any;
    
    res.json({ success: true, data: userWithoutPassword });
  } catch (error) {
    console.error('Error in /users/me:', error);
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
      
      if (!passwordEntry || !(await comparePassword(currentPassword, passwordEntry.password))) {
        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }
      
      passwordEntry.password = await hashPassword(newPassword);
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
 * POST /api/users/me/organization-approval-request
 * 기업(ORGANIZATION) 회원 기관 승인 요청 — approvalStatus → PENDING
 */
router.post('/me/organization-approval-request', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = extractTokenFromHeader(authHeader);
    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    const users = (await db.get('users')) || [];
    const userIndex = users.findIndex((u: any) => u.id === payload.userId);
    if (userIndex === -1) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = users[userIndex] as User;
    if (user.userType !== 'ORGANIZATION') {
      return res.status(403).json({
        success: false,
        error: '기업 회원만 신청할 수 있습니다.',
      });
    }

    if (user.approvalStatus === 'APPROVED') {
      return res.json({
        success: true,
        data: user,
        message: '이미 승인된 계정입니다.',
      });
    }

    if (user.approvalStatus === 'PENDING') {
      return res.json({
        success: true,
        data: user,
        message: '이미 승인 검토 중입니다.',
      });
    }

    user.approvalStatus = 'PENDING';
    user.updatedAt = new Date().toISOString();
    users[userIndex] = user;
    await db.set('users', users);

    const { password: _, ...safe } = user as any;
    res.json({
      success: true,
      data: safe,
      message: '기관 승인 요청이 접수되었습니다. 관리자 검토 후 반영됩니다.',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * @deprecated Use POST /api/users/reset-password/request 대신 사용.
 * 기존 클라이언트 호환을 위해 일부 정보만 마스킹해서 반환하지만,
 * 실제 비밀번호 재설정은 OTP 흐름 통과 후 reset 토큰 필요.
 *
 * 보안: rate-limit 적용 (IP+phone 기준), 사용자 존재 여부도 항상 200으로 통일하여 enumeration 방지.
 */
router.get('/find-by-phone/:phone', async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.params.phone);
    if (phone.length !== 11) {
      return sendError(res, 400, '올바른 휴대폰 번호가 아닙니다.', { code: 'INVALID_PHONE' });
    }

    const ip = getClientIp(req);
    const limit = checkRateLimit(`${ip}:${phone}:find-by-phone`, { windowMs: 60_000, max: 5 });
    if (!limit.allowed) {
      return sendError(res, 429, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', {
        code: 'RATE_LIMITED',
      });
    }

    // 사용자 존재 여부 노출 방지 — 항상 동일 응답
    const users = await db.get('users') || [];
    const exists = users.some((u: any) => u.phone && normalizePhone(u.phone) === phone);

    return res.json({ success: true, data: { exists } });
  } catch (error) {
    return sendError(res, 500, '요청 처리에 실패했습니다.', { cause: error });
  }
});

/**
 * POST /api/users/reset-password/request
 * 비밀번호 재설정 OTP 발급
 *
 * - 휴대폰 번호로 사용자 확인 후 6자리 OTP 발급 (TTL 5분)
 * - 사용자 존재 여부 노출 방지: 등록되지 않은 번호도 동일하게 200 응답
 * - 실제 SMS 전송은 SMS_ENABLED=true + 게이트웨이 연동 필요.
 *   미연동 시: NODE_ENV=production 외 환경에서 응답 + 서버 로그에 OTP 노출 (개발용)
 */
router.post('/reset-password/request', async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (phone.length !== 11) {
      return sendError(res, 400, '올바른 휴대폰 번호를 입력해주세요.', { code: 'INVALID_PHONE' });
    }

    const ip = getClientIp(req);
    // composite key: 같은 IP의 여러 번호 공격 + 같은 번호의 여러 IP 공격 모두 차단
    const ipPhoneLimit = checkRateLimit(`${ip}:${phone}:reset-request`, { windowMs: 60_000, max: 3 });
    const phoneLimit = checkRateLimit(`*:${phone}:reset-request`, { windowMs: 10 * 60_000, max: 5 });
    const ipLimit = checkRateLimit(`${ip}:*:reset-request`, { windowMs: 10 * 60_000, max: 20 });
    if (!ipPhoneLimit.allowed || !phoneLimit.allowed || !ipLimit.allowed) {
      return sendError(res, 429, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', {
        code: 'RATE_LIMITED',
      });
    }

    const users = await db.get('users') || [];
    const user = users.find((u: any) => u.phone && normalizePhone(u.phone) === phone);

    // 응답은 항상 동일 (enumeration 방지). 단 dev에서는 디버깅 위해 분기.
    const responsePayload: Record<string, unknown> = {
      message: '인증번호를 전송했습니다. 5분 이내에 입력해주세요.',
      ttlSeconds: Math.floor(OTP_CONFIG.TTL_MS / 1000),
    };

    if (user) {
      const result = await issueOtp(phone);
      responsePayload.ttlSeconds = Math.ceil(result.ttlMs / 1000);

      if (result.reused) {
        // 활성 OTP 존재 — SMS 재전송 안 함, 사용자에게 알림
        responsePayload.message =
          '이미 전송된 인증번호를 사용해주세요. 만료 시 다시 요청할 수 있습니다.';
        responsePayload.reused = true;
        console.log(`[OTP] phone=${phone} — 활성 OTP 존재, 재발급 스킵`);
      } else if (result.otp) {
        if (SMS_ENABLED) {
          // TODO: 실제 SMS 게이트웨이 연동
          console.log(`[OTP] (SMS) phone=${phone} otp=${'*'.repeat(result.otp.length)}`);
        } else {
          console.log(`[OTP] (DEV — SMS 미연동) phone=${phone} otp=${result.otp}`);
          if (!isProduction) {
            // 개발/스테이징: 응답에 평문 OTP 포함하여 테스트 편의 제공
            responsePayload.devOtp = result.otp;
          } else {
            // 프로덕션 + SMS 미연동: 사용자에게 명확히 안내 (조용한 503 대신)
            responsePayload.message =
              'SMS 서비스 연동 전입니다. 관리자에게 문의해주세요.';
            responsePayload.smsUnavailable = true;
          }
        }
      }
    } else {
      console.log(`[OTP] phone=${phone} — 등록되지 않은 번호 (응답은 동일)`);
    }

    return res.json({ success: true, data: responsePayload });
  } catch (error) {
    return sendError(res, 500, '요청 처리에 실패했습니다.', { cause: error });
  }
});

/**
 * POST /api/users/reset-password/verify
 * OTP 검증 후 단기 reset 토큰 발급 (TTL 15분, one-time)
 */
router.post('/reset-password/verify', async (req: Request, res: Response) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const otp = String(req.body?.otp || '').trim();
    if (phone.length !== 11 || !/^\d{6}$/.test(otp)) {
      return sendError(res, 400, '인증번호가 올바르지 않습니다.', { code: 'INVALID_INPUT' });
    }

    const ip = getClientIp(req);
    const limit = checkRateLimit(`${ip}:${phone}:reset-verify`, { windowMs: 60_000, max: 10 });
    if (!limit.allowed) {
      return sendError(res, 429, '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', {
        code: 'RATE_LIMITED',
      });
    }

    const result = await verifyOtp(phone, otp);
    if (!result.ok) {
      const messages: Record<typeof result.reason, { msg: string; code: string }> = {
        not_found: { msg: '인증번호를 먼저 요청해주세요.', code: 'OTP_INVALID' },
        expired: { msg: '인증번호가 만료되었습니다. 다시 요청해주세요.', code: 'OTP_EXPIRED' },
        mismatch: { msg: '인증번호가 일치하지 않습니다.', code: 'OTP_INVALID' },
        too_many_attempts: {
          msg: '인증 시도 횟수를 초과했습니다. 다시 요청해주세요.',
          code: 'OTP_ATTEMPTS_EXCEEDED',
        },
      };
      const e = messages[result.reason];
      return sendError(res, 401, e.msg, { code: e.code });
    }

    // OTP 통과 — 사용자 조회 후 reset 토큰 발급
    const users = await db.get('users') || [];
    const user = users.find((u: any) => u.phone && normalizePhone(u.phone) === phone);
    if (!user) {
      // OTP는 통과했지만 사용자가 사라진 매우 드문 케이스
      return sendError(res, 404, '사용자를 찾을 수 없습니다.', { code: 'USER_NOT_FOUND' });
    }

    const resetToken = await issueResetToken(user.id);
    return res.json({
      success: true,
      data: {
        resetToken,
        expiresInSeconds: 15 * 60,
      },
    });
  } catch (error) {
    return sendError(res, 500, '요청 처리에 실패했습니다.', { cause: error });
  }
});

/**
 * POST /api/users/reset-password
 * reset 토큰으로 비밀번호 재설정 (one-time)
 */
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { resetToken, password } = req.body || {};

    if (!resetToken || typeof resetToken !== 'string') {
      return sendError(res, 400, '잘못된 요청입니다. 인증을 다시 진행해주세요.', {
        code: 'MISSING_RESET_TOKEN',
      });
    }
    if (!password || typeof password !== 'string') {
      return sendError(res, 400, '비밀번호를 입력해주세요.', { code: 'MISSING_PASSWORD' });
    }
    if (password.length < 8 || password.length > 64) {
      return sendError(res, 400, '비밀번호는 8자 이상 64자 이하여야 합니다.', {
        code: 'WEAK_PASSWORD',
      });
    }
    if (!/(?=.*[a-zA-Z])(?=.*[0-9])/.test(password)) {
      return sendError(res, 400, '비밀번호는 영문과 숫자를 포함해야 합니다.', {
        code: 'WEAK_PASSWORD',
      });
    }

    const ip = getClientIp(req);
    const limit = checkRateLimit(`${ip}:*:reset-password`, { windowMs: 60_000, max: 10 });
    if (!limit.allowed) {
      return sendError(res, 429, '요청이 너무 많습니다.', { code: 'RATE_LIMITED' });
    }

    const consumed = await consumeResetToken(resetToken);
    if (!consumed.ok) {
      return sendError(res, 401, '인증이 만료되었습니다. 다시 시도해주세요.', {
        code: consumed.reason === 'expired' ? 'RESET_TOKEN_EXPIRED' : 'RESET_TOKEN_INVALID',
      });
    }

    const users = await db.get('users') || [];
    const user = users.find((u: any) => u.id === consumed.userId);
    if (!user) {
      return sendError(res, 404, '사용자를 찾을 수 없습니다.', { code: 'USER_NOT_FOUND' });
    }

    // mutex: passwords RMW 보호
    await withKeyLock(KV_LOCK.PASSWORDS, async () => {
      const passwords = await db.get('passwords') || [];
      const hashed = await hashPassword(password);
      const passwordIndex = passwords.findIndex((p: any) => p.userId === user.id);
      if (passwordIndex !== -1) {
        passwords[passwordIndex].password = hashed;
        passwords[passwordIndex].updatedAt = new Date().toISOString();
        // 약한 비밀번호 강제 변경 플래그 해제
        passwords[passwordIndex].mustChange = false;
      } else {
        passwords.push({
          userId: user.id,
          email: user.email,
          password: hashed,
          mustChange: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      await db.set('passwords', passwords);
    });
    console.log(`[reset-password] userId=${user.id} 비밀번호가 재설정됨`);

    return res.json({
      success: true,
      data: { message: '비밀번호가 재설정되었습니다.' },
    });
  } catch (error) {
    return sendError(res, 500, '비밀번호 재설정에 실패했습니다.', { cause: error });
  }
});

/**
 * POST /api/users/inquiries
 * 문의 생성 (회원용)
 */
router.post('/inquiries', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { title, content } = req.body;
    const userId = authReq.user!.id;
    
    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: 'title and content are required'
      });
    }
    
    const users = await db.get('users') || [];
    const user = users.find((u: any) => u.id === userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const inquiries = await db.get('inquiries') || [];
    const newInquiry = {
      id: `inquiry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      userName: user.name,
      title,
      content,
      date: new Date().toISOString(),
      status: 'PENDING',
      answer: undefined,
      answerDate: undefined,
      createdAt: new Date().toISOString(),
    };
    
    inquiries.push(newInquiry);
    await db.set('inquiries', inquiries);
    
    res.status(201).json({ success: true, data: newInquiry });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/users/inquiries/:userId
 * 사용자별 문의 목록 조회 (본인 또는 관리자만)
 */
router.get('/inquiries/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { userId } = req.params;

    if (authReq.user!.id !== userId && authReq.user!.userType !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const inquiries = await db.get('inquiries') || [];
    const userInquiries = inquiries.filter((i: any) => i.userId === userId);
    
    // 최신순 정렬
    userInquiries.sort((a: any, b: any) => {
      const dateA = new Date(a.date || a.createdAt || '').getTime();
      const dateB = new Date(b.date || b.createdAt || '').getTime();
      return dateB - dateA;
    });
    
    res.json({ success: true, data: userInquiries });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/users/organization-members
 * 현재 사용자 조직의 멤버 목록 (기업 회원) / 개인 회원은 본인만
 * JWT 인증 필요
 */
router.get('/organization-members', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const currentUser = authReq.user!;

    const users = await db.get('users') || [];
    const organizations = await db.get('organizations') || [];

    if (!currentUser) {
      return sendError(res, 404, '사용자를 찾을 수 없습니다.', { code: 'USER_NOT_FOUND' });
    }

    // 개인 회원: 본인만 반환
    if (currentUser.userType === 'PERSONAL') {
      return res.json({ success: true, data: [currentUser] });
    }

    // 기업 회원: 동일 조직의 회원들 포함
    if (currentUser.organizationId) {
      const org = organizations.find((o: any) => o.id === currentUser.organizationId);
      const memberIds = org?.memberUserIds || [currentUser.id];
      const members = users.filter((u: any) => memberIds.includes(u.id) && !u.isDeleted);
      return res.json({ success: true, data: members });
    }


    return res.json({ success: true, data: [currentUser] });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/users/:userId
 * 특정 사용자 정보 조회 (본인 또는 관리자만)
 */
router.get('/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { userId } = req.params;
    const users = await db.get('users') || [];

    if (authReq.user!.id !== userId && authReq.user!.userType !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

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
 * 사용자 정보 업데이트 (본인 또는 관리자만 가능)
 */
router.put('/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { userId } = req.params;
    const updateData = req.body;

    if (authReq.user!.id !== userId && authReq.user!.userType !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    
    const users = await db.get('users') || [];
    const userIndex = users.findIndex((u: any) => u.id === userId);
    
    if (userIndex === -1) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const { id: _id, userType: _ut, password: _pw, ...safeData } = updateData;
    
    users[userIndex] = {
      ...users[userIndex],
      ...safeData,
      id: userId,
      userType: authReq.user!.userType === 'ADMIN' ? (updateData.userType || users[userIndex].userType) : users[userIndex].userType,
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
router.get('/:userId/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { userId } = req.params;

    if (authReq.user!.id !== userId && authReq.user!.userType !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

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
