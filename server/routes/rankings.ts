/**
 * Rankings API — 명세 5장 (14일 창, 일일 상위 2회 반영, 동점 시각)
 */

import { Router, Request, Response } from 'express';
import {
  findUserById,
  listAllUsers,
  listSessionsByUsers,
  listSessions,
  listRankings,
  replaceAllRankings,
  clearRankings,
} from '../db/repositories/index.js';
import type { RankingEntry, RankingType, Session, User } from '@noilink/shared';
import { isoToKstLocalDate } from '@noilink/shared';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { userCanActOnTargetUserId } from '../utils/session-user-policy.js';
import {
  ensureRankings as ensureRankingsCached,
  invalidateRankingsCache,
} from '../services/rankings-cache.js';

const router = Router();

const MS_DAY = 24 * 60 * 60 * 1000;
const RANKING_WINDOW_DAYS = 14;

function dayKey(iso: string): string {
  return isoToKstLocalDate(iso) ?? new Date(iso).toISOString().slice(0, 10);
}

function rankingDisplayName(user: User): string {
  if (user.userType === 'ORGANIZATION') {
    return (user.name && user.name.trim()) || user.username;
  }
  return (user.nickname && user.nickname.trim()) || user.name || user.username;
}

function compositeRankingScore(
  sessions: Session[],
  userId: string,
  windowStart: number
): { score: number; tieBreakAt: string; sessionCount: number } | null {
  const composite = sessions.filter(
    (s) =>
      s.userId === userId &&
      s.isComposite &&
      s.isValid &&
      s.score !== undefined &&
      s.score !== null &&
      new Date(s.createdAt).getTime() >= windowStart
  );
  if (composite.length === 0) return null;

  const byDay = new Map<string, Session[]>();
  for (const s of composite) {
    const k = dayKey(s.createdAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(s);
  }

  const pooled: { weighted: number; createdAt: string }[] = [];
  for (const arr of byDay.values()) {
    const scored = arr
      .map((s) => ({ weighted: (s.score as number) * 1.2, createdAt: s.createdAt }))
      .sort((a, b) => b.weighted - a.weighted)
      .slice(0, 2);
    pooled.push(...scored);
  }

  pooled.sort((a, b) => b.weighted - a.weighted || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const top3 = pooled.slice(0, 3);
  if (top3.length === 0) return null;

  const score = top3.reduce((sum, x) => sum + x.weighted, 0) / top3.length;
  const tieBreakAt = [...top3.map((x) => x.createdAt)].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  )[0];

  return { score: Math.round(score), tieBreakAt, sessionCount: top3.length };
}

function totalTimeRanking(
  sessions: Session[],
  userId: string,
  windowStart: number
): { score: number; tieBreakAt: string; sessionCount: number } | null {
  const list = sessions.filter((s) => s.userId === userId && new Date(s.createdAt).getTime() >= windowStart);
  if (list.length === 0) return null;
  const totalMs = list.reduce((sum, s) => sum + s.duration, 0);
  const tieBreakAt = [...list.map((s) => s.createdAt)].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  )[0];
  return { score: Math.round(totalMs / 1000), tieBreakAt, sessionCount: list.length };
}

function streakInWindow(sessions: Session[], userId: string, windowStart: number, now: number): number {
  const days = new Set<string>();
  for (const s of sessions) {
    if (s.userId !== userId) continue;
    const t = new Date(s.createdAt).getTime();
    if (t >= windowStart && t <= now) days.add(dayKey(s.createdAt));
  }
  if (days.size === 0) return 0;
  const sorted = [...days].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const a = new Date(sorted[i - 1] + 'T12:00:00.000Z').getTime();
    const b = new Date(sorted[i] + 'T12:00:00.000Z').getTime();
    const diff = Math.round((b - a) / MS_DAY);
    if (diff === 1) run += 1;
    else run = 1;
    best = Math.max(best, run);
  }
  return best;
}

type RankScratch = RankingEntry & { _tie: string; _secondary: number };

