/**
 * `GET /api/rankings*` 캐싱 회귀 테스트 (Task #164).
 *
 * `calculateRankings()` 는 14일 창 sessions 를 전 사용자에 대해 재계산하므로
 * 사용자/세션 수가 늘면 응답 비용이 선형으로 증가한다. Task #164 에서 TTL 기반
 * 싱글플라이트 캐시를 도입했다 — 같은 TTL 안의 요청은 한 번만 계산하고 나머지는
 * `rankings` 테이블에서 바로 응답한다. 세션 저장/리셋 hook 이 `invalidateRankingsCache`
 * 를 부르면 다음 read 가 다시 신선하게 계산한다.
 *
 * 보호 항목:
 *  1. TTL 안의 연속 요청은 `calculateRankings` 의 핵심 의존(`db.get('users')`) 을
 *     한 번만 호출한다 (캐시 hit).
 *  2. `invalidateRankingsCache()` 호출 후 다음 요청은 다시 계산을 트리거한다.
 *  3. 동시 요청은 inflight 싱글플라이트로 합쳐 한 번만 계산한다.
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

const dbGetSpy = vi.fn(async (key: string) => store[key]);
const dbSetSpy = vi.fn(async (key: string, value: any) => {
  store[key] = value;
});

vi.mock('../db.js', () => ({
  db: {
    get: dbGetSpy,
    set: dbSetSpy,
  },
}));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

const { default: rankingsRouter } = await import('./rankings.js');
const { invalidateRankingsCache, __setRankingsCacheTtlForTests } = await import(
  '../services/rankings-cache.js'
);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/rankings', rankingsRouter);
  return app;
}

const USER: User = {
  id: 'u-1',
  username: 'u1',
  name: 'U1',
  userType: 'PERSONAL',
  streak: 0,
  createdAt: new Date('2025-01-01').toISOString(),
};

function recentSession(id: string): Session {
  return {
    id,
    userId: 'u-1',
    mode: 'FOCUS',
    bpm: 60,
    level: 1,
    duration: 60_000,
    isComposite: false,
    isValid: true,
    phases: [],
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  } as Session;
}

beforeEach(() => {
  store.users = [USER];
  store.sessions = [recentSession('s1')];
  store.rankings = [];
  dbGetSpy.mockClear();
  dbSetSpy.mockClear();
  // 기본 TTL 60s 로 명시적으로 캐시 활성화
  __setRankingsCacheTtlForTests(60_000);
});

afterEach(() => {
  // 다른 테스트 파일에 영향을 주지 않도록 TTL 0 (NODE_ENV=test 디폴트) 으로 복원
  __setRankingsCacheTtlForTests(0);
});

describe('GET /api/rankings — 캐싱 (Task #164)', () => {
  it('TTL 안의 두 번째 요청은 calculateRankings 를 다시 부르지 않는다 (users 조회 1회)', async () => {
    const app = buildApp();
    const a = await request(app).get('/api/rankings');
    expect(a.status).toBe(200);
    const usersReadsAfterFirst = dbGetSpy.mock.calls.filter((c) => c[0] === 'users').length;
    expect(usersReadsAfterFirst).toBeGreaterThanOrEqual(1);

    const b = await request(app).get('/api/rankings');
    expect(b.status).toBe(200);
    const usersReadsAfterSecond = dbGetSpy.mock.calls.filter((c) => c[0] === 'users').length;
    // 캐시 hit — calculateRankings 가 다시 호출되지 않았으므로 users 조회는 그대로.
    expect(usersReadsAfterSecond).toBe(usersReadsAfterFirst);
  });

  it('invalidateRankingsCache() 후 다음 요청은 다시 계산한다', async () => {
    const app = buildApp();
    await request(app).get('/api/rankings');
    const usersReadsBefore = dbGetSpy.mock.calls.filter((c) => c[0] === 'users').length;

    invalidateRankingsCache();

    await request(app).get('/api/rankings');
    const usersReadsAfter = dbGetSpy.mock.calls.filter((c) => c[0] === 'users').length;
    expect(usersReadsAfter).toBeGreaterThan(usersReadsBefore);
  });

  it('동시 요청은 inflight 싱글플라이트로 한 번만 계산한다', async () => {
    invalidateRankingsCache();
    const app = buildApp();
    const [a, b, c] = await Promise.all([
      request(app).get('/api/rankings'),
      request(app).get('/api/rankings'),
      request(app).get('/api/rankings'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(200);
    // 세 요청이 동시에 들어왔지만 calculateRankings 는 한 번만 — listAllUsers 가
    // 의존하는 db.get('users') 호출이 1번만 발생해야 한다.
    const usersReads = dbGetSpy.mock.calls.filter((c) => c[0] === 'users').length;
    expect(usersReads).toBe(1);
  });
});
