/**
 * `POST /api/sessions` idempotency E2E 회귀 테스트.
 *
 * 보호 대상 (task #33):
 *  - 클라이언트가 같은 `Idempotency-Key` 로 두 번 요청해도 세션은 1건만 저장되고,
 *    두 번째 응답은 첫 번째와 동일한 status/body 를 그대로 반환한다.
 *  - 키가 없으면 기존 동작대로 매번 새 세션을 만든다.
 *  - 서로 다른 사용자가 우연히 같은 키를 보내도 캐시가 섞이지 않는다.
 *  - 같은 키라도 라우트 scope 가 다르면 캐시가 분리된다 (스코프 분리 검증).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Session, User } from '@noilink/shared';
import {
  buildIdempotencyCacheKey,
  IDEMPOTENCY_STORE_KEY,
  withIdempotency,
} from '../utils/idempotency.js';

const store: Record<string, any> = {
  users: [],
  sessions: [],
  idempotency: {},
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
  optionalAuth: (req: any, _res: any, next: any) => {
    if (currentActor.user) req.user = currentActor.user;
    next();
  },
}));

const { default: sessionsRouter } = await import('./sessions.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sessions', sessionsRouter);
  return app;
}

const ACTOR: User = {
  id: 'u1',
  username: 'tester',
  name: 'Tester',
  userType: 'PERSONAL',
  streak: 0,
  createdAt: new Date('2025-01-01').toISOString(),
};

const OTHER_ACTOR: User = {
  ...ACTOR,
  id: 'u2',
  username: 'tester2',
  name: 'Tester 2',
};

const PAYLOAD = {
  userId: 'u1',
  mode: 'FOCUS',
  bpm: 60,
  level: 1,
  duration: 30_000,
  isComposite: false,
  isValid: true,
  phases: [],
};

beforeEach(() => {
  store.users = [ACTOR, OTHER_ACTOR];
  store.sessions = [];
  store.idempotency = {};
  currentActor.user = ACTOR;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/sessions — Idempotency-Key 보호 (task #33)', () => {
  it('같은 키로 두 번 요청해도 세션은 1건만 저장되고, 두 번째 응답은 첫 응답과 완전히 동일하다', async () => {
    const app = buildApp();

    const first = await request(app)
      .post('/api/sessions')
      .set('Idempotency-Key', 'pending-abc')
      .send(PAYLOAD);
    expect(first.status).toBe(201);
    expect(first.body.success).toBe(true);
    expect((store.sessions as Session[])).toHaveLength(1);
    const firstSessionId = first.body.data.id;

    const second = await request(app)
      .post('/api/sessions')
      .set('Idempotency-Key', 'pending-abc')
      .send(PAYLOAD);
    expect(second.status).toBe(201);
    // 두 번째 응답은 캐시에서 재반환 — id 가 동일해야 한다(새 row 가 만들어지지 않음 증거).
    expect(second.body.data.id).toBe(firstSessionId);
    expect(second.body).toEqual(first.body);
    expect((store.sessions as Session[])).toHaveLength(1);

    // 캐시 항목이 (sessions.create | userId | key) 로 정확히 적재됐는지 확인.
    const cacheKey = buildIdempotencyCacheKey('sessions.create', ACTOR.id, 'pending-abc');
    expect(store[IDEMPOTENCY_STORE_KEY][cacheKey]).toBeDefined();
    expect(store[IDEMPOTENCY_STORE_KEY][cacheKey].status).toBe(201);
  });

  it('Idempotency-Key 헤더가 없으면 매 요청마다 새 세션이 생성된다 (기존 동작 유지)', async () => {
    const app = buildApp();

    await request(app).post('/api/sessions').send(PAYLOAD).expect(201);
    await request(app).post('/api/sessions').send(PAYLOAD).expect(201);

    expect((store.sessions as Session[])).toHaveLength(2);
    // 키가 없으면 캐시도 비어있어야 한다.
    expect(Object.keys(store[IDEMPOTENCY_STORE_KEY])).toHaveLength(0);
  });

  it('서로 다른 사용자가 같은 키를 보내도 캐시가 섞이지 않고 각자 1건씩 저장된다', async () => {
    const app = buildApp();

    currentActor.user = ACTOR;
    const a = await request(app)
      .post('/api/sessions')
      .set('Idempotency-Key', 'shared-key')
      .send({ ...PAYLOAD, userId: 'u1' });
    expect(a.status).toBe(201);

    currentActor.user = OTHER_ACTOR;
    const b = await request(app)
      .post('/api/sessions')
      .set('Idempotency-Key', 'shared-key')
      .send({ ...PAYLOAD, userId: 'u2' });
    expect(b.status).toBe(201);

    // 같은 키지만 userId 가 다르므로 캐시가 분리되어 두 세션 모두 저장.
    expect((store.sessions as Session[])).toHaveLength(2);
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });

  it('같은 사용자·같은 키라도 scope 가 다르면 캐시가 분리된다 (라우트 간 충돌 방지)', async () => {
    // sessions.create 가 먼저 캐시를 채워둔다.
    const app = buildApp();
    await request(app)
      .post('/api/sessions')
      .set('Idempotency-Key', 'same-key')
      .send(PAYLOAD)
      .expect(201);

    // 동일 키지만 다른 scope 로 호출 → 캐시 hit 이 아니라 핸들러가 다시 실행되어야 한다.
    let invocations = 0;
    const tinyApp = express();
    tinyApp.use(express.json());
    tinyApp.post('/dummy', async (req, res) => {
      await withIdempotency(
        req,
        res,
        { scope: 'metrics.calculate', userId: ACTOR.id },
        async () => {
          invocations += 1;
          res.status(201).json({ success: true, data: { tag: 'metrics' } });
        },
      );
    });

    const r = await request(tinyApp).post('/dummy').set('Idempotency-Key', 'same-key').send({});
    expect(r.status).toBe(201);
    expect(r.body.data.tag).toBe('metrics');
    expect(invocations).toBe(1);
  });
});
