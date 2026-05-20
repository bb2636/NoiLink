import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import type { User } from '@noilink/shared';
import { isoToKstLocalDate } from '@noilink/shared';
import { generateToken, extractTokenFromHeader, verifyToken } from '../utils/jwt.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { issueOtp, verifyOtp, OTP_CONFIG } from '../utils/otp.js';
import { issueResetToken, consumeResetToken } from '../utils/reset-token.js';
import { checkRateLimit, getClientIp } from '../utils/rate-limit.js';
import { sendError } from '../utils/error-response.js';
import { withKeyLock } from '../utils/key-mutex.js';
import {
  findUserById, findUserByUsername, findUserByEmail, findUserByPhone,
  listUsersByOrganization, listAllUsers, upsertUser,
  findPasswordByUserId, findPasswordByEmail, upsertPassword, deletePassword,
  findOrganizationById, upsertOrganization, listOrganizations,
  insertInquiry, listInquiries, deleteInquiriesByUser,
  deleteSessionsByUser, deleteCompositeParticipantByUser,
  deleteMetricsByUser, deleteRawMetricsByUser,
  deleteReportsByUser, deleteDailyConditionsByUser, deleteDailyMissionsByUser,
  deleteUser,
} from '../db/repositories/index.js';

const KV_LOCK = {
  USERS: 'lock:db:users',
  PASSWORDS: 'lock:db:passwords',
};

const isProduction = process.env.NODE_ENV === 'production';
const SMS_ENABLED = process.env.SMS_ENABLED === 'true';

/**
 * 카카오 사용자 연결 끊기(unlink) — 회원탈퇴 시 호출.
 *
 * 우리 DB 만 비우면 카카오 계정에는 여전히 "NoiLink 와 연결됨" 으로 남아,
 * 같은 카카오 계정으로 다음 로그인 시 동의 화면이 스킵되고 callback 으로
 * 바로 통과 → 우리 서버는 이를 신규 가입으로 처리해 사실상 자동 재가입이
 * 발생한다(회원탈퇴 의도 위반). 어드민 키로 unlink 를 호출해 카카오 쪽
 * 연결도 함께 끊어, 다음 로그인 시 정상적으로 동의 화면이 다시 뜨고
 * 사용자가 "신규 가입" 을 명시적으로 인지하도록 한다.
 *
 * best-effort: 어드민 키 미설정 / 네트워크 오류 / 카카오 응답 실패는
 * 콘솔 로그만 남기고 탈퇴 자체를 막지 않는다 (DB 데이터 삭제는 이미 끝남).
 */
