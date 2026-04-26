/**
 * 네트워크 재연결 트리거 동작 회귀 테스트.
 *
 * 보호 항목:
 *  - 앱이 켜진 채 `online` 이벤트가 들어오면 큐가 다시 한 번 비워진다.
 *  - 짧은 시간 내 여러 번 트리거되어도 throttle 가 적용되어 같은 항목이
 *    MAX_TOTAL_ATTEMPTS 를 빠르게 소진하지 않는다.
 *  - 동일 cycle / 동시 트리거에서 outcome notice 가 중복 노출되지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false }),
}));

vi.mock('../../utils/api', () => {
  const createSession = vi.fn();
  const calculateMetrics = vi.fn();
  return {
    default: { createSession, calculateMetrics },
  };
});

import api from '../../utils/api';
import {
  __resetPendingTrainingRunsForTest,
  enqueuePendingRun,
  getPendingRuns,
  popOutcomeNotices,
  type PendingTrainingRunInput,
} from '../../utils/pendingTrainingRuns';
import {
  __resetDrainGuardForTest,
  drainPendingRuns,
  MIN_DRAIN_INTERVAL_MS,
  useDrainPendingTrainingRuns,
} from '../useDrainPendingTrainingRuns';

const mockedApi = api as unknown as {
  createSession: ReturnType<typeof vi.fn>;
  calculateMetrics: ReturnType<typeof vi.fn>;
};

const baseInput = (overrides: Partial<PendingTrainingRunInput> = {}): PendingTrainingRunInput => ({
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

/** 마이크로태스크 큐를 비워 in-flight Promise 가 정리될 때까지 기다린다. */
async function flushMicrotasks(): Promise<void> {
  // 여러 await 가 연쇄될 수 있어 넉넉히 비운다.
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  __resetPendingTrainingRunsForTest();
  __resetDrainGuardForTest();
  mockedApi.createSession.mockReset();
  mockedApi.calculateMetrics.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  __resetPendingTrainingRunsForTest();
  __resetDrainGuardForTest();
});

