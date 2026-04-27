/**
 * Rankings API — 명세 5장 (14일 창, 일일 상위 2회 반영, 동점 시각)
 */

import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import type { RankingEntry, RankingType, Session, User } from '@noilink/shared';
import { isoToKstLocalDate } from '@noilink/shared';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { userCanActOnTargetUserId } from '../utils/session-user-policy.js';

const router = Router();

const MS_DAY = 24 * 60 * 60 * 1000;
/** 카드/랭킹 집계가 함께 사용하는 공통 14일 창 길이 (명세 5장). */
const RANKING_WINDOW_DAYS = 14;

/**
 * 일자 키. 출석률·연속 일수 산정 모두 KST 기준 (Asia/Seoul) 으로 묶어
 * 디바이스 시간대/서버 UTC 와 무관하게 한국 사용자의 달력 일치를 보장한다.
 * (Task #132: KST 라벨 단일 진실원, `shared/kst-date.ts`)
 */
function dayKey(iso: string): string {
  return isoToKstLocalDate(iso) ?? new Date(iso).toISOString().slice(0, 10);
}

/** 개인: 닉네임 우선, 기관 소속: 본명 */
function rankingDisplayName(user: User): string {
  if (user.userType === 'ORGANIZATION') {
    return (user.name && user.name.trim()) || user.username;
  }
  return (user.nickname && user.nickname.trim()) || user.name || user.username;
}

/**
 * 종합 점수 랭킹: 최근 14일, 일 최대 2회(가중 상위)만 풀에 넣은 뒤 상위 3회 평균(가중 1.2 반영됨)
 */
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

  const score =
    top3.reduce((sum, x) => sum + x.weighted, 0) / top3.length;
  const tieBreakAt = [...top3.map((x) => x.createdAt)].sort(
    (a, b) => new Date(a).getTime() - new Date(b).getTime()
  )[0];

  return {
    score: Math.round(score),
    tieBreakAt,
    sessionCount: top3.length,
  };
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
  return {
    score: Math.round(totalMs / 1000),
    tieBreakAt,
    sessionCount: list.length,
  };
}

/** 최근 14일 창 안에서 달력 연속 일수 최댓값 */
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

