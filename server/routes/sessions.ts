/**
 * Sessions API 라우트
 * 트레이닝 세션 관리
 */

import { Router, Request, Response } from 'express';
import {
  findUserById,
  upsertUser,
  findSessionById,
  upsertSession,
  listSessions,
  listSessionsByUsers,
  findPreviousScoredSessionForUser,
  listUsersByOrganization,
  listMetricsBySessionIds,
} from '../db/repositories/index.js';
import type { Session, SessionMeta, PhaseMeta, TrainingMode, Level, MetricsScore, User } from '@noilink/shared';
import { isoToKstLocalDate, KST_TIME_ZONE } from '@noilink/shared';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { userCanActOnTargetUserId, canAccessOrganizationResource } from '../utils/session-user-policy.js';
import { withIdempotency } from '../utils/idempotency.js';
import { invalidateRankingsCache } from '../services/rankings-cache.js';

const router = Router();

/**
 * 세션 메타 정규화 (자세한 사유 — 이전 구현 주석 참조).
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
 * actor 와 target 사용자를 묶어 정책 헬퍼에 넘기는 최소 배열.
 * 전체 사용자 로딩을 피하기 위함.
 */
async function actorTargetUsers(actor: User, targetUserId: string): Promise<User[]> {
  const list: User[] = [actor];
  if (targetUserId !== actor.id) {
    const t = await findUserById(targetUserId);
    if (t) list.push(t);
  }
  return list;
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

    const users = await actorTargetUsers(authReq.user, userId);
    if (!userCanActOnTargetUserId(authReq.user, userId, users)) {
      return res.status(403).json({
        success: false,
        error: 'Cannot create session for this user',
      });
    }

    await withIdempotency(
      req,
      res,
      { scope: 'sessions.create', userId: authReq.user.id },
      async () => {
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

        await upsertSession(session);
        invalidateRankingsCache();

        // streak/bestStreak 갱신 — KST 기준.
        const targetUser = await findUserById(userId);
        if (targetUser) {
          const nowIso = new Date().toISOString();
          const today = isoToKstLocalDate(nowIso)!;
          const lastDate = targetUser.lastTrainingDate
            ? isoToKstLocalDate(targetUser.lastTrainingDate as string)
            : null;

          if (lastDate !== today) {
            const [yy, mm, dd] = today.split('-').map(Number);
            const yUtc = new Date(Date.UTC(yy, mm - 1, dd));
            yUtc.setUTCDate(yUtc.getUTCDate() - 1);
            const yesterdayStr = `${yUtc.getUTCFullYear()}-${String(yUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(yUtc.getUTCDate()).padStart(2, '0')}`;

            const updated: User = { ...targetUser };
            if (lastDate === yesterdayStr) {
              updated.streak = (updated.streak || 0) + 1;
            } else {
              updated.streak = 1;
            }

            const prevBest = updated.bestStreak || 0;
            if ((updated.streak || 0) > prevBest) {
              updated.bestStreak = updated.streak;
            }
            updated.lastTrainingDate = new Date().toISOString();
            await upsertUser(updated);
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
    const users = await actorTargetUsers(authReq.user, userId);
    if (!userCanActOnTargetUserId(authReq.user, userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const { limit = 50, mode, isComposite, isValid } = req.query;

    let userSessions = await listSessions({
      userId,
      isComposite: isComposite !== undefined ? isComposite === 'true' : undefined,
      isValid: isValid !== undefined ? isValid === 'true' : undefined,
      order: 'desc',
      limit: mode ? undefined : Number(limit),
    });

    if (mode) {
      userSessions = userSessions
        .filter((s: Session) => s.mode === mode)
        .slice(0, Number(limit));
    }

    res.json({ success: true, data: userSessions });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/sessions/user/:userId/previous-score?excluding=:sid
 * 비교 카드용 직전 점수 (Task #124).
 */
router.get(
  '/user/:userId/previous-score',
  optionalAuth,
  async (req: Request, res: Response) => {
    try {
      const authReq = req as AuthRequest;
      if (!authReq.user) {
        return res
          .status(401)
          .json({ success: false, error: 'Authentication required' });
      }
      const { userId } = req.params;
      const users = await actorTargetUsers(authReq.user, userId);
      if (!userCanActOnTargetUserId(authReq.user, userId, users)) {
        return res.status(403).json({ success: false, error: 'Forbidden' });
      }

      const excludingRaw = req.query.excluding;
      const excluding =
        typeof excludingRaw === 'string' && excludingRaw.length > 0
          ? excludingRaw
          : null;

      const top = await findPreviousScoredSessionForUser(userId, excluding);
      const data = top
        ? {
            previousScore: top.score as number,
            previousSessionId: top.id,
            previousCreatedAt: top.createdAt,
            previousScoreLocalDate: isoToKstLocalDate(top.createdAt),
            timeZone: KST_TIME_ZONE,
          }
        : {
            previousScore: null,
            previousSessionId: null,
            previousCreatedAt: null,
            previousScoreLocalDate: null,
            timeZone: KST_TIME_ZONE,
          };

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

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
    const members = await listUsersByOrganization(organizationId);
    if (members.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const memberIds = members.map((u) => u.id);
    const relevant = await listSessionsByUsers(memberIds, { isComposite: true, isValid: true });
    if (relevant.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const metricsScores = await listMetricsBySessionIds(relevant.map((s) => s.id));
    const bySid = new Map(metricsScores.map((m) => [m.sessionId, m]));

    const dayMap = new Map<string, MetricsScore[]>();
    for (const s of relevant) {
      const m = bySid.get(s.id);
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
 */
router.get('/:sessionId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { sessionId } = req.params;
    const session = await findSessionById(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const users = await actorTargetUsers(authReq.user, session.userId);
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
 */
router.put('/:sessionId', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const { sessionId } = req.params;
    const updateData = req.body;

    const existing = await findSessionById(sessionId);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    const users = await actorTargetUsers(authReq.user, existing.userId);
    if (!userCanActOnTargetUserId(authReq.user, existing.userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    if (updateData.userId != null && updateData.userId !== existing.userId) {
      return res.status(403).json({ success: false, error: 'Cannot change session userId' });
    }

    const merged: Session = { ...existing, ...updateData, id: sessionId };
    await upsertSession(merged);
    invalidateRankingsCache();

    res.json({ success: true, data: merged });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
