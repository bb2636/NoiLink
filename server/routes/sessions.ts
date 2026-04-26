/**
 * Sessions API 라우트
 * 트레이닝 세션 관리
 */

import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import type { Session, SessionMeta, PhaseMeta, TrainingMode, Level, MetricsScore, User } from '@noilink/shared';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { userCanActOnTargetUserId, canAccessOrganizationResource } from '../utils/session-user-policy.js';
import { withIdempotency } from '../utils/idempotency.js';

const router = Router();

/**
 * 세션 메타를 저장 전 정규화한다.
 *  - meta.partial.progressPct: 유한한 숫자만 받아 0~100 정수로 클램프.
 *    손상값(NaN/Infinity/문자열/객체/null)은 partial 키 자체를 제거해
 *    UI 가 "부분 결과 · NaN%" 같은 어색한 표기를 만들지 않게 한다.
 *  - 그 외 미상의 키는 그대로 통과시켜 시드/실험 메타 호환성 유지.
 *
 * 정규화 후 남는 키가 하나도 없으면 undefined 를 반환해 호출 측이 meta 자체를
 * 세션에서 빼버릴 수 있게 한다.
 */
function sanitizeSessionMeta(raw: Record<string, unknown>): SessionMeta | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'partial') {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const pct = (v as { progressPct?: unknown }).progressPct;
        if (typeof pct === 'number' && Number.isFinite(pct)) {
          out.partial = {
            progressPct: Math.max(0, Math.min(100, Math.round(pct))),
          };
        }
      }
      continue;
    }
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? (out as SessionMeta) : undefined;
}

/**
 * POST /api/sessions
 * 새 트레이닝 세션 생성
 */
router.post('/', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

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
      meta,
    } = req.body;
    
    if (!userId || !mode || !bpm || !level) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, mode, bpm, level',
      });
    }

    const users: User[] = (await db.get('users')) || [];
    if (!userCanActOnTargetUserId(authReq.user, userId, users)) {
      return res.status(403).json({
        success: false,
        error: 'Cannot create session for this user',
      });
    }

    // 인증·인가 통과 후 idempotency 보호로 감싼다.
    // 같은 키로 재시도가 들어오면 첫 응답을 그대로 반환하고 insert/streak 갱신을 건너뛴다.
    await withIdempotency(
      req,
      res,
      { scope: 'sessions.create', userId: authReq.user.id },
      async () => {
        // 클라이언트가 meta(예: 부분 결과 진행률)를 함께 보내면 보존하되, 알려진
        // 키는 서버 단에서 정규화해 저장 데이터의 신뢰도를 보장한다.
        //  - meta 자체가 객체가 아니면(잘못된 페이로드) 통째로 무시.
        //  - meta.partial.progressPct 는 유한한 숫자만 받아 0~100 정수로 클램프한다.
        //    (NaN/Infinity/문자열/음수/100 초과 같은 손상값은 partial 키 자체를 제거)
        //  - 그 외 미상의 키는 그대로 통과시켜 시드/실험 메타 호환성 유지.
        const sanitizedMeta =
          meta && typeof meta === 'object' && !Array.isArray(meta)
            ? sanitizeSessionMeta(meta as Record<string, unknown>)
            : undefined;

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
          ...(sanitizedMeta ? { meta: sanitizedMeta } : {}),
          createdAt: new Date().toISOString(),
        };

        const sessions = await db.get('sessions') || [];
        sessions.push(session);
        await db.set('sessions', sessions);

        // 사용자 정보 업데이트 (lastTrainingDate, streak, bestStreak)
        // 규칙:
        //   - 오늘 처음 훈련: 어제 훈련 기록 있으면 streak + 1, 없으면 streak = 1 (중간에 빠진 경우 초기화)
        //   - bestStreak 는 역대 최고 기록이라 절대 감소하지 않음 (리셋 시에도 보관)
        //   - 같은 날 추가 세션: streak 변화 없음 (중복 카운트 방지)
        const userIndex = users.findIndex((u: User) => u.id === userId);
        if (userIndex !== -1) {
          const today = new Date().toISOString().split('T')[0];
          const lastDate = users[userIndex].lastTrainingDate
            ? new Date(users[userIndex].lastTrainingDate).toISOString().split('T')[0]
            : null;

          if (lastDate !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (lastDate === yesterdayStr) {
              users[userIndex].streak = (users[userIndex].streak || 0) + 1;
            } else {
              // 첫 훈련이거나 하루 이상 빠진 경우 → 1부터 다시 시작
              users[userIndex].streak = 1;
            }

            // 최고 기록 갱신 (보관)
            const prevBest = users[userIndex].bestStreak || 0;
            if (users[userIndex].streak > prevBest) {
              users[userIndex].bestStreak = users[userIndex].streak;
            }

            users[userIndex].lastTrainingDate = new Date().toISOString();
            await db.set('users', users);
          }
        }

        res.status(201).json({ success: true, data: session });
      },
    );
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