function sortScratch(a: RankScratch, b: RankScratch, type: RankingType): number {
  if (b.score !== a.score) return b.score - a.score;
  if (type === 'TOTAL_TIME' && b._secondary !== a._secondary) {
    return b._secondary - a._secondary;
  }
  return new Date(a._tie).getTime() - new Date(b._tie).getTime();
}

export async function calculateRankings(): Promise<void> {
  const users = await listAllUsers();
  const now = Date.now();
  const fourteenAgo = now - 14 * MS_DAY;
  const sinceIso = new Date(fourteenAgo).toISOString();

  const activeUsers = users.filter((u) => !u.isDeleted);
  const activeIds = activeUsers.map((u) => u.id);
  const sessions = await listSessionsByUsers(activeIds, { sinceCreatedAt: sinceIso });

  const sessionsByUser = new Map<string, Session[]>();
  for (const s of sessions) {
    const arr = sessionsByUser.get(s.userId) ?? [];
    arr.push(s);
    sessionsByUser.set(s.userId, arr);
  }

  const scratch: RankScratch[] = [];

  for (const user of activeUsers) {
    const userSessions = sessionsByUser.get(user.id) ?? [];

    const c = compositeRankingScore(userSessions, user.id, fourteenAgo);
    if (c) {
      scratch.push({
        userId: user.id,
        username: rankingDisplayName(user),
        userType: user.userType,
        organizationId: user.organizationId,
        rankingType: 'COMPOSITE_SCORE',
        score: c.score,
        rank: 0,
        metadata: { sessionCount: c.sessionCount, tieBreakAt: c.tieBreakAt },
        calculatedAt: new Date().toISOString(),
        _tie: c.tieBreakAt,
        _secondary: c.sessionCount,
      });
    }

    const t = totalTimeRanking(userSessions, user.id, fourteenAgo);
    if (t) {
      scratch.push({
        userId: user.id,
        username: rankingDisplayName(user),
        userType: user.userType,
        organizationId: user.organizationId,
        rankingType: 'TOTAL_TIME',
        score: t.score,
        rank: 0,
        metadata: { sessionCount: t.sessionCount, tieBreakAt: t.tieBreakAt },
        calculatedAt: new Date().toISOString(),
        _tie: t.tieBreakAt,
        _secondary: t.sessionCount,
      });
    }

    const streak = streakInWindow(userSessions, user.id, fourteenAgo, now);
    if (streak > 0) {
      const userSess = userSessions.filter(
        (s) => new Date(s.createdAt).getTime() >= fourteenAgo
      );
      const tieBreakAt =
        userSess.length > 0
          ? [...userSess.map((s) => s.createdAt)].sort(
              (a, b) => new Date(a).getTime() - new Date(b).getTime()
            )[0]
          : new Date().toISOString();
      scratch.push({
        userId: user.id,
        username: rankingDisplayName(user),
        userType: user.userType,
        organizationId: user.organizationId,
        rankingType: 'STREAK',
        score: streak,
        rank: 0,
        metadata: { sessionCount: userSess.length, tieBreakAt },
        calculatedAt: new Date().toISOString(),
        _tie: tieBreakAt,
        _secondary: userSess.length,
      });
    }
  }

  const rankingTypes: RankingType[] = ['COMPOSITE_SCORE', 'TOTAL_TIME', 'STREAK'];
  const rankings: RankingEntry[] = [];

  for (const type of rankingTypes) {
    const slice = scratch
      .filter((r) => r.rankingType === type)
      .sort((a, b) => sortScratch(a, b, type));
    slice.forEach((r, i) => {
      const { _tie: _x, _secondary: _y, ...entry } = r;
      rankings.push({ ...entry, rank: i + 1 });
    });
  }

  await replaceAllRankings(rankings);
}