async function unlinkKakaoUser(socialId: string | undefined): Promise<void> {
  if (!socialId) return;
  const adminKey = process.env.KAKAO_ADMIN_KEY;
  if (!adminKey) {
    console.warn('[kakao unlink] KAKAO_ADMIN_KEY 미설정 — unlink 스킵');
    return;
  }
  try {
    const body = new URLSearchParams();
    body.set('target_id_type', 'user_id');
    body.set('target_id', socialId);
    const r = await fetch('https://kapi.kakao.com/v1/user/unlink', {
      method: 'POST',
      headers: {
        Authorization: `KakaoAK ${adminKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[kakao unlink] failed', r.status, txt);
    }
  } catch (e) {
    console.error('[kakao unlink] error', e);
  }
}

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

    // 중복 체크
    const existingByName = await findUserByUsername(username);
    const existingByEmail = email ? await findUserByEmail(email) : null;
    if (existingByName || existingByEmail) {
      return res.status(409).json({
        success: false,
        error: 'User already exists'
      });
    }

    const { userType = 'PERSONAL', organizationId, organizationName, password, phone } = req.body;

    // ADMIN 타입은 회원가입으로 생성 불가
    if (userType === 'ADMIN') {
      return res.status(403).json({
        success: false,
        error: 'Admin accounts cannot be created through signup'
      });
    }

    // 기업 회원: organizationId가 전달되지 않으면 신규 조직 ID를 자동 발급해
    // ORGANIZATION 권한(소속 조직 자원 접근/랭킹 등)이 정상 동작하도록 보장.
    const isOrgSignup = userType === 'ORGANIZATION';
    const resolvedOrganizationId =
      isOrgSignup
        ? (organizationId || `org_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`)
        : undefined;

    const newUser: any = {
      id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      username,
      email: email || undefined,
      name: name || username,
      phone: phone || undefined,
      userType: userType || 'PERSONAL',
      organizationId: resolvedOrganizationId,
      organizationName: isOrgSignup ? (organizationName || name || username) : undefined,
      // 기업 회원은 운영자 승인 후 사용 가능 — 데모 환경이라면 즉시 사용을 위해 APPROVED 처리도 고려
      approvalStatus: isOrgSignup ? ('PENDING' as const) : undefined,
      deviceId: deviceId || undefined,
      brainimalType: undefined,
      brainimalConfidence: undefined,
      streak: 0,
      lastTrainingDate: undefined,
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
      updatedAt: undefined,
    };

    // mutex: users RMW (락 안에서 중복 재확인) — Postgres 단일 INSERT 라도
    // 동시 가입 race 방지용으로 lock 유지.
    await withKeyLock(KV_LOCK.USERS, async () => {
      const dup =
        (await findUserByUsername(username)) ||
        (email ? await findUserByEmail(email) : null);
      if (dup) {
        throw Object.assign(new Error('User already exists'), { _conflict: true });
      }
      await upsertUser(newUser);
    });

    if (password && email) {
      const hashed = await hashPassword(password);
      await withKeyLock(KV_LOCK.PASSWORDS, async () => {
        await upsertPassword({
          userId: newUser.id,
          email,
          passwordHash: hashed,
          mustChange: false,
          createdAt: new Date().toISOString(),
        });
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
    const existingUser = await findUserByUsername(username);

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
 *
 * Task #158: name 은 인덱스가 없어 listAllUsers + 메모리 필터로 처리.
 *   가입 시 단발성으로만 호출되므로 회귀 위험 낮음 — 추후 필요시
 *   name lookup 헬퍼/인덱스를 추가하면 됨.
 */
router.get('/check-name/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const all = await listAllUsers({ includeDeleted: true });
    const existingUser = all.find((u: any) => u.name === name);

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

    // 이메일로 사용자 찾기
    const user: any = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    const passwordRecord: any =
      (await findPasswordByUserId(user.id)) ||
      (user.email ? await findPasswordByEmail(user.email) : null);
    if (!passwordRecord || !(await comparePassword(password, passwordRecord.passwordHash))) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password'
      });
    }

    // mutex: users RMW (lastLoginAt) 보호
    const nowIso = new Date().toISOString();
    await withKeyLock(KV_LOCK.USERS, async () => {
      const current = await findUserById(user.id);
      if (current) {
        await upsertUser({ ...current, lastLoginAt: nowIso } as User);
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

    const user: any = await findUserById(payload.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // 연속 트레이닝 자동 리셋 (조회 시점 기준)
    // - 마지막 훈련일이 어제·오늘이 아니면 현재 streak 은 0으로 리셋
    // - bestStreak 는 그대로 보관 (랭킹/기록 보존)
    // Task #151: KST(`Asia/Seoul`) 기준으로 비교. UTC 기준이면 KST 자정 직후 ~
    //   KST 09:00 사이에 조회한 어제 훈련 기록이 "그제" 로 잘못 분류돼 streak
    //   가 0 으로 리셋되는 회귀가 있었다.
    if (user.lastTrainingDate && (user.streak ?? 0) > 0) {
      const today = isoToKstLocalDate(new Date().toISOString())!;
      const [yy, mm, dd] = today.split('-').map(Number);
      const yUtc = new Date(Date.UTC(yy, mm - 1, dd));
      yUtc.setUTCDate(yUtc.getUTCDate() - 1);
      const yesterdayStr = `${yUtc.getUTCFullYear()}-${String(yUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(yUtc.getUTCDate()).padStart(2, '0')}`;
      const lastDate = isoToKstLocalDate(user.lastTrainingDate);
      if (lastDate !== today && lastDate !== yesterdayStr) {
        const prevBest = user.bestStreak || 0;
        if (user.streak > prevBest) {
          user.bestStreak = user.streak;
        }
        user.streak = 0;
        await upsertUser(user);
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
    const user: any = await findUserById(payload.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // 비밀번호 변경이 요청된 경우
    if (currentPassword && newPassword) {
      const passwordEntry: any =
        (await findPasswordByUserId(user.id)) ||
        (user.email ? await findPasswordByEmail(user.email) : null);

      if (!passwordEntry || !(await comparePassword(currentPassword, passwordEntry.passwordHash))) {
        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect'
        });
      }

      passwordEntry.passwordHash = await hashPassword(newPassword);
      passwordEntry.updatedAt = new Date().toISOString();
      await upsertPassword(passwordEntry);
    }

    // 닉네임(username) 변경
    if (username && username !== user.username) {
      // 중복 확인
      const existingUser = await findUserByUsername(username);
      if (existingUser && existingUser.id !== user.id) {
        return res.status(400).json({
          success: false,
          error: 'Username already exists'
        });
      }

      user.username = username;
    }

    user.updatedAt = new Date().toISOString();
    await upsertUser(user);

    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/users/me
 * 회원탈퇴 — 인증된 사용자 본인 계정 + 관련 데이터 삭제 (cascade).
 *
 * 삭제 대상:
 *  - users[]              본인 레코드
 *  - passwords[]          본인 자격증명
 *  - sessions[]           본인이 1차 사용자(userId) 인 트레이닝 세션 기록
 *  - metricsScores[]      본인의 누적 점수 스냅샷
 *  - inquiries[]          본인이 작성한 1:1 문의 (관리자 답변 본문도 함께 사라짐)
 *
 * 주의:
 *  - 기업 관리자(ORGANIZATION userType) 가 탈퇴해도 같은 조직 멤버 계정은
 *    보존된다 — 멤버의 organizationId 만 끊는 것은 별도 정책 결정이라
 *    이 단순 탈퇴 플로우에서는 손대지 않는다 (관리자는 멤버 이관 후 탈퇴
 *    필요).
 *  - 합성/composite 세션 중 본인이 `participantIds` 로만 참여한 레코드는
 *    `deleteSessionsByUser(userId)` 로 정리되지 않으므로,
 *    `deleteCompositeParticipantByUser(userId)` 가 `meta.participantIds`
 *    배열에서 본인 id 만 splice 한다 (Task #162). 다른 참여자의 결과 row 는
 *    보존된다.
 *  - users / passwords 동시성 보호를 위해 기존 KV_LOCK 사용. 다른 entity
 *    (sessions/metrics/...) 는 단일 사용자 cascade 라 락 없이 best-effort.
 */
/**
 * 회원 데이터 cascade 삭제 — 본 모듈의 DELETE /me 와 네이버 재인증 기반
 * 회원탈퇴 (server/routes/auth.ts 의 /naver/callback withdraw flow) 양쪽에서
 * 공유한다. 네이버는 어드민 키가 없어 사용자 access token 으로만 unlink 가
 * 가능하기 때문에 unlink 호출 자체는 호출자 측 (auth.ts) 에서 처리하고,
 * 이 함수는 순수히 DB cascade + 카카오 unlink (어드민 키 보유) 만 담당한다.
 *
 * @returns 삭제된 사용자 레코드. 사용자가 존재하지 않았으면 null.
 */
export async function cascadeDeleteUser(userId: string): Promise<any | null> {
  let deletedUser: any = null;
  await withKeyLock(KV_LOCK.USERS, async () => {
    const found = await findUserById(userId);
    if (!found) return;
    deletedUser = found;
    await deleteUser(userId);
  });

  if (!deletedUser) return null;

  await withKeyLock(KV_LOCK.PASSWORDS, async () => {
    await deletePassword(userId);
  });

  // 부가 entity cascade — 한 컬렉션 실패가 나머지 cleanup 을 막지 않도록 try/catch.
  for (const step of [
    () => deleteSessionsByUser(userId),
    () => deleteCompositeParticipantByUser(userId),
    () => deleteMetricsByUser(userId),
    () => deleteRawMetricsByUser(userId),
    () => deleteInquiriesByUser(userId),
    () => deleteReportsByUser(userId),
    () => deleteDailyConditionsByUser(userId),
    () => deleteDailyMissionsByUser(userId),
  ]) {
    try {
      await step();
    } catch {
      /* best-effort — 잔여 데이터는 다음 cleanup 에서 정리 */
    }
  }

  // 카카오 연결 끊기 — DB cleanup 이 모두 끝난 뒤 호출. 실패해도 호출자
  // 응답을 막지 않는다. 네이버는 access token 이 필요해 호출자가 직접 처리.
  if (deletedUser.socialProvider === 'kakao') {
    await unlinkKakaoUser(deletedUser.socialId);
  }

  return deletedUser;
}

router.delete('/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const deletedUser = await cascadeDeleteUser(userId);
    if (!deletedUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, message: '회원탈퇴가 완료되었습니다.' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
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

    const user: any = await findUserById(payload.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

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
    await upsertUser(user);

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

// ============================================================================
// 기업 가입 (개인 회원 → 기업 소속) 플로우
// ============================================================================

/**
 * GET /api/users/organizations
 * 가입 가능한 기업 목록 (id, name, memberCount). 인증 필요.
 */
router.get('/organizations', requireAuth, async (_req: Request, res: Response) => {
  try {
    const organizations = await listOrganizations();
    const list = organizations
      .filter((o: any) => !o.isDeleted)
      .map((o: any) => ({
        id: o.id,
        name: o.name,
        memberCount: Array.isArray(o.memberUserIds) ? o.memberUserIds.length : 0,
      }));
    return res.json({ success: true, data: list });
  } catch (error) {
    return sendError(res, 500, '기업 목록 조회 실패', { cause: error });
  }
});

/**
 * POST /api/users/me/organization-join-request
 * 개인 회원이 특정 기업에 가입 신청. body: { organizationId }
 */
router.post('/me/organization-join-request', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { organizationId } = req.body || {};
    if (!organizationId || typeof organizationId !== 'string') {
      return sendError(res, 400, '기업 ID가 필요합니다.', { code: 'INVALID_ORG_ID' });
    }

    const me = authReq.user!;
    if (me.userType !== 'PERSONAL') {
      return sendError(res, 403, '개인 회원만 신청할 수 있습니다.', { code: 'NOT_PERSONAL' });
    }
    if (me.organizationId) {
      return sendError(res, 400, '이미 기업에 소속되어 있습니다.', { code: 'ALREADY_MEMBER' });
    }

    const org: any = await findOrganizationById(organizationId);
    if (!org) {
      return sendError(res, 404, '해당 기업을 찾을 수 없습니다.', { code: 'ORG_NOT_FOUND' });
    }

    let updated: any = null;
    await withKeyLock(KV_LOCK.USERS, async () => {
      const current: any = await findUserById(me.id);
      if (!current) throw new Error('User not found');
      updated = {
        ...current,
        pendingOrganizationId: organizationId,
        pendingOrganizationName: org.name,
        pendingRequestedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await upsertUser(updated);
    });

    const { password: _p, ...safe } = updated;
    return res.json({
      success: true,
      data: safe,
      message: `${org.name} 가입 신청이 접수되었습니다. 관리자 승인을 기다려주세요.`,
    });
  } catch (error) {
    return sendError(res, 500, '가입 신청 실패', { cause: error });
  }
});

/**
 * POST /api/users/me/organization-join-request/cancel
 * 신청 취소.
 */
router.post('/me/organization-join-request/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const me = authReq.user!;
    let updated: any = null;
    await withKeyLock(KV_LOCK.USERS, async () => {
      const current: any = await findUserById(me.id);
      if (!current) throw new Error('User not found');
      updated = {
        ...current,
        pendingOrganizationId: undefined,
        pendingOrganizationName: undefined,
        pendingRequestedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      await upsertUser(updated);
    });
    const { password: _p, ...safe } = updated;
    return res.json({ success: true, data: safe, message: '가입 신청이 취소되었습니다.' });
  } catch (error) {
    return sendError(res, 500, '취소 실패', { cause: error });
  }
});

/**
 * GET /api/users/me/pending-organization-members
 * 기업 관리자(ORGANIZATION) 가 자신의 기업에 가입 신청한 개인 회원 목록 조회.
 *
 * Task #158: pendingOrganizationId 컬럼은 정규화 테이블에 인덱싱돼 있지 않아
 *   `listAllUsers` 후 메모리 필터로 처리. 가입 신청 화면 진입 시점에만
 *   호출되는 저빈도 경로라 회귀 위험 낮음.
 */
router.get('/me/pending-organization-members', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const me = authReq.user!;
    if (me.userType !== 'ORGANIZATION' || !me.organizationId) {
      return sendError(res, 403, '기업 관리자만 접근 가능합니다.', { code: 'NOT_ORG_ADMIN' });
    }
    const all = await listAllUsers();
    const pending = all
      .filter((u: any) => u.pendingOrganizationId === me.organizationId)
      .map((u: any) => {
        const { password: _p, ...safe } = u;
        return safe;
      });
    return res.json({ success: true, data: pending });
  } catch (error) {
    return sendError(res, 500, '대기 회원 조회 실패', { cause: error });
  }
});

/**
 * POST /api/users/me/pending-organization-members/:userId/approve
 * 기업 관리자가 가입 신청을 승인.
 */
router.post('/me/pending-organization-members/:userId/approve', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const me = authReq.user!;
    if (me.userType !== 'ORGANIZATION' || !me.organizationId) {
      return sendError(res, 403, '기업 관리자만 접근 가능합니다.', { code: 'NOT_ORG_ADMIN' });
    }
    const { userId } = req.params;
    let approved: any = null;

    await withKeyLock(KV_LOCK.USERS, async () => {
      const target: any = await findUserById(userId);
      if (!target) throw Object.assign(new Error('User not found'), { _code: 404 });
      if (target.pendingOrganizationId !== me.organizationId) {
        throw Object.assign(new Error('해당 신청을 찾을 수 없습니다.'), { _code: 400 });
      }
      const org: any = await findOrganizationById(me.organizationId!);
      const orgName =
        org?.name || (me as any).organizationName || target.pendingOrganizationName;

      approved = {
        ...target,
        organizationId: me.organizationId,
        organizationName: orgName,
        pendingOrganizationId: undefined,
        pendingOrganizationName: undefined,
        pendingRequestedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      await upsertUser(approved);

      if (org) {
        const memberIds: string[] = Array.isArray(org.memberUserIds) ? org.memberUserIds : [];
        if (!memberIds.includes(userId)) {
          await upsertOrganization({
            ...org,
            memberUserIds: [...memberIds, userId],
            updatedAt: new Date().toISOString(),
          });
        }
      }
    });

    const { password: _p, ...safe } = approved;
    return res.json({ success: true, data: safe, message: '승인되었습니다.' });
  } catch (error: any) {
    return sendError(res, error?._code || 500, error?.message || '승인 실패', { cause: error });
  }
});

/**
 * POST /api/users/me/pending-organization-members/:userId/reject
 * 기업 관리자가 가입 신청을 반려.
 */
router.post('/me/pending-organization-members/:userId/reject', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const me = authReq.user!;
    if (me.userType !== 'ORGANIZATION' || !me.organizationId) {
      return sendError(res, 403, '기업 관리자만 접근 가능합니다.', { code: 'NOT_ORG_ADMIN' });
    }
    const { userId } = req.params;
    let rejected: any = null;
    await withKeyLock(KV_LOCK.USERS, async () => {
      const target: any = await findUserById(userId);
      if (!target) throw Object.assign(new Error('User not found'), { _code: 404 });
      if (target.pendingOrganizationId !== me.organizationId) {
        throw Object.assign(new Error('해당 신청을 찾을 수 없습니다.'), { _code: 400 });
      }
      rejected = {
        ...target,
        pendingOrganizationId: undefined,
        pendingOrganizationName: undefined,
        pendingRequestedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      await upsertUser(rejected);
    });
    const { password: _p, ...safe } = rejected;
    return res.json({ success: true, data: safe, message: '반려되었습니다.' });
  } catch (error: any) {
    return sendError(res, error?._code || 500, error?.message || '반려 실패', { cause: error });
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
    const exists = (await findUserByPhone(phone)) !== null;

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

    const user = await findUserByPhone(phone);

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
    const user = await findUserByPhone(phone);
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

    const user: any = await findUserById(consumed.userId);
    if (!user) {
      return sendError(res, 404, '사용자를 찾을 수 없습니다.', { code: 'USER_NOT_FOUND' });
    }

    // mutex: passwords RMW 보호
    await withKeyLock(KV_LOCK.PASSWORDS, async () => {
      const hashed = await hashPassword(password);
      const existing = await findPasswordByUserId(user.id);
      if (existing) {
        await upsertPassword({
          ...existing,
          passwordHash: hashed,
          updatedAt: new Date().toISOString(),
          // 약한 비밀번호 강제 변경 플래그 해제
          mustChange: false,
        });
      } else {
        await upsertPassword({
          userId: user.id,
          email: user.email,
          passwordHash: hashed,
          mustChange: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
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

    const user: any = await findUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const now = new Date().toISOString();
    const newInquiry = {
      id: `inquiry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      userName: user.name,
      title,
      content,
      date: now,
      status: 'PENDING',
      answer: undefined,
      answerDate: undefined,
      createdAt: now,
    };

    await insertInquiry(newInquiry as any);

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

    // listInquiries 는 createdAt DESC 정렬 — 기존 KV 경로의 date|createdAt
    // 혼합 정렬과 거의 동일. (회귀 시 정렬 키 보강 follow-up.)
    const userInquiries = await listInquiries({ userId });

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

    if (!currentUser) {
      return sendError(res, 404, '사용자를 찾을 수 없습니다.', { code: 'USER_NOT_FOUND' });
    }

    // 기업에 소속된 회원: 조직 레코드의 memberUserIds 에 실제로 포함되어 있어야 함
    // (사용자 프로필의 organizationId 만 신뢰하면 다른 조직 멤버 데이터가 노출될 수 있음)
    if (currentUser.organizationId) {
      const org: any = await findOrganizationById(currentUser.organizationId);
      const memberIds: string[] = Array.isArray(org?.memberUserIds) ? org.memberUserIds : [];
      const isAdminOfOrg = currentUser.userType === 'ORGANIZATION';
      const isAuthorizedMember = memberIds.includes(currentUser.id);
      if (!org || (!isAdminOfOrg && !isAuthorizedMember)) {
        return res.json({ success: true, data: [currentUser] });
      }
      // listUsersByOrganization 은 organization_id 인덱스 기반. memberUserIds
      // 에는 들어 있지만 user.organizationId 가 비어있는 정합성 결손 데이터를
      // 피하려면 organizationId 컬럼만 신뢰하면 충분 — 승인 시점에 둘이
      // 함께 갱신된다.
      const orgMembers = await listUsersByOrganization(currentUser.organizationId);
      const members = orgMembers
        .filter((u: any) => memberIds.includes(u.id))
        .map((u: any) => {
          const { password: _p, ...safe } = u;
          return safe;
        });
      return res.json({ success: true, data: members });
    }

    // 기업 미소속 개인 회원: 본인만 반환
    if (currentUser.userType === 'PERSONAL') {
      return res.json({ success: true, data: [currentUser] });
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

    if (authReq.user!.id !== userId && authReq.user!.userType !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const user = await findUserById(userId);

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

    const current: any = await findUserById(userId);
    if (!current) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const isAdmin = authReq.user!.userType === 'ADMIN';

    // 셀프 업데이트는 안전한 프로필 필드만 허용 — 조직 가입/승인 관련 필드는
    // 반드시 가입 신청/승인 엔드포인트를 거쳐야 하므로 PUT /users/:userId 에서는 차단.
    const SELF_ALLOWED = new Set([
      'name', 'nickname', 'email', 'phone', 'age',
      'brainimalType', 'brainimalConfidence', 'brainAge',
      'previousBrainAge', 'streak', 'bestStreak', 'lastTrainingDate',
      'deviceId', 'documents',
    ]);

    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updateData || {})) {
      if (k === 'id' || k === 'password') continue;
      if (isAdmin) {
        filtered[k] = v;
      } else if (SELF_ALLOWED.has(k)) {
        filtered[k] = v;
      }
      // 비관리자가 보낸 organizationId/organizationName/pendingOrganization*/approvalStatus/userType 등은 무시
    }

    const updated: any = {
      ...current,
      ...filtered,
      id: userId,
      userType: isAdmin ? (updateData.userType || current.userType) : current.userType,
      updatedAt: new Date().toISOString(),
    };

    await upsertUser(updated);

    res.json({ success: true, data: updated });
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
 *
 * Task #158: 'scores' / 'games' 컬렉션은 정규화 테이블 없이 KV 에 보존된다 —
 *   현재 미사용 레거시 경로라 정규화 대상에서 제외 (per task scope).
 */
router.get('/:userId/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { userId } = req.params;

    if (authReq.user!.id !== userId && authReq.user!.userType !== 'ADMIN') {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const user: any = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const scores = (await db.get('scores')) || [];
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
    const games = (await db.get('games')) || [];
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
