/**
 * `POST /api/sessions` 의 streak 갱신을 KST 기준으로 잠그는 회귀 테스트 (Task #152).
 *
 * Task #151 회귀 보호:
 *  - "오늘/어제" 비교가 KST(`Asia/Seoul`) 가 아닌 UTC 로 묶이면, KST 자정 직후
 *    (UTC 15:00 직후) 에 시작한 둘째 날 첫 훈련이 첫째 날과 같은 UTC 일자로
 *    묶여서 streak 가 1 에서 멈추는 회귀가 있었다.
 *  - 이 파일은 `vi.useFakeTimers` 로 시각을 강제 고정해 두 번의 sessions.create
 *    호출이 (1) KST 자정 경계를 넘어 다른 KST 일자에 떨어지고, (2) UTC 기준으로
 *    같은 날에 묶이는 케이스를 시뮬레이션한다. 회귀가 살아나면 streak 가 2 가
 *    되지 않고 1 에서 멈춘다.
 *
 * 같이 잠그는 정책:
 *  - 같은 KST 일자에 두 번째 세션을 저장해도 streak 가 중복 카운트되지 않는다.
 *  - lastTrainingDate 가 갱신되어 다음 호출의 비교 기준이 새 ISO 로 잡힌다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { User } from '@noilink/shared';

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
  store.users = [{ ...ACTOR }];
  store.sessions = [];
  store.idempotency = {};
  currentActor.user = ACTOR;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('POST /api/sessions — KST 기준 streak 갱신 (Task #152)', () => {
  it('KST 자정 경계: UTC 같은 날에 묶이는 두 세션도 KST 기준으로 다른 날이면 streak 가 1 → 2 가 된다', async () => {
    const app = buildApp();

    // Day 1: UTC 2026-04-24 14:00 = KST 2026-04-24 23:00 → KST 04-24
    vi.setSystemTime(new Date('2026-04-24T14:00:00.000Z'));
    const r1 = await request(app).post('/api/sessions').send(PAYLOAD);
    expect(r1.status).toBe(201);
    expect(store.users[0].streak).toBe(1);
    expect(store.users[0].bestStreak).toBe(1);

    // Day 2: UTC 2026-04-24 16:00 = KST 2026-04-25 01:00 → KST 04-25
    //  - UTC 기준: 같은 04-24 → 같은 날로 묶여 streak 가 1 에서 멈춤(회귀)
    //  - KST 기준: 04-24 → 04-25 로 연속 → streak +1 = 2 (정상)
    vi.setSystemTime(new Date('2026-04-24T16:00:00.000Z'));
    const r2 = await request(app).post('/api/sessions').send(PAYLOAD);
    expect(r2.status).toBe(201);
    expect(store.users[0].streak).toBe(2);
    expect(store.users[0].bestStreak).toBe(2);
    expect(store.users[0].lastTrainingDate).toBe('2026-04-24T16:00:00.000Z');
  });

  it('KST 기준 같은 날에 두 번째 세션을 저장하면 streak 는 중복 카운트되지 않는다', async () => {
    const app = buildApp();

    // 첫 세션: KST 04-25 01:00
    vi.setSystemTime(new Date('2026-04-24T16:00:00.000Z'));
    await request(app).post('/api/sessions').send(PAYLOAD).expect(201);
    expect(store.users[0].streak).toBe(1);
    const firstLast = store.users[0].lastTrainingDate;

    // 같은 KST 일자(04-25) 의 다른 시각: UTC 04-25 12:00 = KST 04-25 21:00
    vi.setSystemTime(new Date('2026-04-25T12:00:00.000Z'));
    await request(app).post('/api/sessions').send(PAYLOAD).expect(201);
    expect(store.users[0].streak).toBe(1);
    // 같은 날이면 lastTrainingDate 도 갱신하지 않아 (오늘 첫 훈련 시각 보존)
    expect(store.users[0].lastTrainingDate).toBe(firstLast);
  });

  it('KST 기준 하루를 건너뛰면 streak 가 1 로 리셋되고 bestStreak 는 그대로 보관된다', async () => {
    const app = buildApp();

    // KST 04-24 → 04-25: 연속 +1
    vi.setSystemTime(new Date('2026-04-23T14:00:00.000Z'));
    await request(app).post('/api/sessions').send(PAYLOAD).expect(201);
    vi.setSystemTime(new Date('2026-04-24T14:00:00.000Z'));
    await request(app).post('/api/sessions').send(PAYLOAD).expect(201);
    expect(store.users[0].streak).toBe(2);
    expect(store.users[0].bestStreak).toBe(2);

    // KST 04-26 건너뛰고 04-27 에 다시 훈련 → streak 1 로 리셋, bestStreak 보관
    vi.setSystemTime(new Date('2026-04-26T16:00:00.000Z'));
    await request(app).post('/api/sessions').send(PAYLOAD).expect(201);
    expect(store.users[0].streak).toBe(1);
    expect(store.users[0].bestStreak).toBe(2);
  });
});
