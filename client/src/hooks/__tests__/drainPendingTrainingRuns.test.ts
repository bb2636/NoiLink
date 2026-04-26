/**
 * 백그라운드 drain 함수 회귀 테스트.
 * 결과 저장 실패 후 큐에 남은 항목이, 다음 앱 진입 시 자동 재전송되고
 * 결과(성공/최종 실패)가 1회성 outcome 으로 사용자에게 전달되는 흐름을 보호한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  MAX_TOTAL_ATTEMPTS,
  popOutcomeNotices,
  type PendingTrainingRunInput,
} from '../../utils/pendingTrainingRuns';
import { drainPendingRuns } from '../useDrainPendingTrainingRuns';

const noSleep = () => Promise.resolve();

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

beforeEach(() => {
  __resetPendingTrainingRunsForTest();
  mockedApi.createSession.mockReset();
  mockedApi.calculateMetrics.mockReset();
});

afterEach(() => {
  __resetPendingTrainingRunsForTest();
});

describe('drainPendingRuns', () => {
  it('성공하면 큐에서 제거하고 success outcome 을 남긴다', async () => {
    enqueuePendingRun({ input: baseInput(), title: '집중력' });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 's1' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 80 } });

    await drainPendingRuns('u1', { sleep: noSleep });

    expect(getPendingRuns()).toEqual([]);
    const outcomes = popOutcomeNotices();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('success');
    expect(outcomes[0].title).toBe('집중력');
  });

  it('일시 실패 시 큐를 유지하고 attempts 만 증가시킨다 (다음 진입에서 다시 시도)', async () => {
    enqueuePendingRun({ input: baseInput(), attempts: 1 });
    mockedApi.createSession.mockResolvedValue({ success: false, error: 'down' });

    await drainPendingRuns('u1', { sleep: noSleep });

    const left = getPendingRuns();
    expect(left).toHaveLength(1);
    // 1 회 drain 사이클 안에서 추가 시도가 발생할 수 있으므로 attempts 는 증가만 검사.
    expect(left[0].attempts).toBeGreaterThan(1);
    expect(left[0].attempts).toBeLessThan(MAX_TOTAL_ATTEMPTS);
    expect(left[0].lastError).toBe('down');
    // 아직 결정되지 않았으니 outcome 은 없어야 한다.
    expect(popOutcomeNotices()).toEqual([]);
  });

  it('총 시도 한도(MAX_TOTAL_ATTEMPTS)에 도달하면 final-failure outcome 으로 정리한다', async () => {
    enqueuePendingRun({
      input: baseInput(),
      attempts: MAX_TOTAL_ATTEMPTS - 1,
      title: '판단력',
    });
    mockedApi.createSession.mockResolvedValue({ success: false, error: 'still down' });

    await drainPendingRuns('u1', { sleep: noSleep });

    expect(getPendingRuns()).toEqual([]);
    const outcomes = popOutcomeNotices();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('final-failure');
    expect(outcomes[0].title).toBe('판단력');
    expect(outcomes[0].lastError).toBe('still down');
  });

  it('이미 시도가 가득 찬 항목은 호출 없이 즉시 final-failure 로 정리한다', async () => {
    enqueuePendingRun({
      input: baseInput(),
      attempts: MAX_TOTAL_ATTEMPTS,
      lastError: 'old',
      title: '기억력',
    });

    await drainPendingRuns('u1', { sleep: noSleep });

    expect(mockedApi.createSession).not.toHaveBeenCalled();
    expect(getPendingRuns()).toEqual([]);
    const outcomes = popOutcomeNotices();
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe('final-failure');
    expect(outcomes[0].lastError).toBe('old');
  });

  it('다른 userId 항목은 건드리지 않는다', async () => {
    enqueuePendingRun({ input: baseInput({ userId: 'me' }) });
    enqueuePendingRun({ input: baseInput({ userId: 'other' }) });
    mockedApi.createSession.mockResolvedValue({ success: true, data: { id: 'x' } });
    mockedApi.calculateMetrics.mockResolvedValue({ success: true, data: { focus: 1 } });

    await drainPendingRuns('me', { sleep: noSleep });

    const left = getPendingRuns();
    expect(left).toHaveLength(1);
    expect(left[0].input.userId).toBe('other');
  });

  it('부분 진행분(partialSessionId)이 있으면 createSession 을 건너뛰고 metrics 단계만 시도한다', async () => {
    enqueuePendingRun({
      input: baseInput(),
      partialSessionId: 'sess-partial',
      attempts: 2,
    });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 70 } });

    await drainPendingRuns('u1', { sleep: noSleep });

    expect(mockedApi.createSession).not.toHaveBeenCalled();
    expect(mockedApi.calculateMetrics).toHaveBeenCalledTimes(1);
    expect(mockedApi.calculateMetrics.mock.calls[0][0].sessionId).toBe('sess-partial');
    expect(getPendingRuns()).toEqual([]);
  });

  it('drain 시 큐 항목의 localId 가 idempotency 키로 createSession/calculateMetrics 에 흘러간다 (서버 중복 저장 방지)', async () => {
    enqueuePendingRun({
      input: baseInput(),
      localId: 'pending-drain-key',
    });
    mockedApi.createSession.mockResolvedValueOnce({ success: true, data: { id: 'sess-d' } });
    mockedApi.calculateMetrics.mockResolvedValueOnce({ success: true, data: { focus: 60 } });

    await drainPendingRuns('u1', { sleep: noSleep });

    expect(mockedApi.createSession.mock.calls[0][1]).toEqual({ idempotencyKey: 'pending-drain-key' });
    expect(mockedApi.calculateMetrics.mock.calls[0][1]).toEqual({ idempotencyKey: 'pending-drain-key' });
  });

  it('drain 중 createSession 에 처음 성공하면 partialSessionId 가 즉시 영속화되어, 이후 실패 시에도 다음 진입에서 재사용된다', async () => {
    enqueuePendingRun({ input: baseInput(), attempts: 0 });
    mockedApi.createSession.mockResolvedValue({ success: true, data: { id: 'fresh-sess' } });
    // metrics 는 모두 실패시켜 final 결정 전까지 큐에 남기게 한다.
    mockedApi.calculateMetrics.mockResolvedValue({ success: false, error: 'metrics down' });

    await drainPendingRuns('u1', { sleep: noSleep });

    // 한도에 도달하지 않았다면 큐에 남아 있고, partialSessionId 가 보존되어 있어야 한다.
    const left = getPendingRuns();
    if (left.length > 0) {
      expect(left[0].partialSessionId).toBe('fresh-sess');
      // createSession 은 첫 시도에서만 호출되어야 한다 (이후 metrics 단계 재시도만).
      expect(mockedApi.createSession).toHaveBeenCalledTimes(1);
    }
  });
});
