/**
 * Metrics API 라우트
 * 원시 메트릭 및 점수 관리
 */

import { Router, Request, Response } from 'express';
import {
  findUserById,
  findSessionById,
  upsertSession,
  findMetricsBySessionId,
  upsertMetricsScore,
  listMetricsByUser,
  findRawMetricsBySessionId,
  upsertRawMetrics,
  insertBleAbortEvent,
  insertAckBannerEvent,
} from '../db/repositories/index.js';
import { calculateAllMetrics } from '../services/score-calculator.js';
import { generateAndSavePersonalReport } from '../services/personal-report.js';
import type {
  AckBannerEvent,
  BleAbortEvent,
  RawMetrics,
  User,
} from '@noilink/shared';
import {
  sanitizeAckBannerEventInput,
  sanitizeBleAbortEventInput,
  sanitizeRecoveryRawMetrics,
} from '@noilink/shared';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { userCanActOnTargetUserId } from '../utils/session-user-policy.js';
import { withIdempotency } from '../utils/idempotency.js';
import { invalidateRankingsCache } from '../services/rankings-cache.js';

function normalizeRecoveryInPlace(rawMetrics: RawMetrics): void {
  const sanitized = sanitizeRecoveryRawMetrics(rawMetrics.recovery);
  if (sanitized) {
    rawMetrics.recovery = sanitized;
  } else {
    delete rawMetrics.recovery;
  }
}

const router = Router();

async function actorTargetUsers(actor: User, targetUserId: string): Promise<User[]> {
  const list: User[] = [actor];
  if (targetUserId !== actor.id) {
    const t = await findUserById(targetUserId);
    if (t) list.push(t);
  }
  return list;
}

async function assertActorForRawMetrics(
  authReq: AuthRequest,
  rawMetrics: RawMetrics
): Promise<{ status: number; error: string } | null> {
  if (!authReq.user) {
    return { status: 401, error: 'Authentication required' };
  }
  const users = await actorTargetUsers(authReq.user, rawMetrics.userId);
  if (!userCanActOnTargetUserId(authReq.user, rawMetrics.userId, users)) {
    return { status: 403, error: 'Forbidden' };
  }
  const session = await findSessionById(rawMetrics.sessionId);
  if (!session) {
    return { status: 404, error: 'Session not found' };
  }
  if (session.userId !== rawMetrics.userId) {
    return { status: 400, error: 'userId does not match session' };
  }
  return null;
}

/**
 * POST /api/metrics/ble-abort — 익명 텔레메트리 (Task #57)
 */
router.post('/ble-abort', async (req: Request, res: Response) => {
  try {
    const sanitized = sanitizeBleAbortEventInput(req.body);
    if (!sanitized) {
      return res.status(202).json({ success: true, ignored: true });
    }

    const occurredAt = new Date().toISOString();
    const event: BleAbortEvent = { occurredAt, ...sanitized };

    await insertBleAbortEvent({
      id: `ble_abort_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: occurredAt,
      ...event,
    });

    console.info(
      `[ble-abort] windows=${event.windows} totalMs=${event.totalMs} ` +
        `bleUnstable=${event.bleUnstable} apiMode=${event.apiMode ?? '-'}`,
    );

    return res.status(202).json({ success: true });
  } catch (error) {
    console.error('[ble-abort] failed to record event', error);
    return res.status(202).json({ success: true, recorded: false });
  }
});

/**
 * POST /api/metrics/ack-banner — 익명 텔레메트리 (Task #116)
 */
router.post('/ack-banner', async (req: Request, res: Response) => {
  try {
    const sanitized = sanitizeAckBannerEventInput(req.body);
    if (!sanitized) {
      return res.status(202).json({ success: true, ignored: true });
    }

    const occurredAt = new Date().toISOString();
    const event: AckBannerEvent = { occurredAt, ...sanitized };

    await insertAckBannerEvent({
      id: `ack_banner_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: occurredAt,
      ...event,
    });

    console.info(
      `[ack-banner] reason=${event.reason} burstCount=${event.burstCount} ` +
        `burstDurationMs=${event.burstDurationMs}`,
    );

    return res.status(202).json({ success: true });
  } catch (error) {
    console.error('[ack-banner] failed to record event', error);
    return res.status(202).json({ success: true, recorded: false });
  }
});

/**
 * POST /api/metrics/raw
 */
router.post('/raw', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const rawMetrics: RawMetrics = req.body;

    if (!rawMetrics.sessionId || !rawMetrics.userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sessionId, userId',
      });
    }

    const denied = await assertActorForRawMetrics(authReq, rawMetrics);
    if (denied) {
      return res.status(denied.status).json({ success: false, error: denied.error });
    }

    await withIdempotency(
      req,
      res,
      { scope: 'metrics.raw', userId: authReq.user!.id },
      async () => {
        rawMetrics.createdAt = rawMetrics.createdAt || new Date().toISOString();
        normalizeRecoveryInPlace(rawMetrics);
        await upsertRawMetrics(rawMetrics);
        res.status(201).json({ success: true, data: rawMetrics });
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
 * POST /api/metrics/calculate
 */
router.post('/calculate', optionalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const rawMetrics: RawMetrics = req.body;

    if (!rawMetrics.sessionId || !rawMetrics.userId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sessionId, userId',
      });
    }

    const denied = await assertActorForRawMetrics(authReq, rawMetrics);
    if (denied) {
      return res.status(denied.status).json({ success: false, error: denied.error });
    }

    await withIdempotency(
      req,
      res,
      { scope: 'metrics.calculate', userId: authReq.user!.id },
      async () => {
        const metricsScore = await calculateAllMetrics(rawMetrics);

        rawMetrics.createdAt = rawMetrics.createdAt || new Date().toISOString();
        normalizeRecoveryInPlace(rawMetrics);
        await upsertRawMetrics(rawMetrics);

        await upsertMetricsScore(metricsScore);

        // 세션 점수 업데이트
        const session = await findSessionById(rawMetrics.sessionId);
        if (session) {
          const scores = [
            metricsScore.memory,
            metricsScore.comprehension,
            metricsScore.focus,
            metricsScore.judgment,
            metricsScore.agility,
            metricsScore.endurance,
          ].filter((s): s is number => s !== undefined);

          if (scores.length > 0) {
            const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
            session.score = Math.round(avgScore);
            await upsertSession(session);
            invalidateRankingsCache();
          }
        }

        void generateAndSavePersonalReport(rawMetrics.userId);

        res.status(201).json({ success: true, data: metricsScore });
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
 * GET /api/metrics/session/:sessionId
 */
router.get('/session/:sessionId', optionalAuth, async (req: Request, res: Response) => {
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

    const rawMetrics = await findRawMetricsBySessionId(sessionId);
    const metricsScore = await findMetricsBySessionId(sessionId);

    res.json({
      success: true,
      data: {
        raw: rawMetrics || null,
        score: metricsScore || null,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/metrics/user/:userId
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
    const { limit = 50 } = req.query;

    const userScores = await listMetricsByUser(userId, { limit: Number(limit) });

    res.json({ success: true, data: userScores });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
