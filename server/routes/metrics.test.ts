/**
 * `POST /api/metrics/calculate` 및 `POST /api/metrics/raw` 회복 페이로드 정규화 회귀 테스트.
 *
 * 잘못된 모양(음수·NaN·누락)의 recovery 가 들어와도 저장 직전에
 * sanitizeRecoveryRawMetrics 가 항상 한 번 적용되어 통계·코칭 신호의
 * 입력값이 오염되지 않음을 보호한다 (task #46, #58).
 *
 * `/raw` 와 `/calculate` 양쪽 모두 동일한 정규화를 거치므로, 두 라우트가
 * 같은 음수/NaN/누락/well-formed 케이스에 대해 같은 결과를 내는지 잠근다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { RawMetrics, Session, User } from '@noilink/shared';

// 인메모리 DB — 테스트별로 beforeEach 에서 초기화된다.
const store: Record<string, any> = {
  users: [],
  sessions: [],
  rawMetrics: [],
  metricsScores: [],
};

vi.mock('../db.js', () => ({
  db: {
    get: vi.fn(async (key: string) => store[key]),
    set: vi.fn(async (key: string, value: any) => {
      store[key] = value;
    }),
  },
}));

// 인증 미들웨어는 JWT/실제 DB 체인 대신, 테스트가 지정한 actor 를 그대로 부착한다.
const currentActor: { user: User | null } = { user: null };
vi.mock('../middleware/auth.js', () => ({
  optionalAuth: (req: any, _res: any, next: any) => {
    if (currentActor.user) req.user = currentActor.user;
    next();
  },
}));

// 점수 계산은 본 테스트의 관심사가 아니므로 결정적인 더미 값을 반환한다.
vi.mock('../services/score-calculator.js', () => ({
  calculateAllMetrics: vi.fn(async (raw: RawMetrics) => ({
    sessionId: raw.sessionId,
    userId: raw.userId,
    memory: 70,
    comprehension: 70,
    focus: 70,
    judgment: 70,
    agility: 70,
    endurance: 70,
    createdAt: new Date().toISOString(),
  })),
}));

// 개인 리포트 생성은 fire-and-forget — 테스트에서는 호출만 무시한다.
vi.mock('../services/personal-report.js', () => ({
  generateAndSavePersonalReport: vi.fn(async () => undefined),
}));

// 라우터는 위 mock 들이 등록된 뒤에 import 해야 한다.
const { default: metricsRouter } = await import('./metrics.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/metrics', metricsRouter);
  return app;
}

const ACTOR_USER: User = {
  id: 'u1',
  username: 'tester',
  name: 'Tester',
  userType: 'PERSONAL',
  streak: 0,
  createdAt: new Date('2025-01-01').toISOString(),
};

const SEED_SESSION: Session = {
  id: 'sess-1',
  userId: 'u1',
  mode: 'FOCUS',
  bpm: 60,
  level: 1,
  duration: 30_000,
  isComposite: false,
  isValid: true,
  phases: [],
  createdAt: new Date('2025-01-02').toISOString(),
};

function baseRawMetrics(overrides: Partial<RawMetrics> = {}): RawMetrics {
  return {
    sessionId: 'sess-1',
    userId: 'u1',
    touchCount: 10,
    hitCount: 8,
    rtMean: 400,
    rtSD: 80,
    createdAt: new Date('2025-01-02T00:00:00Z').toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  store.users = [ACTOR_USER];
  store.sessions = [SEED_SESSION];
  store.rawMetrics = [];
  store.metricsScores = [];
  currentActor.user = ACTOR_USER;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/metrics/calculate — recovery 페이로드 정규화', () => {
  it('음수·NaN 으로 들어온 recovery 를 저장 직전에 0 으로 정규화하고 (양 끝이 모두 0이면) 필드를 제거한다', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      recovery: { excludedMs: -500, windows: Number.NaN },
    });

    const res = await request(app).post('/api/metrics/calculate').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(store.rawMetrics).toHaveLength(1);
    // 양 필드가 모두 0으로 클램프되면 sanitize 결과는 undefined → recovery 자체가 삭제되어야 한다.
    expect(store.rawMetrics[0]).not.toHaveProperty('recovery');
  });

  it('한쪽 필드만 살아있는 부분 손상 페이로드는 유효 부분을 보존하면서 음수·NaN 만 정규화한다', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      recovery: { excludedMs: 12_345.7, windows: -3 },
    });

    const res = await request(app).post('/api/metrics/calculate').send(payload);

    expect(res.status).toBe(201);
    expect(store.rawMetrics).toHaveLength(1);
    expect(store.rawMetrics[0].recovery).toEqual({ excludedMs: 12_346, windows: 0 });
  });

  it('recovery 필드가 누락된 페이로드는 그대로 누락 상태로 저장된다 (정규화 단계에서 추가하지 않는다)', async () => {
    const app = buildApp();
    const payload = baseRawMetrics();
    expect(payload.recovery).toBeUndefined();

    const res = await request(app).post('/api/metrics/calculate').send(payload);

    expect(res.status).toBe(201);
    expect(store.rawMetrics).toHaveLength(1);
    expect(store.rawMetrics[0]).not.toHaveProperty('recovery');
  });

  it('정상 모양의 recovery 는 반올림된 정수 값으로 보존된다', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      recovery: { excludedMs: 7_500.4, windows: 2 },
    });

    const res = await request(app).post('/api/metrics/calculate').send(payload);

    expect(res.status).toBe(201);
    expect(store.rawMetrics[0].recovery).toEqual({ excludedMs: 7_500, windows: 2 });
  });

  // ───────────────────────────────────────────────────────────
  // Task #61: 회복 segments(타임라인) 영속화 회귀.
  // 결과 화면(Result.tsx)이 보여주는 끊김 타임라인을 운영자가 지난 세션에서도
  // 다시 들여다볼 수 있도록, 서버는 sanitize 를 통과한 segments 를 그대로
  // rawMetrics 에 저장해야 한다 — 손상된 항목만 골라 떨어뜨려야 한다.
  // ───────────────────────────────────────────────────────────

  it('segments 가 포함된 정상 페이로드는 정수 ms 로 정규화되어 그대로 영속화된다 (Task #61)', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      recovery: {
        excludedMs: 4_123,
        windows: 2,
        segments: [
          { startedAt: 5_000.4, durationMs: 1_500.6 },
          { startedAt: 22_000, durationMs: 2_623 },
        ],
      },
    });

    const res = await request(app).post('/api/metrics/calculate').send(payload);

    expect(res.status).toBe(201);
    expect(store.rawMetrics[0].recovery).toEqual({
      excludedMs: 4_123,
      windows: 2,
      segments: [
        { startedAt: 5_000, durationMs: 1_501 },
        { startedAt: 22_000, durationMs: 2_623 },
      ],
    });
  });

  it('손상된 segments 항목(durationMs <= 0, 비-object) 만 떨궈내고 유효 항목은 보존한다', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      recovery: {
        excludedMs: 3_000,
        windows: 1,
        segments: [
          { startedAt: 1_000, durationMs: 0 },
          { startedAt: 2_000, durationMs: -50 },
          // @ts-expect-error - 잘못된 모양을 의도적으로 보냄
          null,
          { startedAt: 5_000, durationMs: 3_000 },
        ],
      },
    });

    const res = await request(app).post('/api/metrics/calculate').send(payload);

    expect(res.status).toBe(201);
    expect(store.rawMetrics[0].recovery).toEqual({
      excludedMs: 3_000,
      windows: 1,
      segments: [{ startedAt: 5_000, durationMs: 3_000 }],
    });
  });

  it('segments 가 빈 배열로 들어오면 저장 시 segments 필드 자체가 생략된다 (과거 페이로드와 모양 호환)', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      recovery: { excludedMs: 4_000, windows: 1, segments: [] },
    });

    const res = await request(app).post('/api/metrics/calculate').send(payload);

    expect(res.status).toBe(201);
    expect(store.rawMetrics[0].recovery).toEqual({ excludedMs: 4_000, windows: 1 });
    expect(store.rawMetrics[0].recovery).not.toHaveProperty('segments');
  });

  it('POST /api/metrics/raw 도 동일하게 segments 를 정규화해 영속화한다', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      recovery: {
        excludedMs: 4_123,
        windows: 2,
        segments: [
          { startedAt: 5_000, durationMs: 1_500 },
          { startedAt: 22_000, durationMs: 2_623 },
        ],
      },
    });

    const res = await request(app).post('/api/metrics/raw').send(payload);

    expect(res.status).toBe(201);
    expect(store.rawMetrics[0].recovery).toEqual({
      excludedMs: 4_123,
      windows: 2,
      segments: [
        { startedAt: 5_000, durationMs: 1_500 },
        { startedAt: 22_000, durationMs: 2_623 },
      ],
    });
  });

  it('GET /api/metrics/session/:sessionId 응답에 저장된 segments 가 그대로 포함된다 (재진입 시 동일 안내가 보이도록)', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      recovery: {
        excludedMs: 4_123,
        windows: 2,
        segments: [
          { startedAt: 5_000, durationMs: 1_500 },
          { startedAt: 22_000, durationMs: 2_623 },
        ],
      },
    });

    const post = await request(app).post('/api/metrics/calculate').send(payload);
    expect(post.status).toBe(201);

    const get = await request(app).get('/api/metrics/session/sess-1');
    expect(get.status).toBe(200);
    expect(get.body.success).toBe(true);
    expect(get.body.data.raw.recovery).toEqual({
      excludedMs: 4_123,
      windows: 2,
      segments: [
        { startedAt: 5_000, durationMs: 1_500 },
        { startedAt: 22_000, durationMs: 2_623 },
      ],
    });
  });

  it('actor 가 인증되어 있지 않으면 401 로 차단되어 raw/score 가 모두 저장되지 않는다', async () => {
    currentActor.user = null;
    const app = buildApp();
    const payload = baseRawMetrics({ recovery: { excludedMs: 9_000, windows: 1 } });

    const res = await request(app).post('/api/metrics/calculate').send(payload);

    expect(res.status).toBe(401);
    expect(store.rawMetrics).toHaveLength(0);
    expect(store.metricsScores).toHaveLength(0);
  });
});

describe('POST /api/metrics/raw — recovery 페이로드 정규화', () => {
  it('음수·NaN 으로 들어온 recovery 를 저장 직전에 0 으로 정규화하고 (양 끝이 모두 0이면) 필드를 제거한다', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      // @ts-expect-error - 잘못된 모양을 의도적으로 보냄
      recovery: { excludedMs: -500, windows: Number.NaN },
    });

    const res = await request(app).post('/api/metrics/raw').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(store.rawMetrics).toHaveLength(1);
    // 양 필드가 모두 0으로 클램프되면 sanitize 결과는 undefined → recovery 자체가 삭제되어야 한다.
    expect(store.rawMetrics[0]).not.toHaveProperty('recovery');
  });

  it('한쪽 필드만 살아있는 부분 손상 페이로드는 유효 부분을 보존하면서 음수·NaN 만 정규화한다', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      // @ts-expect-error - excludedMs 는 정상, windows 는 음수
      recovery: { excludedMs: 12_345.7, windows: -3 },
    });

    const res = await request(app).post('/api/metrics/raw').send(payload);

    expect(res.status).toBe(201);
    expect(store.rawMetrics).toHaveLength(1);
    expect(store.rawMetrics[0].recovery).toEqual({ excludedMs: 12_346, windows: 0 });
  });

  it('recovery 필드가 누락된 페이로드는 그대로 누락 상태로 저장된다 (정규화 단계에서 추가하지 않는다)', async () => {
    const app = buildApp();
    const payload = baseRawMetrics();
    expect(payload.recovery).toBeUndefined();

    const res = await request(app).post('/api/metrics/raw').send(payload);

    expect(res.status).toBe(201);
    expect(store.rawMetrics).toHaveLength(1);
    expect(store.rawMetrics[0]).not.toHaveProperty('recovery');
  });

  it('정상 모양의 recovery 는 반올림된 정수 값으로 보존된다', async () => {
    const app = buildApp();
    const payload = baseRawMetrics({
      recovery: { excludedMs: 7_500.4, windows: 2 },
    });

    const res = await request(app).post('/api/metrics/raw').send(payload);

    expect(res.status).toBe(201);
    expect(store.rawMetrics[0].recovery).toEqual({ excludedMs: 7_500, windows: 2 });
  });

  it('actor 가 인증되어 있지 않으면 401 로 차단되어 raw 가 저장되지 않는다', async () => {
    currentActor.user = null;
    const app = buildApp();
    const payload = baseRawMetrics({ recovery: { excludedMs: 9_000, windows: 1 } });

    const res = await request(app).post('/api/metrics/raw').send(payload);

    expect(res.status).toBe(401);
    expect(store.rawMetrics).toHaveLength(0);
  });

  it('sessionId / userId 가 비어 있으면 400 으로 거절되고 정규화 단계까지 도달하지 않는다', async () => {
    const app = buildApp();

    const missingSession = await request(app)
      .post('/api/metrics/raw')
      .send({ userId: 'u1', recovery: { excludedMs: -1, windows: -1 } });
    expect(missingSession.status).toBe(400);
    expect(missingSession.body.success).toBe(false);

    const missingUser = await request(app)
      .post('/api/metrics/raw')
      .send({ sessionId: 'sess-1', recovery: { excludedMs: -1, windows: -1 } });
    expect(missingUser.status).toBe(400);
    expect(missingUser.body.success).toBe(false);

    expect(store.rawMetrics).toHaveLength(0);
  });
});
