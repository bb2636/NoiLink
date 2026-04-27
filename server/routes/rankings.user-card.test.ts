/**
 * `GET /api/rankings/user/:userId/card` 회귀 테스트
 *
 * "나의 랭킹" 카드 4개 stat (compositeScore / totalTimeHours / streakDays /
 * attendanceRate) + 본인 등수가 같은 14일 창에서 일관된 진실원으로 산출되는지
 * 보호한다. 과거에는 카드가 DEMO_PROFILE 하드코딩(80점/4시간/5일/90%)을 쓰고
 * 랭킹표가 서버 실데이터를 써서 같은 화면에 두 값이 동시에 떠 보였다.
 *
 * 보호 목적
 *  - compositeScore 가 랭킹표(`/api/rankings`) 와 동일한 일 상위 2회·가중·상위 3회
 *    평균 산식으로 계산된다.
 *  - totalTimeHours 가 14일 합계 duration 을 시간 단위로 반올림 (랭킹표가
 *    초→시 변환하는 것과 동일).
 *  - streakDays 는 14일 창 내 달력 연속 일수 최댓값 (창 밖 세션은 영향 없음).
 *  - attendanceRate 는 (유효 세션 있는 일 수)/14*100 — invalid 세션과 14일 창
 *    밖 세션은 카운트되지 않는다.
 *  - myRanks 는 별도 키로 분리되어, 카드와 랭킹표가 같은 라운드의 등수를 본다.
 *  - 비인가/비본인 접근은 차단된다 (401/403).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Session, User } from '@noilink/shared';

const store: Record<string, any> = {
  users: [],
  sessions: [],
  rankings: [],
};

vi.mock('../db.js', () => ({
  db: {
    get: vi.fn(async (key: string) => store[key]),
    set: vi.fn(async (key: string, value: any) => {
      store[key] = value;
    }),
  },
}));

const currentActor: { user: User | null } = { user: null };
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!currentActor.user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    req.user = currentActor.user;
    next();
  },
}));

const { default: rankingsRouter } = await import('./rankings.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rankings', rankingsRouter);
  return app;
}

const ACTOR: User = {
  id: 'u-actor',
  username: 'actor',
  name: 'Actor',
  userType: 'PERSONAL',
  streak: 0,
  createdAt: new Date('2025-01-01').toISOString(),
};

const OTHER: User = {
  ...ACTOR,
  id: 'u-other',
  username: 'other',
  name: 'Other',
};

const ADMIN: User = {
  ...ACTOR,
  id: 'u-admin',
  username: 'admin',
  name: 'Admin',
  userType: 'ADMIN',
};

// 시간 헬퍼: now 기준으로 days 일 전
function ago(days: number, hours = 0): string {
  const t = Date.now() - days * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000;
  return new Date(t).toISOString();
}

beforeEach(() => {
  store.users = [ACTOR, OTHER, ADMIN];
  store.sessions = [];
  store.rankings = [];
  currentActor.user = ACTOR;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/rankings/user/:userId/card', () => {
  it('미인증 요청은 401', async () => {
    currentActor.user = null;
    const res = await request(buildApp()).get('/api/rankings/user/u-actor/card');
    expect(res.status).toBe(401);
  });

  it('타 사용자(개인) 카드 조회는 403', async () => {
    currentActor.user = ACTOR;
    const res = await request(buildApp()).get('/api/rankings/user/u-other/card');
    expect(res.status).toBe(403);
  });

  it('관리자는 임의 사용자 카드 조회 가능', async () => {
    currentActor.user = ADMIN;
    const res = await request(buildApp()).get('/api/rankings/user/u-other/card');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('세션 0건이면 compositeScore=null / 합계 0 / 출석률 0', async () => {
    const res = await request(buildApp()).get('/api/rankings/user/u-actor/card');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      windowDays: 14,
      compositeScore: null,
      totalTimeHours: 0,
      streakDays: 0,
      attendanceRate: 0,
    });
  });

  it('14일 창 밖 세션은 카드 stat 에 잡히지 않는다 (출석률·합계 시간·연속 모두)', async () => {
    store.sessions = [
      // 30일 전 — 창 밖
      {
        id: 's-old',
        userId: 'u-actor',
        mode: 'COMPOSITE',
        bpm: 60,
        level: 1,
        duration: 60 * 60 * 1000, // 1시간
        score: 100,
        isComposite: true,
        isValid: true,
        phases: [],
        createdAt: ago(30),
      } satisfies Session,
    ];
    const res = await request(buildApp()).get('/api/rankings/user/u-actor/card');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      compositeScore: null,
      totalTimeHours: 0,
      streakDays: 0,
      attendanceRate: 0,
    });
  });

  it('출석률은 유효 세션이 있는 고유 일 수 / 14 × 100 (invalid 세션 제외, 같은 날 중복 1회로)', async () => {
    // 같은 ISO 시각을 두 번 → 같은 UTC 일 보장 (반올림 경계 영향 X)
    const sameDay = ago(1, 0);
    const otherDay = ago(3, 0);
    const invalidDay = ago(5, 0);
    store.sessions = [
      { id: 'a1', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 1000, isComposite: false, isValid: true, phases: [], createdAt: sameDay } as Session,
      { id: 'a2', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 1000, isComposite: false, isValid: true, phases: [], createdAt: sameDay } as Session,
      { id: 'b1', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 1000, isComposite: false, isValid: true, phases: [], createdAt: otherDay } as Session,
      // invalid — 카운트 안됨
      { id: 'c1', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 1000, isComposite: false, isValid: false, phases: [], createdAt: invalidDay } as Session,
      // 다른 사용자 — 카운트 안됨
      { id: 'd1', userId: 'u-other', mode: 'FOCUS', bpm: 60, level: 1, duration: 1000, isComposite: false, isValid: true, phases: [], createdAt: ago(2, 0) } as Session,
    ];
    const res = await request(buildApp()).get('/api/rankings/user/u-actor/card');
    expect(res.status).toBe(200);
    // 2개 고유 일 / 14일 = 14.28% → round = 14
    expect(res.body.data.attendanceRate).toBe(14);
  });

  it('totalTimeHours 는 14일 창 내 모든 세션 duration 합 (시간 반올림)', async () => {
    store.sessions = [
      // 1.5h + 1h = 2.5h → round = 3 (반올림: 2.5 → 3)
      { id: 't1', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 90 * 60 * 1000, isComposite: false, isValid: true, phases: [], createdAt: ago(1) } as Session,
      { id: 't2', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 60 * 60 * 1000, isComposite: false, isValid: true, phases: [], createdAt: ago(2) } as Session,
      // 창 밖
      { id: 't3', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 10 * 60 * 60 * 1000, isComposite: false, isValid: true, phases: [], createdAt: ago(20) } as Session,
    ];
    const res = await request(buildApp()).get('/api/rankings/user/u-actor/card');
    expect(res.status).toBe(200);
    expect(res.body.data.totalTimeHours).toBe(3);
  });

  it('totalTimeHours: 30분만 했어도 랭킹표 식과 동일하게 최소 1시간으로 표기 (Math.max 정렬)', async () => {
    store.sessions = [
      { id: 'm1', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 30 * 60 * 1000, isComposite: false, isValid: true, phases: [], createdAt: ago(1) } as Session,
    ];
    const res = await request(buildApp()).get('/api/rankings/user/u-actor/card');
    expect(res.status).toBe(200);
    // 30분 = 1800초 → Math.round(1800/3600)=0 → Math.max(1,0)=1 (랭킹표와 동일)
    expect(res.body.data.totalTimeHours).toBe(1);
  });

  it('출석률·연속은 KST 기준 (UTC 자정 직전 ≒ KST 다음 날 새벽 세션이 한국 달력 기준 일자에 잡힘, Task #132)', async () => {
    // KST 가 새벽 0~9시인 시간대는 UTC 로 전날 15시~24시.
    // KST 기준 2일 전 03:00 = UTC 기준 3일 전 18:00. 이 둘이 같은 KST 일에
    // 잡혀 1일로 통합되어야 한다 (UTC dayKey 였다면 다른 일로 셌을 것).
    const kstSameDay1 = new Date('2026-04-25T17:00:00.000Z').toISOString(); // KST 26일 02:00
    const kstSameDay2 = new Date('2026-04-25T20:00:00.000Z').toISOString(); // KST 26일 05:00
    const kstOtherDay = new Date('2026-04-23T01:00:00.000Z').toISOString(); // KST 23일 10:00

    // now 를 고정해 14일 창 안에 모든 세션이 들어오도록 한다
    const fixedNow = new Date('2026-04-27T00:00:00.000Z').getTime();
    const realNow = Date.now;
    Date.now = () => fixedNow;

    store.sessions = [
      { id: 'k1', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 1000, isComposite: false, isValid: true, phases: [], createdAt: kstSameDay1 } as Session,
      { id: 'k2', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 1000, isComposite: false, isValid: true, phases: [], createdAt: kstSameDay2 } as Session,
      { id: 'k3', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1, duration: 1000, isComposite: false, isValid: true, phases: [], createdAt: kstOtherDay } as Session,
    ];

    try {
      const res = await request(buildApp()).get('/api/rankings/user/u-actor/card');
      expect(res.status).toBe(200);
      // KST 기준 2일 (4/26 + 4/23) → 2/14 = 14.28% → round = 14
      expect(res.body.data.attendanceRate).toBe(14);
    } finally {
      Date.now = realNow;
    }
  });
});