async function calculateRankings(): Promise<void> {
  const users: User[] = (await db.get('users')) || [];
  const sessions: Session[] = (await db.get('sessions')) || [];
  const now = Date.now();
  const fourteenAgo = now - 14 * MS_DAY;

  const scratch: RankScratch[] = [];

  for (const user of users) {
    if (user.isDeleted) continue;

    const c = compositeRankingScore(sessions, user.id, fourteenAgo);
    if (c) {
      scratch.push({
        userId: user.id,
        username: rankingDisplayName(user),
        userType: user.userType,
        organizationId: user.organizationId,
        rankingType: 'COMPOSITE_SCORE',
        score: c.score,
        rank: 0,
        metadata: {
          sessionCount: c.sessionCount,
          tieBreakAt: c.tieBreakAt,
        },
        calculatedAt: new Date().toISOString(),
        _tie: c.tieBreakAt,
        _secondary: c.sessionCount,
      });
    }

    const t = totalTimeRanking(sessions, user.id, fourteenAgo);
    if (t) {
      scratch.push({
        userId: user.id,
        username: rankingDisplayName(user),
        userType: user.userType,
        organizationId: user.organizationId,
        rankingType: 'TOTAL_TIME',
        score: t.score,
        rank: 0,
        metadata: {
          sessionCount: t.sessionCount,
          tieBreakAt: t.tieBreakAt,
        },
        calculatedAt: new Date().toISOString(),
        _tie: t.tieBreakAt,
        _secondary: t.sessionCount,
      });
    }

    const streak = streakInWindow(sessions, user.id, fourteenAgo, now);
    if (streak > 0) {
      const userSess = sessions.filter(
        (s) => s.userId === user.id && new Date(s.createdAt).getTime() >= fourteenAgo
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

  await db.set('rankings', rankings);
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const { type, limit = '100', organizationId } = req.query;

    await calculateRankings();

    let rankings: RankingEntry[] = (await db.get('rankings')) || [];

    if (type) {
      rankings = rankings.filter((r: RankingEntry) => r.rankingType === type);
    }
    if (organizationId) {
      rankings = rankings.filter((r: RankingEntry) => r.organizationId === organizationId);
    }

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

    await calculateRankings();

    const rankings: RankingEntry[] = (await db.get('rankings')) || [];
    const userRankings = rankings.filter((r: RankingEntry) => r.userId === userId);

    res.json({ success: true, data: userRankings });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/rankings/user/:userId/card
 *
 * "나의 랭킹" 카드 4개 stat 의 단일 진실원.
 * 모두 같은 14일 창 / 같은 사용자 세션 데이터에서 파생되어 카드 ↔ 랭킹표 사이의
 * 표시값 불일치(과거 데모 하드코딩 잔재) 를 원천 차단한다.
 *
 * 응답 필드
 *  - compositeScore: COMPOSITE 14일 창 / 일 상위 2회 / 가중 1.2 / 상위 3회 평균.
 *      해당 기간에 유효 COMPOSITE 세션이 없으면 null (UI 가 "-" 처리).
 *  - totalTimeHours: 14일 창 모든 세션 duration 합을 시간으로 반올림. 0이면 0.
 *      (랭킹표는 초 단위 score → Math.round(score/3600) 로 변환해 표시 중이므로
 *       카드도 같은 변환을 사용해 일치시킨다.)
 *  - streakDays: 14일 창 안에서 달력 기준 연속 일수 최댓값. 세션 없으면 0.
 *  - attendanceRate: 14일 중 유효 세션이 1건이라도 있는 일 수 / 14 × 100.
 *      랭킹표에는 노출되지 않지만 카드의 4번째 stat 으로 합쳐 같은 창 기준으로
 *      계산해 일관성을 보장한다.
 *  - myRanks: rankings 테이블의 사용자 본인 등수 (계산 결과가 없으면 해당 키 없음).
 *
 * 인가: 본인 / 관리자 / 동일 조직 기업 관리자 만 조회 가능.
 */
router.get('/user/:userId/card', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { userId } = req.params;

    const users: User[] = (await db.get('users')) || [];
    if (!userCanActOnTargetUserId(authReq.user!, userId, users)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const sessions: Session[] = (await db.get('sessions')) || [];
    const now = Date.now();
    const windowStart = now - RANKING_WINDOW_DAYS * MS_DAY;

    const composite = compositeRankingScore(sessions, userId, windowStart);
    const total = totalTimeRanking(sessions, userId, windowStart);
    const streakDays = streakInWindow(sessions, userId, windowStart, now);

    // 출석률: 14일 중 유효 세션이 1건이라도 있는 일 수
    const attendedDays = new Set<string>();
    for (const s of sessions) {
      if (s.userId !== userId) continue;
      if (s.isValid === false) continue;
      const t = new Date(s.createdAt).getTime();
      if (t >= windowStart && t <= now) attendedDays.add(dayKey(s.createdAt));
    }
    const attendanceRate = Math.round((attendedDays.size / RANKING_WINDOW_DAYS) * 100);

    // 등수는 이미 계산된 rankings 테이블에서 읽어와 카드와 랭킹표가 같은 라운드
    // 결과를 공유하도록 한다.
    await calculateRankings();
    const rankings: RankingEntry[] = (await db.get('rankings')) || [];
    const myRanks: { composite?: number; time?: number; streak?: number } = {};
    for (const r of rankings) {
      if (r.userId !== userId) continue;
      if (r.rankingType === 'COMPOSITE_SCORE') myRanks.composite = r.rank;
      else if (r.rankingType === 'TOTAL_TIME') myRanks.time = r.rank;
      else if (r.rankingType === 'STREAK') myRanks.streak = r.rank;
    }

    res.json({
      success: true,
      data: {
        windowDays: RANKING_WINDOW_DAYS,
        compositeScore: composite ? composite.score : null,
        // 랭킹표(`Ranking.tsx`)는 TOTAL_TIME 표시 시 `Math.max(1, round(score/3600))`
        // 로 1시간 미만 사용자도 1로 끌어올린다. 카드도 같은 식을 적용해
        // "표는 1시간 / 카드는 0시간" 같은 미세 불일치를 차단한다.
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
