/**
 * 라우트 통합 — 세션 mutation hook → 랭킹 GET 신선도 보장 (Task #167).
 *
 * Task #164 에서 `rankings-cache.ts` 의 TTL 캐시를 도입했고, 세션 저장/리셋
 * 경로에서 `invalidateRankingsCache()` 를 호출하도록 hook 을 추가했다. 단위
 * 테스트(`rankings.cache.test.ts`) 는 `invalidateRankingsCache()` 를 **직접**
 * 부르는 경로만 검증했기 때문에, 실제 사용자 흐름
 * (`POST /api/sessions` → 곧바로 `GET /api/rankings`) 에서 invalidate 호출이
 * 빠지거나 다른 캐시에 가려져 stale 결과가 노출되는 회귀를 잡지 못한다.
 *
 * 이 파일은 TTL > 0 (운영 디폴트와 동일한 60초) 인 상태에서 다음 세 흐름을
 * 라우트 레벨로 검증한다:
 *  (a) POST /api/sessions 직후 GET /api/rankings 가 새 세션의 점수를 반영.
 *  (b) PUT /api/sessions/:id 로 score 만 수정해도 다음 GET 이 갱신됨.
 *  (c) DELETE /api/users/me cascade 직후 다음 GET 에서 해당 사용자 entry 가 사라짐.
 *
 * 만약 어느 한 경로에서 invalidate hook 이 빠지면 두 번째 GET 이 TTL 안의
 * 캐시 hit 으로 첫 결과를 그대로 돌려줘 assertion 이 실패한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Session, User } from '@noilink/shared';

const store: Record<string, any> = {
  users: [],
  sessions: [],
  passwords: [],
  rankings: [],
  idempotency: {},
};

vi.mock('../db.js', () => ({
  db: {
    get: vi.fn(async (key: string) => store[key]),
    set: vi.fn(async (key: string, value: any) => {
      store[key] = value;
    }),
    // isConnected/connect 호출 시 throw 해도 isPostgresBackend() 가
    // 잡고 fall-through 해 KV 폴백 모드로 동작한다 (getPool 미존재 → false).
  },
}));

const currentActor: { user: User | null } = { user: null };

vi.mock('../middleware/auth.js', () => ({
  optionalAuth: (req: any, _res: any, next: any) => {
    if (currentActor.user) req.user = currentActor.user;
    next();
  },
  requireAuth: (req: any, res: any, next: any) => {
    if (!currentActor.user) {
      return res.status(401).json({ success: false, error: 'auth required' });
    }
    req.user = currentActor.user;
    next();
  },
}));

const { default: sessionsRouter } = await import('./sessions.js');
const { default: rankingsRouter } = await import('./rankings.js');
const { default: usersRouter } = await import('./users.js');
const { __setRankingsCacheTtlForTests } = await import(
  '../services/rankings-cache.js'
);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/rankings', rankingsRouter);
  app.use('/api/users', usersRouter);
  return app;
}

function makeUser(id: string, name: string): User {
  return {
    id,
    username: id,
    name,
    userType: 'PERSONAL',
    streak: 0,
    createdAt: new Date('2025-01-01').toISOString(),
  } as User;
}

function recentSession(opts: {
  id: string;
  userId: string;
  score: number;
  ageMs?: number;
}): Session {
  const ageMs = opts.ageMs ?? 24 * 60 * 60 * 1000;
  return {
    id: opts.id,
    userId: opts.userId,
    mode: 'FOCUS',
    bpm: 60,
    level: 1,
    duration: 60_000,
    score: opts.score,
    isComposite: true,
    isValid: true,
    phases: [],
    createdAt: new Date(Date.now() - ageMs).toISOString(),
  } as Session;
}

const USER_A = makeUser('u-a', 'Alpha');
const USER_B = makeUser('u-b', 'Bravo');

beforeEach(() => {
  store.users = [USER_A, USER_B];
  // 두 사용자 모두 14일 창 안의 composite 세션이 1건씩 있어 초기 랭킹이
  // 계산된다. 첫 GET 으로 캐시를 채운 뒤 mutation hook 이 그 캐시를 깨는지
  // 확인하기 위한 베이스라인.
  store.sessions = [
    recentSession({ id: 'sa1', userId: 'u-a', score: 50 }),
    recentSession({ id: 'sb1', userId: 'u-b', score: 80 }),
  ];
  store.passwords = [];
  store.rankings = [];
  store.idempotency = {};
  currentActor.user = USER_A;
  // 운영 디폴트와 동일한 TTL — invalidate hook 없이 두 번째 GET 은 캐시 hit.
  __setRankingsCacheTtlForTests(60_000);
});

afterEach(() => {
  __setRankingsCacheTtlForTests(0);
  vi.clearAllMocks();
});

function compositeScoreFor(body: any, userId: string): number | undefined {
  const list: any[] = body?.data?.COMPOSITE_SCORE ?? [];
  return list.find((e) => e.userId === userId)?.score;
}

describe('랭킹 신선도 — 세션/사용자 mutation 직후 GET 통합 (Task #167)', () => {
  it('(a) POST /api/sessions 직후 GET /api/rankings 가 새 세션을 반영한다 (TTL=60s)', async () => {
    const app = buildApp();

    // 1) 베이스라인 GET — USER_A 합성 점수 = 50 (1건 × 1.2 / 1 = 60).
    const first = await request(app).get('/api/rankings');
    expect(first.status).toBe(200);
    const aBefore = compositeScoreFor(first.body, 'u-a');
    expect(aBefore).toBe(60);

    // 2) USER_A 가 새 세션(점수 100) 을 저장 — 같은 날 상위 2건 평균이 올라간다.
    const post = await request(app)
      .post('/api/sessions')
      .send({
        userId: 'u-a',
        mode: 'FOCUS',
        bpm: 60,
        level: 1,
        duration: 60_000,
        score: 100,
        isComposite: true,
        isValid: true,
        phases: [],
      });
    expect(post.status).toBe(201);

    // 3) 곧바로 GET — invalidate hook 이 동작했다면 캐시 재계산되어 점수 상승.
    //     hook 이 빠졌다면 TTL 안의 캐시 hit 으로 첫 점수(60) 가 그대로 나옴.
    const second = await request(app).get('/api/rankings');
    expect(second.status).toBe(200);
    const aAfter = compositeScoreFor(second.body, 'u-a');
    expect(aAfter).toBeDefined();
    expect(aAfter!).toBeGreaterThan(aBefore!);
  });

  it('(b) PUT /api/sessions/:id 로 점수만 바꿔도 다음 GET 이 갱신된다', async () => {
    const app = buildApp();

    const first = await request(app).get('/api/rankings');
    const aBefore = compositeScoreFor(first.body, 'u-a');
    expect(aBefore).toBe(60);

    // 기존 sa1 의 score 를 50 → 200 으로 PUT — 합성 평균이 크게 오른다.
    const put = await request(app).put('/api/sessions/sa1').send({ score: 200 });
    expect(put.status).toBe(200);
    expect(put.body.data.score).toBe(200);

    const second = await request(app).get('/api/rankings');
    const aAfter = compositeScoreFor(second.body, 'u-a');
    // 한 건뿐인 sa1 의 weighted = 200 * 1.2 = 240.
    expect(aAfter).toBe(240);
  });

  it('(c) DELETE /api/users/me cascade 직후 다음 GET 에서 그 사용자가 사라진다', async () => {
    const app = buildApp();

    const first = await request(app).get('/api/rankings');
    const before: any[] = first.body.data.COMPOSITE_SCORE ?? [];
    expect(before.map((e) => e.userId).sort()).toEqual(['u-a', 'u-b']);

    // USER_A 가 회원 탈퇴 — cascadeDeleteUser 가 sessions/passwords/... 까지
    // 정리하고 invalidateRankingsCache() 를 호출한다.
    currentActor.user = USER_A;
    const del = await request(app).delete('/api/users/me');
    expect(del.status).toBe(200);

    // 다음 GET 은 USER_A 의 세션이 모두 사라졌으므로 랭킹에서 빠져야 한다.
    // hook 이 빠지면 TTL 안의 캐시 hit 으로 USER_A 가 그대로 남는다.
    currentActor.user = USER_B;
    const second = await request(app).get('/api/rankings');
    const after: any[] = second.body.data.COMPOSITE_SCORE ?? [];
    expect(after.map((e) => e.userId)).toEqual(['u-b']);
  });
});