function avgMetric(list: MetricsScore[], key: keyof MetricsScore): number | undefined {
  const vals = list
    .map((m) => m[key])
    .filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return undefined;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * GET /api/sessions/organization/:organizationId/trend
 * 기관 소속 종합 세션을 일별로 묶어 팀 평균 지표 추이 (최근 10일)
 */
router.get('/organization/:organizationId/trend', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { organizationId } = req.params;
    if (!canAccessOrganizationResource(authReq.user, organizationId)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const users: User[] = (await db.get('users')) || [];
    const memberIds = new Set(
      users.filter((u) => u.organizationId === organizationId && !u.isDeleted).map((u) => u.id)
    );
    if (memberIds.size === 0) {
      return res.json({ success: true, data: [] });
    }

    const sessions: Session[] = (await db.get('sessions')) || [];
    const metricsScores: MetricsScore[] = (await db.get('metricsScores')) || [];

    const relevant = sessions.filter(
      (s) => memberIds.has(s.userId) && s.isComposite && s.isValid
    );

    const dayMap = new Map<string, MetricsScore[]>();
    for (const s of relevant) {
      const m = metricsScores.find((ms) => ms.sessionId === s.id);
      if (!m) continue;
      const day = s.createdAt.slice(0, 10);
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day)!.push(m);
    }

    const sortedDays = [...dayMap.keys()].sort();
    const last10 = sortedDays.slice(-10);

    const points = last10.map((day) => {
      const list = dayMap.get(day)!;
      return {
        date: `${day}T12:00:00.000Z`,
        memory: avgMetric(list, 'memory'),
        comprehension: avgMetric(list, 'comprehension'),
        focus: avgMetric(list, 'focus'),
        judgment: avgMetric(list, 'judgment'),
        agility: avgMetric(list, 'agility'),
        endurance: avgMetric(list, 'endurance'),
      };
    });

    res.json({ success: true, data: points });
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
router.get('/:sessionId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { sessionId } = req.params;
    const sessions = await db.get('sessions') || [];
    const session = sessions.find((s: Session) => s.id === sessionId);
    
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const users: User[] = (await db.get('users')) || [];
    if (!userCanActOnTargetUserId(authReq.user, session.userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
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
router.put('/:sessionId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { sessionId } = req.params;
    const updateData = req.body;
    
    const sessions = await db.get('sessions') || [];
    const sessionIndex = sessions.findIndex((s: Session) => s.id === sessionId);
    
    if (sessionIndex === -1) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const users: User[] = (await db.get('users')) || [];
    const existing = sessions[sessionIndex] as Session;
    if (!userCanActOnTargetUserId(authReq.user, existing.userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (updateData.userId != null && updateData.userId !== existing.userId) {
      return res.status(403).json({ success: false, error: 'Cannot change session userId' });
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