describe('useDrainPendingTrainingRuns: online 이벤트 트리거', () => {
  it('마운트 시 큐가 비어 있으면 어떤 호출도 하지 않는다', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });
    expect(mockedApi.createSession).not.toHaveBeenCalled();
    expect(mockedApi.calculateMetrics).not.toHaveBeenCalled();
  });

  it('마운트 후에 enqueue 된 항목이 online 이벤트로 즉시 비워진다', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });
    // 마운트 직후엔 큐가 비어 있어 호출이 없었다는 사전 조건.
    expect(mockedApi.createSession).not.toHaveBeenCalled();

    enqueuePendingRun({ input: baseInput(), title: '집중력' });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 's1' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await flushMicrotasks();
    });

    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    expect(getPendingRuns()).toEqual([]);
    const outcomes = popOutcomeNotices();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('success');
  });

  it('짧은 시간 내 online 이벤트가 여러 번 와도 throttle 로 합쳐진다 (MAX_TOTAL_ATTEMPTS 폭주 방지)', async () => {
    enqueuePendingRun({ input: baseInput() });
    // 모든 시도 실패 — 큐에 항목이 남아 throttle 효과를 검증하기 쉬움.
    mockedApi.createSession.mockResolvedValue({ success: false, error: 'down' });

    renderHook(() => useDrainPendingTrainingRuns());

    // 마운트 cycle 의 in-screen 백오프(1.5s)까지 흘려보내 cycle 을 완전히 종료시킨다.
    await act(async () => {
      await flushMicrotasks();
      vi.advanceTimersByTime(2_000);
      await flushMicrotasks();
    });
    const callsAfterMount = mockedApi.createSession.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    // throttle 안에서 online 을 여러 번 발생시켜도 즉시 추가 cycle 은 시작되지 않는다.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('online'));
      await flushMicrotasks();
    });
    expect(mockedApi.createSession.mock.calls.length).toBe(callsAfterMount);

    // throttle 만료 후 한 번의 follow-up cycle 이 실행된다.
    await act(async () => {
      vi.advanceTimersByTime(MIN_DRAIN_INTERVAL_MS + 2_000);
      await flushMicrotasks();
    });
    const callsAfterFollowUp = mockedApi.createSession.mock.calls.length;
    expect(callsAfterFollowUp).toBeGreaterThan(callsAfterMount);

    // 이전에 흡수된 여러 번의 online 이벤트가 각자 cycle 을 만들지 않는다 — 한 follow-up
    // 이내 cycle 의 시도 수 상한(in-screen 백오프 포함 2회)을 넘지 않아야 한다.
    expect(callsAfterFollowUp - callsAfterMount).toBeLessThanOrEqual(2);
  });

  it('한 사용자의 throttle/in-flight 상태가 다른 사용자의 drain 트리거를 막지 않는다', async () => {
    // 사전: u1 의 cycle 을 시작해 in-flight + throttle 상태로 만든다.
    enqueuePendingRun({ input: baseInput({ userId: 'u1' }) });
    let resolveCreateA: (v: unknown) => void = () => undefined;
    mockedApi.createSession.mockImplementationOnce(
      () => new Promise((res) => {
        resolveCreateA = res;
      }),
    );

    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });
    // u1 의 cycle 이 in-flight.
    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);

    // u2 의 항목을 다른 경로로 직접 trigger 했을 때 (예: 다른 hook 마운트나 외부 호출),
    // u1 의 follow-up timer 가 점유되어 있어도 u2 의 cycle 은 정상적으로 시작되어야 한다.
    // 여기서는 외부 헬퍼가 따로 노출되지 않으므로 drainPendingRuns 직접 호출로 검증한다.
    enqueuePendingRun({ input: baseInput({ userId: 'u2' }), title: '판단력' });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 's-u2' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 70 } });

    // u2 직접 drain — u1 의 in-flight/throttle 상태는 u2 에 영향을 주지 않아야 한다.
    await act(async () => {
      await drainPendingRuns('u2', { sleep: () => Promise.resolve() });
      await flushMicrotasks();
    });
    expect(mockedApi.createSession).toHaveBeenCalledTimes(2);
    // u2 항목은 정리되고 outcome 이 1건 남는다.
    expect(getPendingRuns().some((r) => r.input.userId === 'u2')).toBe(false);
    const outcomes = popOutcomeNotices();
    expect(outcomes.find((o) => o.title === '판단력')?.outcome).toBe('success');

    // u1 의 cycle 을 마무리.
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });
    await act(async () => {
      resolveCreateA({ success: true, data: { id: 's-u1' } });
      await flushMicrotasks();
    });
  });

  it('마운트 후에 enqueue 된 항목이 visibilitychange → visible 로 즉시 비워진다', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });
    // 마운트 직후엔 큐가 비어 있어 호출이 없었다는 사전 조건.
    expect(mockedApi.createSession).not.toHaveBeenCalled();

    enqueuePendingRun({ input: baseInput(), title: '집중력' });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 's-vis' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });

    // visible 상태로 visibilitychange 발생.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await flushMicrotasks();
    });

    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    expect(getPendingRuns()).toEqual([]);
    const outcomes = popOutcomeNotices();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('success');
  });

  it('네이티브 셸의 `noilink-native-network-online` 이벤트도 즉시 drain 을 트리거한다', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });
    // 마운트 직후엔 큐가 비어 있어 호출이 없었다는 사전 조건.
    expect(mockedApi.createSession).not.toHaveBeenCalled();

    enqueuePendingRun({ input: baseInput(), title: '집중력' });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 's-native' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });

    await act(async () => {
      // 브라우저 `online` 이 아니라 네이티브 셸 → WebView 의 복구 알림이 들어왔다고 가정.
      window.dispatchEvent(new CustomEvent('noilink-native-network-online'));
      await flushMicrotasks();
    });

    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    expect(getPendingRuns()).toEqual([]);
    const outcomes = popOutcomeNotices();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('success');
  });

  it('visibilitychange 가 hidden 으로 들어오면 drain 트리거가 발생하지 않는다', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });
    expect(mockedApi.createSession).not.toHaveBeenCalled();

    enqueuePendingRun({ input: baseInput(), title: '집중력' });

    // hidden 상태로 visibilitychange 발생 — 트리거되지 않아야 한다.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await flushMicrotasks();
    });

    expect(mockedApi.createSession).not.toHaveBeenCalled();
    expect(getPendingRuns()).toHaveLength(1);
  });

  it('마운트 후에 enqueue 된 항목이 pageshow 로 즉시 비워진다', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });
    expect(mockedApi.createSession).not.toHaveBeenCalled();

    enqueuePendingRun({ input: baseInput(), title: '집중력' });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 's-ps' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });

    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
      await flushMicrotasks();
    });

    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    expect(getPendingRuns()).toEqual([]);
    const outcomes = popOutcomeNotices();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('success');
  });

  it('online + visibilitychange + pageshow + 네이티브 `network.online` 이 짧은 시간에 함께 들어와도 throttle 로 합쳐진다', async () => {
    enqueuePendingRun({ input: baseInput() });
    // 모든 시도 실패 — 큐에 항목이 남아 throttle 효과를 검증하기 쉬움.
    mockedApi.createSession.mockResolvedValue({ success: false, error: 'down' });

    renderHook(() => useDrainPendingTrainingRuns());

    // 마운트 cycle 의 in-screen 백오프(1.5s)까지 흘려보내 cycle 을 완전히 종료시킨다.
    await act(async () => {
      await flushMicrotasks();
      vi.advanceTimersByTime(2_000);
      await flushMicrotasks();
    });
    const callsAfterMount = mockedApi.createSession.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    // throttle 안에서 여러 종류의 트리거(브라우저 online, visibilitychange, pageshow,
    // 네이티브 셸의 `noilink-native-network-online`)가 섞여 들어와도 즉시 추가
    // cycle 은 시작되지 않는다 — 모두 같은 tryTriggerDrain 경로를 통과한다.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
      window.dispatchEvent(new CustomEvent('noilink-native-network-online'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new CustomEvent('noilink-native-network-online'));
      await flushMicrotasks();
    });
    expect(mockedApi.createSession.mock.calls.length).toBe(callsAfterMount);

    // throttle 만료 후엔 한 번의 follow-up cycle 만 실행된다 — 네이티브 신호든
    // 브라우저/포그라운드 신호든 별도 cycle 을 만들지 않는다.
    await act(async () => {
      vi.advanceTimersByTime(MIN_DRAIN_INTERVAL_MS + 2_000);
      await flushMicrotasks();
    });
    const callsAfterFollowUp = mockedApi.createSession.mock.calls.length;
    expect(callsAfterFollowUp).toBeGreaterThan(callsAfterMount);
    // 한 follow-up 의 in-screen 백오프 포함 시도 수 상한(2회) 을 넘지 않는다.
    expect(callsAfterFollowUp - callsAfterMount).toBeLessThanOrEqual(2);
  });

  it('cycle 진행 중에 visibilitychange/pageshow/네이티브 `network.online` 이 들어와도 in-flight 가드로 outcome 이 중복되지 않는다', async () => {
    enqueuePendingRun({ input: baseInput(), title: '판단력' });

    // createSession 을 의도적으로 지연시켜 in-flight 상태를 만든다.
    let resolveCreate: (v: unknown) => void = () => undefined;
    mockedApi.createSession.mockImplementation(
      () => new Promise((res) => {
        resolveCreate = res;
      }),
    );
    mockedApi.calculateMetrics.mockResolvedValue({ success: true, data: { focus: 80 } });

    renderHook(() => useDrainPendingTrainingRuns());

    await act(async () => {
      await flushMicrotasks();
    });
    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);

    // in-flight 도중에 visibility/pageshow/네이티브 신호가 여러 번 들어와도
    // createSession 이 추가로 호출되지 않아야 한다.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
      window.dispatchEvent(new CustomEvent('noilink-native-network-online'));
      window.dispatchEvent(new CustomEvent('noilink-native-network-online'));
      await flushMicrotasks();
    });
    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);

    // 첫 cycle 이 끝난 뒤 항목은 정리되고 outcome 은 정확히 하나여야 한다.
    await act(async () => {
      resolveCreate({ success: true, data: { id: 's-inflight' } });
      await flushMicrotasks();
    });
    expect(getPendingRuns()).toEqual([]);
    const outcomes = popOutcomeNotices();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('success');
    expect(outcomes[0].title).toBe('판단력');
  });

  it('cycle 진행 중에 online 이 들어오면 in-flight 가드로 동시 실행되지 않고 outcome 이 중복되지 않는다', async () => {
    enqueuePendingRun({ input: baseInput(), title: '판단력' });

    // createSession 을 의도적으로 지연시켜 in-flight 상태를 만든다.
    let resolveCreate: (v: unknown) => void = () => undefined;
    mockedApi.createSession.mockImplementation(
      () => new Promise((res) => {
        resolveCreate = res;
      }),
    );
    mockedApi.calculateMetrics.mockResolvedValue({ success: true, data: { focus: 80 } });

    renderHook(() => useDrainPendingTrainingRuns());

    // 마운트 cycle 이 시작되어 createSession 이 호출되었지만 아직 resolve 되지 않은 상태.
    await act(async () => {
      await flushMicrotasks();
    });
    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);

    // in-flight 도중에 online 이 들어와도 createSession 이 추가로 호출되지 않아야 한다.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('online'));
      await flushMicrotasks();
    });
    expect(mockedApi.createSession).toHaveBeenCalledTimes(1);

    // 첫 cycle 이 끝난 뒤 항목은 정리되고 outcome 은 정확히 하나여야 한다.
    await act(async () => {
      resolveCreate({ success: true, data: { id: 's1' } });
      await flushMicrotasks();
    });
    expect(getPendingRuns()).toEqual([]);
    const outcomes = popOutcomeNotices();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('success');
    expect(outcomes[0].title).toBe('판단력');
  });
});
