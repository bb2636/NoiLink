/**
 * `GET /api/rankings/user/:userId/card` 의 FREE 모드 세션 포함 보호 (Task #154).
 *
 * H. 자유 트레이닝(FREE) 은 점수 산출이 없는 연습 모드라 metrics 가 저장되지
 * 않는다. 그러나 사용자의 "오늘 얼마나 운동했는지" 와 "며칠 연속 했는지" 는
 * FREE 도 포함되어야 한다 — 그래야 "쉬운 자유 연습으로도 출석 streak 을 이어갈
 * 수 있다" 는 사용자 흐름이 깨지지 않는다.
 *
 * 회귀 보호:
 *  - totalTimeHours: FREE 세션 duration 이 14일 합계에 그대로 잡힌다.
 *  - streakDays: FREE 만 한 날도 출석한 날로 카운트되어 연속 일수에 들어간다.
 *  - attendanceRate: FREE 세션이 isValid:true 면 출석한 일자에 포함된다.
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

function ago(days: number): string {
  const t = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(t).toISOString();
}

beforeEach(() => {
  store.users = [ACTOR];
  store.sessions = [];
  store.rankings = [];
  currentActor.user = ACTOR;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/rankings/user/:userId/card — FREE 모드 포함 (Task #154)', () => {
  it('FREE 세션 duration 도 totalTimeHours 합계에 잡힌다', async () => {
    store.sessions = [
      // FREE 1.5h + FOCUS 1h = 2.5h → round = 3
      {
        id: 'f1', userId: 'u-actor', mode: 'FREE', bpm: 60, level: 1,
        duration: 90 * 60 * 1000, isComposite: false, isValid: true,
        phases: [], createdAt: ago(1),
      } as Session,
      {
        id: 't2', userId: 'u-actor', mode: 'FOCUS', bpm: 60, level: 1,
        duration: 60 * 60 * 1000, isComposite: false, isValid: true,
        phases: [], createdAt: ago(2),
      } as Session,
    ];
    const res = await request(buildApp()).get('/api/rankings/user/u-actor/card');
    expect(res.status).toBe(200);
    expect(res.body.data.totalTimeHours).toBe(3);
  });

  it('FREE 세션만으로도 streakDays 가 누적된다 (다른 모드 0건이어도)', async () => {
    // 14일 창 안 연속 3일 모두 FREE 만 — streakDays 가 3 이어야 한다.
    store.sessions = [
      { id: 'f1', userId: 'u-actor', mode: 'FREE', bpm: 60, level: 1, duration: 60_000, isComposite: false, isValid: true, phases: [], createdAt: ago(1) } as Session,
      { id: 'f2', userId: 'u-actor', mode: 'FREE', bpm: 60, level: 1, duration: 60_000, isComposite: false, isValid: true, phases: [], createdAt: ago(2) } as Session,
      { id: 'f3', userId: 'u-actor', mode: 'FREE', bpm: 60, level: 1, duration: 60_000, isComposite: false, isValid: true, phases: [], createdAt: ago(3) } as Session,
    ];
    const res = await request(buildApp()).get('/api/rankings/user/u-actor/card');
    expect(res.status).toBe(200);
    expect(res.body.data.streakDays).toBe(3);
  });

  it('FREE 세션이 attendanceRate(출석률) 에도 카운트된다', async () => {
    // 14일 창 안 2개 고유 일자 모두 FREE → 2/14 = 14.28% → round = 14
    store.sessions = [
      { id: 'f1', userId: 'u-actor', mode: 'FREE', bpm: 60, level: 1, duration: 60_000, isComposite: false, isValid: true, phases: [], createdAt: ago(1) } as Session,
      { id: 'f2', userId: 'u-actor', mode: 'FREE', bpm: 60, level: 1, duration: 60_000, isComposite: false, isValid: true, phases: [], createdAt: ago(3) } as Session,
    ];
    const res = await request(buildApp()).get('/api/rankings/user/u-actor/card');
    expect(res.status).toBe(200);
    expect(res.body.data.attendanceRate).toBe(14);
  });
});
