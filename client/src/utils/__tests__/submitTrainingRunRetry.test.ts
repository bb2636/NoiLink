/**
 * 결과 저장 자동 재시도(submitCompletedTrainingWithRetry) 회귀 테스트.
 *
 * 보호 대상:
 *  - 일시적 네트워크 실패에도 데이터를 잃지 않도록 백오프 재시도가 동작한다.
 *  - 한 번이라도 createSession 이 성공하면 이후 시도는 그 sessionId 를 재사용해
 *    동일 트레이닝이 중복 저장되지 않는다.
 *  - onAttempt 콜백으로 시도별 결과를 외부에 노출(부분 진행분 보존 동기화에 활용).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => {
  const createSession = vi.fn();
  const calculateMetrics = vi.fn();
  // Task #122: submit 유틸이 직전 점수 단건 엔드포인트
  // (`/metrics/session/:id/previous-score`) 를 calculateMetrics 와 병렬로 호출한다.
  // 기존 회귀 테스트는 직전 점수 조회를 요구하지 않으므로(`includePreviousScore`
  // 미지정), 이 mock 은 호출되지 않는 것이 정상이다 — 그래도 의도치 않게 호출됐을
  // 때 throw 하지 않도록 빈 응답을 돌려준다.
  const get = vi.fn(async () => ({
    success: true,
    data: { previousScore: null, previousScoreCreatedAt: null },
  }));
  return {
    default: { createSession, calculateMetrics, get },
  };
});

import api from '../api';
import {
  submitCompletedTrainingWithRetry,
  type SubmitCompletedTrainingInput,
} from '../submitTrainingRun';

const mockedApi = api as unknown as {
  createSession: ReturnType<typeof vi.fn>;
  calculateMetrics: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};

const baseInput = (overrides: Partial<SubmitCompletedTrainingInput> = {}): SubmitCompletedTrainingInput => ({
  userId: 'u1',
  mode: 'FOCUS',
  bpm: 60,
  level: 1,
  totalDurationSec: 30,
  yieldsScore: true,
  isComposite: false,
  tapCount: 12,
  ...overrides,
});

beforeEach(() => {
  mockedApi.createSession.mockReset();
  mockedApi.calculateMetrics.mockReset();
  mockedApi.get.mockReset();
});

afterEach(() => {
  mockedApi.createSession.mockReset();
  mockedApi.calculateMetrics.mockReset();
  mockedApi.get.mockReset();
});

describe('submitCompletedTrainingWithRetry', () => {
  it('첫 시도에 성공하면 한 번만 호출하고 totalAttempts=1', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-1' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({
      success: true,
      data: { focus: 80, memory: 70 },
    });

    const res = await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    expect(res.error).toBeUndefined();
    expect(res.sessionCreated).toBe(true);
    expect(res.sessionId).toBe('sess-1');
    expect(res.totalAttempts).toBe(1);
    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    expect(mockedApi.calculateMetrics).toHaveBeenCalledTimes(1);
  });

  it('createSession 이 일시 실패해도 백오프 후 다음 시도에서 회복한다', async () => {
    mockedApi.createSession
      .mockResolvedValueOnce({ success: false, error: 'network down' })
      .mockResolvedValueOnce({ success: true, data: { id: 'sess-2' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({
      success: true,
      data: { focus: 60 },
    });

    const sleep = vi.fn().mockResolvedValue(undefined);
    const res = await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [10, 20],
      sleep,
    });

    expect(res.error).toBeUndefined();
    expect(res.sessionId).toBe('sess-2');
    expect(res.totalAttempts).toBe(2);
    expect(mockedApi.createSession).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  it('createSession 성공 후 metrics 가 일시 실패하면, 이후 시도는 같은 sessionId 를 재사용한다 (중복 세션 방지)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-3' } });
    mockedApi.calculateMetrics
      .mockResolvedValueOnce({ success: false, error: '계산 실패' })
      .mockResolvedValueOnce({ success: true, data: { focus: 50 } });

    const res = await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    expect(res.error).toBeUndefined();
    expect(res.sessionId).toBe('sess-3');
    expect(res.totalAttempts).toBe(2);
    // 핵심: createSession 은 첫 시도에서만 호출, 이후 재시도는 metrics 만 시도.
    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    expect(mockedApi.calculateMetrics).toHaveBeenCalledTimes(2);
    // 두 번째 호출의 sessionId 는 첫 번째에서 받은 것과 동일해야 한다.
    expect(mockedApi.calculateMetrics.mock.calls[1][0].sessionId).toBe('sess-3');
  });

  it('백오프 모두 소진해도 실패하면 마지막 에러와 함께 반환한다', async () => {
    mockedApi.createSession.mockResolvedValue({ success: false, error: 'permanent' });

    const res = await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    expect(res.error).toBe('permanent');
    expect(res.sessionCreated).toBe(false);
    expect(res.totalAttempts).toBe(3);
    expect(mockedApi.createSession).toHaveBeenCalledTimes(3);
  });

  it('existingSessionId 가 주어지면 createSession 을 건너뛰고 metrics 단계만 시도한다', async () => {
    mockedApi.calculateMetrics.mockResolvedValueOnce({
      success: true,
      data: { focus: 80 },
    });

    const res = await submitCompletedTrainingWithRetry(
      baseInput({ existingSessionId: 'pre-existing' }),
      { backoffsMs: [0, 0], sleep: () => Promise.resolve() },
    );

    expect(res.error).toBeUndefined();
    expect(res.sessionId).toBe('pre-existing');
    expect(mockedApi.createSession).not.toHaveBeenCalled();
    expect(mockedApi.calculateMetrics).toHaveBeenCalledTimes(1);
  });

  it('FREE 모드는 metrics 단계를 호출하지 않는다', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-free' } });

    const res = await submitCompletedTrainingWithRetry(
      baseInput({ mode: 'FREE', yieldsScore: false }),
      { backoffsMs: [0, 0], sleep: () => Promise.resolve() },
    );

    expect(res.error).toBeUndefined();
    expect(res.sessionId).toBe('sess-free');
    expect(mockedApi.calculateMetrics).not.toHaveBeenCalled();
  });

  it('partialProgressPct 가 주어지면 createSession 페이로드에 meta.partial.progressPct 가 포함된다 (Task #23)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-partial' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 70 } });

    await submitCompletedTrainingWithRetry(baseInput({ partialProgressPct: 82.4 }), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    const payload = mockedApi.createSession.mock.calls[0][0];
    // 정수 % 로 정규화돼 영속화돼야 한다 — 결과·기록 화면이 같은 값을 그대로 노출.
    expect(payload.meta).toEqual({ partial: { progressPct: 82 } });
  });

  it('partialProgressPct 가 없으면 createSession 페이로드에 meta 가 들어가지 않는다 (정상 완료 회귀 보호)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-full' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 70 } });

    await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    const payload = mockedApi.createSession.mock.calls[0][0];
    expect(payload.meta).toBeUndefined();
  });

  it('localId 가 주어지면 createSession/calculateMetrics 호출 모두에 idempotency 키로 흘러간다 (서버 중복 저장 방지의 클라이언트 측 절반)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-id' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 70 } });

    const localId = 'pending-12345-abc';
    await submitCompletedTrainingWithRetry(baseInput({ localId }), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    // createSession 의 두 번째 인자가 { idempotencyKey: localId } 이어야 한다.
    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    expect(mockedApi.createSession.mock.calls[0][1]).toEqual({ idempotencyKey: localId });
    // calculateMetrics 도 같은 키로 호출되어야 한다 — 두 단계 모두 같은 트레이닝의 재시도이므로.
    expect(mockedApi.calculateMetrics).toHaveBeenCalledTimes(1);
    expect(mockedApi.calculateMetrics.mock.calls[0][1]).toEqual({ idempotencyKey: localId });
  });

  it('localId 가 없으면 idempotency 옵션 인자는 undefined 로 전달된다 (헤더 미부착)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-id' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 70 } });

    await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    expect(mockedApi.createSession.mock.calls[0][1]).toBeUndefined();
    expect(mockedApi.calculateMetrics.mock.calls[0][1]).toBeUndefined();
  });

  it('createSession 일시 실패 후 재시도 시에도 동일한 idempotency 키가 다시 전송된다 (서버가 첫 응답을 흡수하도록)', async () => {
    mockedApi.createSession
      .mockResolvedValueOnce({ success: false, error: 'timeout' })
      .mockResolvedValueOnce({ success: true, data: { id: 'sess-rt' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 50 } });

    const localId = 'pending-xyz';
    await submitCompletedTrainingWithRetry(baseInput({ localId }), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    expect(mockedApi.createSession).toHaveBeenCalledTimes(2);
    expect(mockedApi.createSession.mock.calls[0][1]).toEqual({ idempotencyKey: localId });
    expect(mockedApi.createSession.mock.calls[1][1]).toEqual({ idempotencyKey: localId });
  });

  it('createSession 응답에 replayed 가 있으면 결과에도 replayed: true 가 흘러간다 (Task #65 — UI 안내 신호)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({
      success: true,
      data: { id: 'sess-replay' },
      replayed: true,
    });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 60 } });

    const res = await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    expect(res.error).toBeUndefined();
    expect(res.replayed).toBe(true);
  });

  it('calculateMetrics 응답만 replayed 여도 결과에 replayed: true 가 합쳐진다 (단계별 hit 합산)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-mix' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({
      success: true,
      data: { focus: 70 },
      replayed: true,
    });

    const res = await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    expect(res.replayed).toBe(true);
  });

  it('두 단계 모두 replayed 가 없으면 결과에도 replayed 가 합쳐지지 않는다 (정상 첫 응답 회귀)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-fresh' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 50 } });

    const res = await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
    });

    expect(res.replayed).toBeUndefined();
  });

  it('createSession 단계가 캐시 hit 이면 stage=createSession 로그가 한 줄 남는다 (Task #119 — 단계별 디버깅)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({
      success: true,
      data: { id: 'sess-replay-c' },
      replayed: true,
    });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 60 } });

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await submitCompletedTrainingWithRetry(baseInput(), {
        backoffsMs: [0, 0],
        sleep: () => Promise.resolve(),
      });

      const replayCalls = infoSpy.mock.calls.filter(
        (call) => call[0] === '[submit] idempotency replay',
      );
      expect(replayCalls).toHaveLength(1);
      expect(replayCalls[0][1]).toEqual({ stage: 'createSession' });
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('calculateMetrics 단계만 캐시 hit 이면 stage=calculateMetrics 로그가 한 줄 남는다 (Task #119)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-replay-m' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({
      success: true,
      data: { focus: 70 },
      replayed: true,
    });

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await submitCompletedTrainingWithRetry(baseInput(), {
        backoffsMs: [0, 0],
        sleep: () => Promise.resolve(),
      });

      const replayCalls = infoSpy.mock.calls.filter(
        (call) => call[0] === '[submit] idempotency replay',
      );
      expect(replayCalls).toHaveLength(1);
      expect(replayCalls[0][1]).toEqual({ stage: 'calculateMetrics' });
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('두 단계가 모두 캐시 hit 이면 단계별로 한 줄씩 두 줄이 남는다 (어느 쪽이 흡수됐는지 잃지 않도록)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({
      success: true,
      data: { id: 'sess-replay-both' },
      replayed: true,
    });
    mockedApi.calculateMetrics.mockResolvedValueOnce({
      success: true,
      data: { focus: 80 },
      replayed: true,
    });

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await submitCompletedTrainingWithRetry(baseInput(), {
        backoffsMs: [0, 0],
        sleep: () => Promise.resolve(),
      });

      const stages = infoSpy.mock.calls
        .filter((call) => call[0] === '[submit] idempotency replay')
        .map((call) => (call[1] as { stage: string }).stage);
      expect(stages).toEqual(['createSession', 'calculateMetrics']);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('두 단계 모두 첫 응답이면 단계 로그가 남지 않는다 (정상 흐름 회귀 보호)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-no-replay' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 50 } });

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      await submitCompletedTrainingWithRetry(baseInput(), {
        backoffsMs: [0, 0],
        sleep: () => Promise.resolve(),
      });

      const replayCalls = infoSpy.mock.calls.filter(
        (call) => call[0] === '[submit] idempotency replay',
      );
      expect(replayCalls).toHaveLength(0);
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('onAttempt 가 매 시도 결과와 함께 호출된다 (부분 진행분 외부 동기화 통로)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-on' } });
    mockedApi.calculateMetrics
      .mockResolvedValueOnce({ success: false, error: 'tmp' })
      .mockResolvedValueOnce({ success: true, data: { focus: 90 } });

    const onAttempt = vi.fn();
    await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [0, 0],
      sleep: () => Promise.resolve(),
      onAttempt,
    });

    expect(onAttempt).toHaveBeenCalledTimes(2);
    expect(onAttempt.mock.calls[0][0].attemptIndex).toBe(0);
    expect(onAttempt.mock.calls[0][0].result.sessionId).toBe('sess-on');
    expect(onAttempt.mock.calls[0][0].result.error).toBe('tmp');
    expect(onAttempt.mock.calls[1][0].attemptIndex).toBe(1);
    expect(onAttempt.mock.calls[1][0].result.error).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────
  // Task #122 — 직전 점수 단건 엔드포인트 통합
  // ─────────────────────────────────────────────────────────
  // 정책 요약:
  //   - `includePreviousScore: true` 가 들어오면 calculateMetrics 와 같은 단건
  //     엔드포인트(`/metrics/session/:sessionId/previous-score`) 를 병렬로 호출해
  //     결과 객체에 `previousScore`/`previousScoreCreatedAt` 를 함께 담는다.
  //   - 두 호출은 서로 의존하지 않으므로 순차가 아닌 병렬로 동작해야 한다.
  //   - 조회 자체가 실패하면 두 값 모두 `null` 로 폴백 — 제출 결과는 영향받지 않는다.
  //   - 플래그가 false/미지정이면 호출 자체가 일어나지 않는다 (background drain
  //     같은 비결과 화면 흐름에서 불필요한 네트워크를 만들지 않음).
  //   - FREE / yieldsScore=false 모드는 결과 화면이 비교 카드를 그리지 않으므로
  //     플래그가 true 여도 호출하지 않는다 (낭비 방지).

  it('includePreviousScore=true 면 단건 엔드포인트를 calculateMetrics 와 함께 호출하고 결과에 직전 점수를 담아 돌려준다', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-prev' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({
      success: true,
      data: { focus: 80, memory: 80, comprehension: 80 },
    });
    mockedApi.get.mockResolvedValueOnce({
      success: true,
      data: {
        previousScore: 73,
        previousScoreCreatedAt: '2026-04-25T00:00:00.000Z',
        // Task #132: 서버가 같은 KST 헬퍼로 만들어 보내는 표시용 날짜.
        // submit 유틸은 이 값을 받아 결과에 그대로 흘려 보내야 한다 — 자체 재계산 금지.
        previousScoreLocalDate: '2026-04-25',
      },
    });

    const res = await submitCompletedTrainingWithRetry(
      baseInput({ includePreviousScore: true }),
      { backoffsMs: [0], sleep: () => Promise.resolve() },
    );

    expect(res.error).toBeUndefined();
    expect(res.previousScore).toBe(73);
    expect(res.previousScoreCreatedAt).toBe('2026-04-25T00:00:00.000Z');
    // Task #132: 표시용 날짜가 서버 응답 그대로 결과에 흘러야 한다 — 두 흐름의
    // 라벨이 정확히 일치하도록 단일 진실원을 유지.
    expect(res.previousScoreLocalDate).toBe('2026-04-25');
    // 호출 경로가 정확히 단건 엔드포인트여야 한다 — 다시 페이징 이력으로 회귀하지
    // 않게 잠근다.
    expect(mockedApi.get).toHaveBeenCalledWith('/metrics/session/sess-prev/previous-score');
    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });

  it('includePreviousScore=true 일 때 calculateMetrics 와 직전 점수 조회는 병렬로 시작된다 (순차 await 가 아님)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-par' } });
    // 두 호출 시작 시점을 잡아 둔다 — 순차였다면 calc 가 끝난 뒤에야 get 이 호출된다.
    let calcStartedAt = -1;
    let getStartedAt = -1;
    let tick = 0;
    mockedApi.calculateMetrics.mockImplementationOnce(async () => {
      calcStartedAt = ++tick;
      // 짧게 쉬어 get 이 그 사이에 시작될 기회를 만든다.
      await Promise.resolve();
      await Promise.resolve();
      return { success: true, data: { focus: 70 } };
    });
    mockedApi.get.mockImplementationOnce(async () => {
      getStartedAt = ++tick;
      return { success: true, data: { previousScore: 50, previousScoreCreatedAt: '2026-04-20T00:00:00.000Z' } };
    });

    await submitCompletedTrainingWithRetry(
      baseInput({ includePreviousScore: true }),
      { backoffsMs: [0], sleep: () => Promise.resolve() },
    );

    // 두 호출이 모두 시작됐고, get 의 시작 시점이 calc 의 시작 시점과 같은 tick
    // 또는 그 직후(=병렬 구간) 여야 한다 — calc 가 완료된 뒤에 get 이 시작된다면
    // tick 차이가 더 벌어진다.
    expect(calcStartedAt).toBeGreaterThan(0);
    expect(getStartedAt).toBeGreaterThan(0);
    expect(getStartedAt - calcStartedAt).toBeLessThanOrEqual(1);
  });

  it('includePreviousScore=true 인데 직전 점수 조회가 실패해도 제출 자체는 성공으로 끝나고 직전 점수만 null 로 폴백한다', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-fb' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });
    mockedApi.get.mockRejectedValueOnce(new Error('network down'));

    const res = await submitCompletedTrainingWithRetry(
      baseInput({ includePreviousScore: true }),
      { backoffsMs: [0], sleep: () => Promise.resolve() },
    );

    expect(res.error).toBeUndefined();
    expect(res.previousScore).toBeNull();
    expect(res.previousScoreCreatedAt).toBeNull();
    // Task #132: 표시용 날짜도 함께 null 로 폴백 — 라벨이 어긋난 채 새어 나가지 않게.
    expect(res.previousScoreLocalDate).toBeNull();
  });

  it('includePreviousScore 미지정/false 면 단건 엔드포인트를 호출하지 않는다 (drain 등 비결과 화면 흐름의 불필요한 네트워크 방지)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-no-prev' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });

    const res = await submitCompletedTrainingWithRetry(baseInput(), {
      backoffsMs: [0],
      sleep: () => Promise.resolve(),
    });

    expect(res.error).toBeUndefined();
    // 결과 객체에 previousScore 관련 필드가 아예 들어가지 않아야 한다 — undefined.
    expect(res.previousScore).toBeUndefined();
    expect(res.previousScoreCreatedAt).toBeUndefined();
    // get 호출 자체가 일어나지 않아야 한다.
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('FREE / yieldsScore=false 모드에서는 includePreviousScore=true 여도 호출하지 않는다 (낭비 방지)', async () => {
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-free' } });

    const res = await submitCompletedTrainingWithRetry(
      baseInput({ mode: 'FREE', yieldsScore: false, includePreviousScore: true }),
      { backoffsMs: [0], sleep: () => Promise.resolve() },
    );

    expect(res.error).toBeUndefined();
    // FREE 는 calculateMetrics 단계 자체를 건너뛰므로 직전 점수 조회도 건너뛴다.
    expect(mockedApi.calculateMetrics).not.toHaveBeenCalled();
    expect(mockedApi.get).not.toHaveBeenCalled();
    expect(res.previousScore).toBeUndefined();
    expect(res.previousScoreCreatedAt).toBeUndefined();
  });
});
