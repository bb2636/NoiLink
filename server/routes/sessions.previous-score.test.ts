/**
 * `GET /api/sessions/user/:userId/previous-score?excluding=:sid` 회귀 테스트 (Task #124).
 *
 * 비교 카드용 직전 점수 한 건만 가볍게 돌려주는 전용 엔드포인트.
 *
 * 보호 목적:
 *  - 같은 사용자의 score 가 있는 가장 최신 세션을 정확히 골라준다 (createdAt desc).
 *  - excluding= 으로 지정된 세션은 후보에서 명시적으로 빠진다 — 트레이닝 종료 직후
 *    방금 만든 현재 세션이 "직전" 으로 잡히는 race 를 막는다.
 *  - 점수 미산출 세션(자유 트레이닝 등 score=undefined)은 직전 점수 후보가 아니다.
 *  - 다른 사용자의 세션은 절대 후보에 들지 않는다 (사용자 격리).
 *  - 점수 있는 세션이 하나도 없으면 200 + 모든 필드 null 로 회신해 클라이언트가
 *    가짜 비교 카드를 그리지 않게 한다.
 *  - 본인 세션이 아니면 403, 미인증은 401.
 *  - 사용자 이력이 50건을 넘어도 페이징 한계 없이 정확한 직전 점수를 돌려준다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Session, User } from '@noilink/shared';

const store: Record<string, any> = {
  users: [],
  sessions: [],
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

const ACTOR_USER: User = {
  id: 'u1',
  username: 'tester',
  name: 'Tester',
  userType: 'PERSONAL',
  streak: 0,
  createdAt: new Date('2025-01-01').toISOString(),
};

const OTHER_USER: User = {
  ...ACTOR_USER,
  id: 'u2',
  username: 'tester2',
  name: 'Tester 2',
};

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
    // 비교 카드의 "현재 세션" 으로 가정 — 트레이닝 종료 직후에는 이 id 를
    // excluding 으로 보내 후보에서 빼야 한다.
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
  store.users = [ACTOR_USER, OTHER_USER];
  store.sessions = SESSIONS;
  currentActor.user = ACTOR_USER;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/sessions/user/:userId/previous-score (Task #124)', () => {
  it('excluding 으로 지정된 현재 세션을 빼고, 점수 있는 가장 최신 세션을 직전 점수로 돌려준다 (KST 표시용 날짜 포함, Task #132)', async () => {
    const res = await request(buildApp()).get(
      '/api/sessions/user/u1/previous-score?excluding=sess-current',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        previousScore: 60,
        previousSessionId: 'sess-old-2',
        previousCreatedAt: '2025-01-02T00:00:00.000Z',
        // Task #132: 라벨이 디바이스 시간대로 흔들리지 않도록 KST 기준
        // `YYYY-MM-DD` 표시용 문자열과 기준 시간대도 한 쌍으로 회신한다.
        // 2025-01-02T00:00:00Z = KST 2025-01-02 09:00 → "2025-01-02".
        previousScoreLocalDate: '2025-01-02',
        timeZone: 'Asia/Seoul',
      },
    });
  });

  // Task #132 — 자정 경계(UTC 15:00 = KST 다음 날 00:00) 회귀 보호.
  // 직전 세션이 UTC 자정 직전(KST 다음 날 새벽) 에 끝났을 때, 라벨이 KST 의
  // "다음 날" 로 정확히 떨어지는지 잠근다.
  it('자정 경계: UTC 15:00 직전 세션은 KST 의 다음 날짜로 표시된다 (Task #132)', async () => {
    store.sessions = [
      {
        id: 'sess-prev-late-utc',
        userId: 'u1',
        mode: 'FOCUS',
        bpm: 60,
        level: 1,
        duration: 30_000,
        score: 65,
        isComposite: false,
        isValid: true,
        phases: [],
        // UTC 2026-04-24 15:00 = KST 2026-04-25 00:00 (자정 경계 통과)
        createdAt: '2026-04-24T15:00:00.000Z',
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
        createdAt: '2026-04-26T00:00:00.000Z',
      },
    ];

    const res = await request(buildApp()).get(
      '/api/sessions/user/u1/previous-score?excluding=sess-current',
    );

    expect(res.status).toBe(200);
    expect(res.body.data.previousScore).toBe(65);
    expect(res.body.data.previousCreatedAt).toBe('2026-04-24T15:00:00.000Z');
    // 핵심 회귀: KST 기준 라벨은 04-24 가 아니라 04-25 로 떨어져야 한다.
    expect(res.body.data.previousScoreLocalDate).toBe('2026-04-25');
    expect(res.body.data.timeZone).toBe('Asia/Seoul');
  });

  it('점수 미산출 세션(score=undefined)은 후보에서 제외된다', async () => {
    // sess-no-score 가 가장 최신이지만 score 가 없으므로 sess-old-2 가 채택돼야 한다.
    const res = await request(buildApp()).get(
      '/api/sessions/user/u1/previous-score?excluding=sess-current',
    );
    expect(res.body.data.previousSessionId).toBe('sess-old-2');
    expect(res.body.data.previousScore).toBe(60);
  });

  it('다른 사용자의 세션은 후보에서 제외된다 (사용자 격리)', async () => {
    // sess-other-user(score=99) 는 다른 사용자라 후보에서 빠진다.
    const res = await request(buildApp()).get(
      '/api/sessions/user/u1/previous-score?excluding=sess-current',
    );
    expect(res.body.data.previousScore).not.toBe(99);
    expect(res.body.data.previousScore).toBe(60);
  });

  it('excluding 쿼리가 없으면 자기 자신을 제외하지 않고 사용자 전체 이력의 최신 점수 세션을 돌려준다', async () => {
    const res = await request(buildApp()).get('/api/sessions/user/u1/previous-score');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      previousScore: 80,
      previousSessionId: 'sess-current',
      previousCreatedAt: '2025-01-04T00:00:00.000Z',
      // 2025-01-04T00:00:00Z = KST 2025-01-04 09:00 → "2025-01-04".
      previousScoreLocalDate: '2025-01-04',
      timeZone: 'Asia/Seoul',
    });
  });

  it('첫 세션(점수 있는 세션이 하나도 없음) 이면 200 + 모든 필드 null (timeZone 만 포함, Task #132)', async () => {
    store.sessions = [SESSIONS[0]]; // sess-old-1 하나만 — excluding 으로 빼면 후보 없음.

    const res = await request(buildApp()).get(
      '/api/sessions/user/u1/previous-score?excluding=sess-old-1',
    );

    expect(res.status).toBe(200);
    // 점수/sessionId/ISO/표시용 날짜는 모두 null — 라벨만 새어 나가는 어긋남
    // 방지. timeZone 은 응답 형태가 일정하도록 항상 포함된다.
    expect(res.body).toEqual({
      success: true,
      data: {
        previousScore: null,
        previousSessionId: null,
        previousCreatedAt: null,
        previousScoreLocalDate: null,
        timeZone: 'Asia/Seoul',
      },
    });
  });

  it('사용자에게 점수 있는 세션이 단 하나도 없으면(자유 트레이닝만 한 사용자) 200 + null', async () => {
    store.sessions = [
      {
        id: 'sess-free',
        userId: 'u1',
        mode: 'FREE',
        bpm: 60,
        level: 1,
        duration: 30_000,
        score: undefined,
        isComposite: false,
        isValid: true,
        phases: [],
        createdAt: '2025-01-05T00:00:00.000Z',
      },
    ];

    const res = await request(buildApp()).get(
      '/api/sessions/user/u1/previous-score?excluding=sess-current',
    );

    expect(res.status).toBe(200);
    expect(res.body.data.previousScore).toBeNull();
    expect(res.body.data.previousSessionId).toBeNull();
    expect(res.body.data.previousCreatedAt).toBeNull();
  });

  it('이력 60건에서 옛날 세션을 excluding 으로 보내도 직전 점수를 정확히 돌려준다 (페이징 한계 제거)', async () => {
    // 이력 60건 — 점수가 i 번째 = 30 + (i % 50) 으로 오름차순 createdAt 정렬.
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

    // 가장 옛날(sess-0) 을 excluding 으로 보내면 직전은 가장 최신(sess-59) 이어야 한다.
    const latest = await request(buildApp()).get(
      '/api/sessions/user/u1/previous-score?excluding=sess-0',
    );
    expect(latest.body.data.previousSessionId).toBe('sess-59');

    // 두 번째 세션(sess-1) 을 excluding 으로 보내도 정렬은 createdAt desc 이므로
    // 직전은 여전히 가장 최신(sess-59) 이다 — "현재 직전" 이 아닌 "전체 최신" 정책.
    const stillLatest = await request(buildApp()).get(
      '/api/sessions/user/u1/previous-score?excluding=sess-1',
    );
    expect(stillLatest.body.data.previousSessionId).toBe('sess-59');
  });

  it('excluding 이 빈 문자열이면 무시되고 자기 자신을 제외하지 않는다', async () => {
    const res = await request(buildApp()).get(
      '/api/sessions/user/u1/previous-score?excluding=',
    );
    expect(res.body.data.previousSessionId).toBe('sess-current');
  });

  it('미인증 요청은 401', async () => {
    currentActor.user = null;

    const res = await request(buildApp()).get(
      '/api/sessions/user/u1/previous-score?excluding=sess-current',
    );

    expect(res.status).toBe(401);
  });

  it('타인의 사용자 이력을 조회하려 하면 403', async () => {
    const res = await request(buildApp()).get(
      '/api/sessions/user/u2/previous-score?excluding=sess-other-user',
    );

    expect(res.status).toBe(403);
  });
});
