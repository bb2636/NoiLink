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
  return {
    default: { createSession, calculateMetrics },
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
});

afterEach(() => {
  mockedApi.createSession.mockReset();
  mockedApi.calculateMetrics.mockReset();
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
});
