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
  bleAbortEvents: [],
  ackBannerEvents: [],
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

/**
 * `POST /api/metrics/ble-abort` (Task #57) 회귀 테스트.
 *
 * BLE 자동 종료 텔레메트리는 익명·fire-and-forget 이므로:
 *  - 인증이 없어도 통과한다.
 *  - 정상 페이로드는 `bleAbortEvents` 컬렉션에 한 건 append 되고 occurredAt 이 부착된다.
 *  - 잘못된 모양의 페이로드도 5xx 가 아니라 202 로 회신해 클라이언트가 재시도/노이즈를 만들지 않는다.
 *  - DB 쓰기 실패도 사용자 흐름에 전파되지 않는다 (202 + recorded:false).
 */
describe('POST /api/metrics/ble-abort — 운영 텔레메트리', () => {
  beforeEach(() => {
    store.bleAbortEvents = [];
    currentActor.user = null;
  });

  it('정상 페이로드는 occurredAt 부착 + bleAbortEvents 에 append 된다 (인증 없이도 허용)', async () => {
    const app = buildApp();

    const res = await request(app).post('/api/metrics/ble-abort').send({
      windows: 2,
      totalMs: 7_500,
      bleUnstable: true,
      apiMode: 'FOCUS',
    });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(store.bleAbortEvents).toHaveLength(1);
    const event = store.bleAbortEvents[0];
    expect(event).toMatchObject({
      windows: 2,
      totalMs: 7_500,
      bleUnstable: true,
      apiMode: 'FOCUS',
    });
    expect(typeof event.occurredAt).toBe('string');
    expect(Number.isFinite(new Date(event.occurredAt).getTime())).toBe(true);
    // PII 가 흘러들지 않는지 확인 — 화이트리스트 외 키는 저장되어선 안 된다.
    expect(Object.keys(event).sort()).toEqual(
      ['apiMode', 'bleUnstable', 'occurredAt', 'totalMs', 'windows'].sort(),
    );
  });

  it('비-boolean bleUnstable, 음수 windows 등 비정상 입력은 정규화되어 저장된다', async () => {
    const app = buildApp();

    const res = await request(app).post('/api/metrics/ble-abort').send({
      windows: -3,
      totalMs: 4_999.6,
      bleUnstable: 'yes',
    });

    expect(res.status).toBe(202);
    expect(store.bleAbortEvents).toHaveLength(1);
    expect(store.bleAbortEvents[0]).toMatchObject({
      windows: 0,
      totalMs: 5_000,
      bleUnstable: false,
    });
    expect(store.bleAbortEvents[0]).not.toHaveProperty('apiMode');
  });

  it('알려지지 않은 apiMode 라벨은 누락 처리되어 저장 페이로드에서 제거된다', async () => {
    const app = buildApp();

    const res = await request(app).post('/api/metrics/ble-abort').send({
      windows: 1,
      totalMs: 5_000,
      bleUnstable: true,
      apiMode: 'NOT_A_MODE',
    });

    expect(res.status).toBe(202);
    expect(store.bleAbortEvents).toHaveLength(1);
    expect(store.bleAbortEvents[0]).not.toHaveProperty('apiMode');
  });

  it('windows / totalMs 가 숫자가 아닌 완전 잘못된 페이로드는 202+ignored 로 조용히 무시된다', async () => {
    const app = buildApp();

    const res = await request(app).post('/api/metrics/ble-abort').send({
      windows: 'a',
      totalMs: 'b',
      bleUnstable: false,
    });

    expect(res.status).toBe(202);
    expect(res.body.ignored).toBe(true);
    expect(store.bleAbortEvents).toHaveLength(0);
  });

  it('DB 쓰기 실패도 사용자 흐름에 전파되지 않고 202+recorded:false 로 회신한다', async () => {
    const { db } = (await import('../db.js')) as unknown as {
      db: { set: ReturnType<typeof vi.fn> };
    };
    db.set.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const app = buildApp();

    const res = await request(app).post('/api/metrics/ble-abort').send({
      windows: 1,
      totalMs: 5_000,
      bleUnstable: true,
    });

    expect(res.status).toBe(202);
    expect(res.body.recorded).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────
// Task #114 — `GET /api/metrics/session/:sessionId/previous-score`
//
// 결과 화면 재진입 시 직전 점수를 채우기 위한 세션 단건 직전 점수 조회 엔드포인트.
// 회귀 보호 목적:
//   - 사용자가 50회 이상 트레이닝한 뒤 옛날 세션을 다시 열어도 직전 점수를
//     정확히 돌려준다 (페이징 한계에 의존하지 않는다).
//   - 직전 세션이 없으면 previousScore: null 로 회신해 클라이언트가 가짜 비교
//     카드를 그리지 않게 한다.
//   - 본인 세션이 아니면 403, 모르는 세션이면 404, 미인증은 401.
// ───────────────────────────────────────────────────────────
describe('GET /api/metrics/session/:sessionId/previous-score (Task #114)', () => {
  const SESSIONS: Session[] = [
    {
      id: 'sess-old-1',
      userId: 'u1',
      mode: 'FOCUS',
      bpm: 60,
      level: 1,
      duration: 30_000,
      score: 50,
      isComposite: false,
      isValid: true,
      phases: [],
      createdAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'sess-old-2',
      userId: 'u1',
      mode: 'FOCUS',
      bpm: 60,
      level: 1,
      duration: 30_000,
      score: 60,
      isComposite: false,
      isValid: true,
      phases: [],
      createdAt: '2025-01-02T00:00:00.000Z',
    },
    {
      // 점수 미산출(자유 트레이닝 등) — 직전 점수 후보에서 빠져야 한다.
      id: 'sess-no-score',
      userId: 'u1',
      mode: 'FREE',
      bpm: 60,
      level: 1,
      duration: 30_000,
      score: undefined,
      isComposite: false,
      isValid: true,
      phases: [],
      createdAt: '2025-01-03T00:00:00.000Z',
    },
    {
      // 다른 사용자 세션 — 사용자 격리 검증용.
      id: 'sess-other-user',
      userId: 'u2',
      mode: 'FOCUS',
      bpm: 60,
      level: 1,
      duration: 30_000,
      score: 99,
      isComposite: false,
      isValid: true,
      phases: [],
      createdAt: '2025-01-03T12:00:00.000Z',
    },
    {
      id: 'sess-current',
      userId: 'u1',
      mode: 'FOCUS',
      bpm: 60,
      level: 1,
      duration: 30_000,
      score: 80,
      isComposite: false,
      isValid: true,
      phases: [],
      createdAt: '2025-01-04T00:00:00.000Z',
    },
  ];

  beforeEach(() => {
    store.users = [ACTOR_USER, { ...ACTOR_USER, id: 'u2', username: 'other' }];
    store.sessions = SESSIONS;
    currentActor.user = ACTOR_USER;
  });

  it('현재 세션 직전 시점에서 점수가 있는 가장 최신 세션의 점수와 날짜를 돌려준다 (Task #123)', async () => {
    const app = buildApp();

    const res = await request(app).get('/api/metrics/session/sess-current/previous-score');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        previousScore: 60,
        // 비교 카드 라벨이 가짜 "오늘 - 2일" 이 아니라 실제 직전 세션의
        // createdAt 으로 표시되도록 함께 회신한다.
        previousScoreCreatedAt: '2025-01-02T00:00:00.000Z',
      },
    });
  });

  it('점수 미산출 세션(score=undefined)은 후보에서 제외되고 그 이전의 점수 있는 세션이 채택된다', async () => {
    // sess-no-score(2025-01-03) 가 가장 가깝지만 score 가 없으므로 sess-old-2(2025-01-02, score=60) 가 채택돼야 한다.
    const app = buildApp();

    const res = await request(app).get('/api/metrics/session/sess-current/previous-score');

    expect(res.body.data.previousScore).toBe(60);
  });

  it('다른 사용자의 세션은 직전 점수 후보에서 제외된다 (사용자 격리)', async () => {
    // sess-other-user(2025-01-03 12:00, score=99) 는 다른 사용자라 후보에서 빠진다.
    const app = buildApp();

    const res = await request(app).get('/api/metrics/session/sess-current/previous-score');

    expect(res.body.data.previousScore).not.toBe(99);
    expect(res.body.data.previousScore).toBe(60);
  });

  it('첫 세션(과거에 점수 있는 세션이 하나도 없음) 이면 previousScore/previousScoreCreatedAt 모두 null', async () => {
    store.sessions = [SESSIONS[0]]; // sess-old-1 하나만 — 자기 자신 외 후보 없음.
    const app = buildApp();

    const res = await request(app).get('/api/metrics/session/sess-old-1/previous-score');

    expect(res.status).toBe(200);
    // 클라이언트가 비교 카드 자체를 숨기도록 둘 다 null 로 회신한다 — 점수만
    // null 이고 날짜만 들어오는 어긋난 상태가 새어 나가지 않게 같이 잠근다.
    expect(res.body).toEqual({
      success: true,
      data: { previousScore: null, previousScoreCreatedAt: null },
    });
  });

  it('세션 이력이 50건을 넘어 옛날 세션을 다시 열어도 직전 점수를 정확히 돌려준다 (페이징 한계 제거)', async () => {
    // 페이징 의존 클라이언트 구현이 회귀하지 않도록 60건 이력에서 가장 옛날 세션을 조회한다.
    const many: Session[] = Array.from({ length: 60 }, (_, i) => ({
      id: `sess-${i}`,
      userId: 'u1',
      mode: 'FOCUS',
      bpm: 60,
      level: 1,
      duration: 30_000,
      score: 30 + (i % 50),
      isComposite: false,
      isValid: true,
      phases: [],
      createdAt: new Date(2025, 0, 1 + i).toISOString(),
    }));
    store.sessions = many;
    // 가장 옛날 세션(sess-0) 직전엔 아무 세션도 없어야 한다 (첫 세션).
    const first = await request(buildApp()).get(
      '/api/metrics/session/sess-0/previous-score',
    );
    expect(first.body.data.previousScore).toBe(null);

    // 두 번째 세션(sess-1) 의 직전은 sess-0 — 점수=30.
    const second = await request(buildApp()).get(
      '/api/metrics/session/sess-1/previous-score',
    );
    expect(second.body.data.previousScore).toBe(30);
  });

  it('미인증 요청은 401', async () => {
    currentActor.user = null;
    const app = buildApp();

    const res = await request(app).get('/api/metrics/session/sess-current/previous-score');

    expect(res.status).toBe(401);
  });

  it('모르는 sessionId 는 404', async () => {
    const app = buildApp();

    const res = await request(app).get('/api/metrics/session/sess-unknown/previous-score');

    expect(res.status).toBe(404);
  });

  it('타인의 세션을 조회하려 하면 403', async () => {
    const app = buildApp();

    const res = await request(app).get('/api/metrics/session/sess-other-user/previous-score');

    expect(res.status).toBe(403);
  });
});

/**
 * `POST /api/metrics/ack-banner` (Task #116) 회귀 테스트.
 *
 * ack 거부 토스트의 burst 통계는 익명·fire-and-forget 이므로:
 *  - 인증이 없어도 통과한다.
 *  - 정상 페이로드는 `ackBannerEvents` 컬렉션에 한 건 append 되고 occurredAt 이 부착된다.
 *  - 잘못된 모양의 페이로드(알 수 없는 reason 등)도 5xx 가 아니라 202 로 회신해
 *    클라이언트가 재시도/노이즈를 만들지 않는다.
 *  - DB 쓰기 실패도 사용자 흐름에 전파되지 않는다 (202 + recorded:false).
 */
describe('POST /api/metrics/ack-banner — 운영 텔레메트리', () => {
  beforeEach(() => {
    store.ackBannerEvents = [];
    currentActor.user = null;
  });

  it('정상 페이로드는 occurredAt 부착 + ackBannerEvents 에 append 된다 (인증 없이도 허용)', async () => {
    const app = buildApp();

    const res = await request(app).post('/api/metrics/ack-banner').send({
      reason: 'auto-dismiss',
      burstCount: 3,
      burstDurationMs: 4_999,
    });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(store.ackBannerEvents).toHaveLength(1);
    const event = store.ackBannerEvents[0];
    expect(event).toMatchObject({
      reason: 'auto-dismiss',
      burstCount: 3,
      burstDurationMs: 4_999,
    });
    expect(typeof event.occurredAt).toBe('string');
    expect(Number.isFinite(new Date(event.occurredAt).getTime())).toBe(true);
    // PII 가 흘러들지 않는지 확인 — 화이트리스트 외 키는 저장되어선 안 된다.
    expect(Object.keys(event).sort()).toEqual(
      ['burstCount', 'burstDurationMs', 'occurredAt', 'reason'].sort(),
    );
  });

  it('user-dismiss / unmount 라벨도 동일하게 저장된다', async () => {
    const app = buildApp();

    for (const reason of ['user-dismiss', 'unmount'] as const) {
      const res = await request(app)
        .post('/api/metrics/ack-banner')
        .send({ reason, burstCount: 2, burstDurationMs: 1_200 });
      expect(res.status).toBe(202);
    }

    expect(store.ackBannerEvents).toHaveLength(2);
    expect(store.ackBannerEvents.map((e: { reason: string }) => e.reason).sort()).toEqual(
      ['unmount', 'user-dismiss'],
    );
  });

  it('비정상 burstCount/burstDurationMs 는 정규화되어 저장된다 (음수 → 0, burstCount 최저 1)', async () => {
    const app = buildApp();

    const res = await request(app).post('/api/metrics/ack-banner').send({
      reason: 'auto-dismiss',
      burstCount: -3,
      burstDurationMs: -100,
    });

    expect(res.status).toBe(202);
    expect(store.ackBannerEvents).toHaveLength(1);
    expect(store.ackBannerEvents[0]).toMatchObject({
      reason: 'auto-dismiss',
      burstCount: 1,
      burstDurationMs: 0,
    });
  });

  it('알 수 없는 reason 라벨은 202+ignored 로 조용히 무시된다', async () => {
    const app = buildApp();

    const res = await request(app).post('/api/metrics/ack-banner').send({
      reason: 'manual',
      burstCount: 1,
      burstDurationMs: 0,
    });

    expect(res.status).toBe(202);
    expect(res.body.ignored).toBe(true);
    expect(store.ackBannerEvents).toHaveLength(0);
  });

  it('DB 쓰기 실패도 사용자 흐름에 전파되지 않고 202+recorded:false 로 회신한다', async () => {
    const { db } = (await import('../db.js')) as unknown as {
      db: { set: ReturnType<typeof vi.fn> };
    };
    db.set.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const app = buildApp();

    const res = await request(app).post('/api/metrics/ack-banner').send({
      reason: 'auto-dismiss',
      burstCount: 1,
      burstDurationMs: 0,
    });

    expect(res.status).toBe(202);
    expect(res.body.recorded).toBe(false);
  });
});
