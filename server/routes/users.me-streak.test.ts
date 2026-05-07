/**
 * `GET /api/users/me` 의 streak 자동 리셋 분기를 KST 기준으로 잠그는 테스트 (Task #152).
 *
 * Task #151 회귀 보호:
 *  - 마지막 훈련일이 어제·오늘이 아니면 streak 을 0 으로 리셋하는 분기는, 비교
 *    기준이 KST(`Asia/Seoul`) 가 아니라 UTC 면 KST 자정 직후 ~ KST 09:00 사이에
 *    조회한 "어제 훈련 기록" 이 "그제" 로 잘못 분류돼 streak 가 0 으로 리셋되는
 *    회귀가 있었다 (사용자가 새벽에 홈을 열기만 해도 카운터가 사라짐).
 *
 * 이 파일은 `vi.useFakeTimers` 로 시각을 KST 자정 직후로 고정하고,
 * `lastTrainingDate` 를 KST 기준 "어제" 에 해당하는 UTC ISO 로 시드해 둔 뒤
 * `/users/me` 가 streak 을 보존하는지 확인한다.
 *
 * 같이 잠그는 정책:
 *  - KST 기준 "오늘" 에 마지막 훈련을 한 경우에도 streak 보존.
 *  - 정말로 KST 이틀 이상 비웠을 때만 streak 리셋, 단 bestStreak 는 보관.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { User } from '@noilink/shared';

const store: Record<string, any> = {
  users: [],
};

vi.mock('../db.js', () => ({
  db: {
    get: vi.fn(async (key: string) => store[key]),
    set: vi.fn(async (key: string, value: any) => {
      store[key] = value;
    }),
  },
}));

const JWT_SECRET = 'test-secret-key-for-streak-tests';
process.env.JWT_SECRET = JWT_SECRET;

const { default: usersRouter } = await import('./users.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);
  return app;
}

const ACTOR_BASE: User = {
  id: 'u1',
  username: 'tester',
  name: 'Tester',
  email: 'tester@example.com',
  userType: 'PERSONAL',
  streak: 0,
  createdAt: new Date('2025-01-01').toISOString(),
};

function tokenFor(userId: string): string {
  return jwt.sign({ userId, email: 'tester@example.com' }, JWT_SECRET, { expiresIn: '1d' });
}

function getMe(app: ReturnType<typeof buildApp>) {
  return request(app)
    .get('/api/users/me')
    .set('Authorization', `Bearer ${tokenFor('u1')}`);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('GET /api/users/me — KST 기준 streak 자동 리셋 (Task #152)', () => {
  it('KST 자정 직후 조회: 어제 KST 의 훈련 기록은 "어제" 로 분류되어 streak 가 리셋되지 않는다', async () => {
    // now: UTC 2026-04-25 15:30 = KST 2026-04-26 00:30 (KST 자정 직후)
    vi.setSystemTime(new Date('2026-04-25T15:30:00.000Z'));

    // lastTrainingDate: UTC 2026-04-24 16:00 = KST 2026-04-25 01:00 → KST 04-25 (KST 어제)
    //  - UTC 기준(회귀): UTC 오늘=04-25, 어제=04-24, last=04-24 → 어제 → 보존되긴 함.
    //    하지만 더 위험한 케이스(아래 두 번째 테스트)는 UTC 와 KST 가 진짜로 갈리는
    //    경우를 다룬다. 이 테스트는 자정 직후 흔한 케이스의 streak 보존을 잠근다.
    store.users = [
      {
        ...ACTOR_BASE,
        streak: 5,
        bestStreak: 5,
        lastTrainingDate: '2026-04-24T16:00:00.000Z',
      },
    ];

    const res = await getMe(buildApp());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.streak).toBe(5);
    expect(res.body.data.bestStreak).toBe(5);
    // 영속 저장도 변경되지 않아야 한다.
    expect(store.users[0].streak).toBe(5);
  });

  it('KST 기준 "어제" 인데 UTC 기준으로는 "그제" 인 경계 케이스에서 streak 가 리셋되지 않는다 (회귀 핵심)', async () => {
    // now: UTC 2026-04-26 14:30 = KST 2026-04-26 23:30 → KST 오늘 = 04-26
    vi.setSystemTime(new Date('2026-04-26T14:30:00.000Z'));

    // lastTrainingDate: UTC 2026-04-24 15:30 = KST 2026-04-25 00:30 → KST 04-25 (= KST 어제)
    //  - UTC 기준(회귀): UTC 오늘=04-26, 어제=04-25, last(UTC)=04-24 → "그제" → 리셋 발생.
    //  - KST 기준(정상): KST 오늘=04-26, 어제=04-25, last(KST)=04-25 → "어제" → 보존.
    store.users = [
      {
        ...ACTOR_BASE,
        streak: 7,
        bestStreak: 7,
        lastTrainingDate: '2026-04-24T15:30:00.000Z',
      },
    ];

    const res = await getMe(buildApp());
    expect(res.status).toBe(200);
    // 핵심: 새벽에 홈을 열기만 해도 카운터가 사라지는 회귀가 살아나면 0 으로 떨어진다.
    expect(res.body.data.streak).toBe(7);
    expect(res.body.data.bestStreak).toBe(7);
    expect(store.users[0].streak).toBe(7);
  });

  it('KST 기준 "오늘" 마지막 훈련은 당연히 보존된다', async () => {
    // now: UTC 2026-04-26 03:00 = KST 2026-04-26 12:00 → KST 오늘 = 04-26
    vi.setSystemTime(new Date('2026-04-26T03:00:00.000Z'));
    // lastTrainingDate: 같은 KST 04-26
    store.users = [
      {
        ...ACTOR_BASE,
        streak: 3,
        bestStreak: 3,
        lastTrainingDate: '2026-04-26T01:00:00.000Z',
      },
    ];

    const res = await getMe(buildApp());
    expect(res.status).toBe(200);
    expect(res.body.data.streak).toBe(3);
  });

  it('KST 기준 이틀 이상 비웠을 때는 streak 리셋, bestStreak 는 그대로 보관된다', async () => {
    // now: UTC 2026-04-27 03:00 = KST 2026-04-27 12:00 → KST 오늘 = 04-27
    vi.setSystemTime(new Date('2026-04-27T03:00:00.000Z'));
    // lastTrainingDate: UTC 2026-04-24 15:00 = KST 2026-04-25 00:00 → KST 04-25 (이틀 전)
    store.users = [
      {
        ...ACTOR_BASE,
        streak: 4,
        bestStreak: 9,
        lastTrainingDate: '2026-04-24T15:00:00.000Z',
      },
    ];

    const res = await getMe(buildApp());
    expect(res.status).toBe(200);
    expect(res.body.data.streak).toBe(0);
    // 역대 최고 기록은 보존
    expect(res.body.data.bestStreak).toBe(9);
    expect(store.users[0].streak).toBe(0);
    expect(store.users[0].bestStreak).toBe(9);
  });
});
