/**
 * drain cycle 운영 로그 회귀 테스트.
 *
 * 보호 항목:
 *  - cycle 이 끝날 때 트리거 종류와 결과 요약(성공/실패/잔여)이 한 줄로 남는다.
 *  - 트리거가 mount/online/visibility/pageshow 로 정확히 분기된다.
 *  - 로그 라인에는 userId 원문이 절대 포함되지 않는다.
 *  - cycle 당 정확히 한 줄만 남고, throttle/in-flight 로 흡수된 트리거는
 *    별도의 줄을 만들지 않는다(과도한 운영 로그를 막기 위함).
 *  - 큐가 비어 cycle 이 시작되지 않은 경우엔 로그도 남기지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-secret-1234' }, loading: false }),
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
  type PendingTrainingRunInput,
} from '../../utils/pendingTrainingRuns';
import {
  __resetDrainGuardForTest,
  useDrainPendingTrainingRuns,
} from '../useDrainPendingTrainingRuns';

const mockedApi = api as unknown as {
  createSession: ReturnType<typeof vi.fn>;
  calculateMetrics: ReturnType<typeof vi.fn>;
};

const baseInput = (overrides: Partial<PendingTrainingRunInput> = {}): PendingTrainingRunInput => ({
  userId: 'user-secret-1234',
  mode: 'FOCUS',
  bpm: 60,
  level: 1,
  totalDurationSec: 30,
  yieldsScore: true,
  isComposite: false,
  tapCount: 12,
  ...overrides,
});

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

let infoSpy: ReturnType<typeof vi.spyOn>;

function drainLogs(): string[] {
  return infoSpy.mock.calls
    .map((args) => String(args[0] ?? ''))
    .filter((line) => line.startsWith('[drain]'));
}

beforeEach(() => {
  __resetPendingTrainingRunsForTest();
  __resetDrainGuardForTest();
  mockedApi.createSession.mockReset();
  mockedApi.calculateMetrics.mockReset();
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  __resetPendingTrainingRunsForTest();
  __resetDrainGuardForTest();
  infoSpy.mockRestore();
});

describe('useDrainPendingTrainingRuns: 운영 로그', () => {
  it('큐가 비어 있으면 cycle 이 시작되지 않아 로그도 남지 않는다', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });
    expect(drainLogs()).toEqual([]);
  });

  it('브라우저 online 트리거 cycle 의 로그 한 줄에 trigger=browser-online 이 기록되고 userId 원문은 노출되지 않는다', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });

    enqueuePendingRun({ input: baseInput(), title: '집중력' });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 's1' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });

    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await flushMicrotasks();
    });

    const logs = drainLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('trigger=browser-online');
    expect(logs[0]).toContain('succeeded=1');
    expect(logs[0]).toContain('failed=0');
    expect(logs[0]).toContain('remaining=0');
    // userId 원문이 어떤 형태로도 새어 나가서는 안 된다.
    expect(logs[0]).not.toContain('user-secret-1234');
    expect(logs[0]).not.toContain('secret');
  });

  it('네이티브 셸의 network.online 트리거 cycle 의 로그는 trigger=native-online 으로 별도 기록된다 (브라우저 vs 네이티브 비교용)', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });

    enqueuePendingRun({ input: baseInput(), title: '판단력' });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 's-native' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });

    await act(async () => {
      window.dispatchEvent(new CustomEvent('noilink-native-network-online'));
      await flushMicrotasks();
    });

    const logs = drainLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('trigger=native-online');
    // 운영 데이터에서 두 채널을 분리 추적해야 하므로, 합쳐진 옛 trigger 값(`online`)이
    // 다시 섞여 들어가서는 안 된다.
    expect(logs[0]).not.toMatch(/trigger=online\b/);
    expect(logs[0]).not.toContain('trigger=browser-online');
    expect(logs[0]).toContain('succeeded=1');
  });

  it('visibility 트리거 cycle 은 trigger=visibility 로 기록된다', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });

    enqueuePendingRun({ input: baseInput(), title: '판단력' });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 's-vis' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await flushMicrotasks();
    });

    const logs = drainLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('trigger=visibility');
    expect(logs[0]).toContain('succeeded=1');
  });

  it('pageshow 트리거 cycle 은 trigger=pageshow 로 기록된다', async () => {
    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
    });

    enqueuePendingRun({ input: baseInput(), title: '기억력' });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 's-ps' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });

    await act(async () => {
      window.dispatchEvent(new Event('pageshow'));
      await flushMicrotasks();
    });

    const logs = drainLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('trigger=pageshow');
  });

  it('마운트 cycle 이 모두 일시 실패하면 succeeded=0 / 잔여 큐 길이가 그대로 기록된다', async () => {
    enqueuePendingRun({ input: baseInput() });
    mockedApi.createSession.mockResolvedValue({ success: false, error: 'down' });

    renderHook(() => useDrainPendingTrainingRuns());
    await act(async () => {
      await flushMicrotasks();
      vi.advanceTimersByTime(2_000);
      await flushMicrotasks();
    });

    const logs = drainLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('trigger=mount');
    expect(logs[0]).toContain('succeeded=0');
    expect(logs[0]).toContain('failed=0');
    expect(logs[0]).toContain('remaining=1');
  });

  it('throttle 로 흡수된 트리거는 별도의 줄을 만들지 않고, follow-up cycle 의 한 줄만 추가된다', async () => {
    enqueuePendingRun({ input: baseInput() });
    // 모든 시도 실패 — 큐가 남아 follow-up 이 실제로 실행된다.
    mockedApi.createSession.mockResolvedValue({ success: false, error: 'down' });

    renderHook(() => useDrainPendingTrainingRuns());

    // 마운트 cycle 종료까지 흘려보낸다.
    await act(async () => {
      await flushMicrotasks();
      vi.advanceTimersByTime(2_000);
      await flushMicrotasks();
    });
    expect(drainLogs()).toHaveLength(1);

    // throttle 안에서 여러 종류의 트리거가 섞여 들어와도 추가 cycle/추가 로그는 없다.
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
      await flushMicrotasks();
    });
    expect(drainLogs()).toHaveLength(1);

    // throttle 만료 후 follow-up cycle 한 건이 실행되어 정확히 한 줄이 더 추가된다.
    // 짧은 단위로 여러 번 advance 하여 중첩된 await/sleep 체인이 모두 풀리도록 한다.
    await act(async () => {
      for (let i = 0; i < 50; i += 1) {
        vi.advanceTimersByTime(1_000);
        await flushMicrotasks();
      }
    });
    const logs = drainLogs();
    expect(logs).toHaveLength(2);
    // follow-up cycle 의 트리거는 가장 최근에 흡수된 트리거(pageshow)로 기록된다.
    expect(logs[1]).toContain('trigger=pageshow');
  });
});