/* ───────────────────────────────────────────────────────────
 * Task #164 — 랭킹 캐싱
 *
 * `calculateRankings()` 는 14일 창 sessions 를 전 사용자에 대해 재계산해 `rankings`
 * 테이블에 replace 한다. 과거에는 `/api/rankings*` 요청마다 무조건 한 번씩 실행돼
 * 사용자/세션 수가 늘면 응답 비용이 선형으로 따라 올라갔다. TTL + 싱글플라이트는
 * `services/rankings-cache.ts` 에 분리 — 세션/메트릭/유저 라우트가 invalidate hook
 * 만 깨끗하게 끌어다 쓸 수 있게 (rankings 라우트의 requireAuth 의존 회피).
 * ─────────────────────────────────────────────────────────── */

async function ensureRankings(): Promise<void> {
  await ensureRankingsCached(() => calculateRankings());
}

/** admin reset 등에서 호출 — rankings 테이블을 비우고 캐시도 무효화. */
export async function clearRankingsAndCache(): Promise<void> {
  await clearRankings();
  invalidateRankingsCache();
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const { type, limit = '100', organizationId } = req.query;

    await ensureRankings();

    let rankings: RankingEntry[] = await listRankings({
      rankingType: type as RankingType | undefined,
      organizationId: organizationId as string | undefined,
    });

    const grouped: Record<string, RankingEntry[]> = {};
    for (const ranking of rankings) {
      if (!grouped[ranking.rankingType]) {
        grouped[ranking.rankingType] = [];
      }
      grouped[ranking.rankingType].push(ranking);
    }

    for (const k of Object.keys(grouped)) {
      const t = k as RankingType;
      grouped[k].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ma = (a.metadata?.sessionCount as number) || 0;
        const mb = (b.metadata?.sessionCount as number) || 0;
        if (t === 'TOTAL_TIME' && mb !== ma) return mb - ma;
        const ta = a.metadata?.tieBreakAt ? new Date(String(a.metadata.tieBreakAt)).getTime() : 0;
        const tb = b.metadata?.tieBreakAt ? new Date(String(b.metadata.tieBreakAt)).getTime() : 0;
        return ta - tb;
      });
      grouped[k] = grouped[k].slice(0, Number(limit));
    }

    res.json({ success: true, data: grouped });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

router.get('/user/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    await ensureRankings();

    const userRankings = await listRankings({ userId });

    res.json({ success: true, data: userRankings });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

router.get('/user/:userId/card', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { userId } = req.params;

    const actor = authReq.user!;
    const users: User[] = [actor];
    if (userId !== actor.id) {
      const t = await findUserById(userId);
      if (t) users.push(t);
    }
    if (!userCanActOnTargetUserId(actor, userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const now = Date.now();
    const windowStart = now - RANKING_WINDOW_DAYS * MS_DAY;
    const sinceIso = new Date(windowStart).toISOString();

    const sessions = await listSessions({ userId, sinceCreatedAt: sinceIso, order: 'desc' });

    const composite = compositeRankingScore(sessions, userId, windowStart);
    const total = totalTimeRanking(sessions, userId, windowStart);
    const streakDays = streakInWindow(sessions, userId, windowStart, now);

    const attendedDays = new Set<string>();
    for (const s of sessions) {
      if (s.isValid === false) continue;
      const t = new Date(s.createdAt).getTime();
      if (t >= windowStart && t <= now) attendedDays.add(dayKey(s.createdAt));
    }
    const attendanceRate = Math.round((attendedDays.size / RANKING_WINDOW_DAYS) * 100);

    await ensureRankings();
    const myList = await listRankings({ userId });
    const myRanks: { composite?: number; time?: number; streak?: number } = {};
    for (const r of myList) {
      if (r.rankingType === 'COMPOSITE_SCORE') myRanks.composite = r.rank;
      else if (r.rankingType === 'TOTAL_TIME') myRanks.time = r.rank;
      else if (r.rankingType === 'STREAK') myRanks.streak = r.rank;
    }

    res.json({
      success: true,
      data: {
        windowDays: RANKING_WINDOW_DAYS,
        compositeScore: composite ? composite.score : null,
        totalTimeHours: total ? Math.max(1, Math.round(total.score / 3600)) : 0,
        streakDays,
        attendanceRate,
        myRanks,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
