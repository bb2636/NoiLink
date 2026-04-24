/**
 * pending 큐의 핵심 동작을 보호하는 회귀 테스트.
 * 깨지면 사용자가 결과 저장 실패 후 화면을 떠났을 때 결과 손실로 직결되는 영역.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetPendingTrainingRunsForTest,
  enqueuePendingRun,
  getPendingRuns,
  hasExhaustedAttempts,
  MAX_PENDING_RUNS,
  MAX_TOTAL_ATTEMPTS,
  PENDING_OUTCOMES_KEY,
  PENDING_RUNS_KEY,
  popOutcomeNotices,
  pushOutcomeNotice,
  removePendingRun,
  updatePendingRun,
  type PendingTrainingRunInput,
} from '../pendingTrainingRuns';

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
});

afterEach(() => {
  __resetPendingTrainingRunsForTest();
});

describe('pendingTrainingRuns: 큐 기본 동작', () => {
  it('enqueue 후 getPendingRuns 로 조회 가능하고 localId 가 부여된다', () => {
    const id = enqueuePendingRun({ input: baseInput(), title: '집중력' });
    const all = getPendingRuns();
    expect(all).toHaveLength(1);
    expect(all[0].localId).toBe(id);
    expect(all[0].title).toBe('집중력');
    expect(all[0].attempts).toBe(0);
    expect(all[0].input.userId).toBe('u1');
  });

  it('attempts/partialSessionId/lastError 를 enqueue 시점에 같이 저장한다', () => {
    enqueuePendingRun({
      input: baseInput(),
      attempts: 3,
      partialSessionId: 'sess-A',
      lastError: 'network',
    });
    const [r] = getPendingRuns();
    expect(r.attempts).toBe(3);
    expect(r.partialSessionId).toBe('sess-A');
    expect(r.lastError).toBe('network');
  });

  it('updatePendingRun 으로 attempts/partialSessionId/lastError 를 갱신할 수 있다', () => {
    const id = enqueuePendingRun({ input: baseInput() });
    updatePendingRun(id, { attempts: 2, partialSessionId: 'sess-B', lastError: 'timeout' });
    const [r] = getPendingRuns();
    expect(r.attempts).toBe(2);
    expect(r.partialSessionId).toBe('sess-B');
    expect(r.lastError).toBe('timeout');
  });

  it('removePendingRun 은 해당 항목만 제거한다', () => {
    const id1 = enqueuePendingRun({ input: baseInput() });
    const id2 = enqueuePendingRun({ input: baseInput({ userId: 'u2' }) });
    removePendingRun(id1);
    const all = getPendingRuns();
    expect(all).toHaveLength(1);
    expect(all[0].localId).toBe(id2);
  });

  it('상한(MAX_PENDING_RUNS)을 넘으면 가장 오래된 항목부터 버려진다', () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_PENDING_RUNS + 3; i += 1) {
      ids.push(enqueuePendingRun({ input: baseInput({ tapCount: i }) }));
    }
    const all = getPendingRuns();
    expect(all).toHaveLength(MAX_PENDING_RUNS);
    // 마지막에 들어간 것이 살아있고, 앞쪽 3 개는 잘려 있어야 한다.
    expect(all[all.length - 1].localId).toBe(ids[ids.length - 1]);
    expect(all.find((r) => r.localId === ids[0])).toBeUndefined();
    expect(all.find((r) => r.localId === ids[1])).toBeUndefined();
    expect(all.find((r) => r.localId === ids[2])).toBeUndefined();
  });

  it('hasExhaustedAttempts 는 시도 한도(MAX_TOTAL_ATTEMPTS) 와 일치한다', () => {
    enqueuePendingRun({ input: baseInput(), attempts: MAX_TOTAL_ATTEMPTS - 1 });
    const [a] = getPendingRuns();
    expect(hasExhaustedAttempts(a)).toBe(false);
    updatePendingRun(a.localId, { attempts: MAX_TOTAL_ATTEMPTS });
    const [b] = getPendingRuns();
    expect(hasExhaustedAttempts(b)).toBe(true);
  });
});

describe('pendingTrainingRuns: 손상된 저장소 방어', () => {
  it('localStorage 에 잘못된 JSON 이 있어도 getPendingRuns 는 빈 배열을 반환한다', () => {
    localStorage.setItem(PENDING_RUNS_KEY, '{not json');
    expect(getPendingRuns()).toEqual([]);
  });

  it('배열이 아닌 값이 들어 있어도 빈 배열로 안전하게 처리한다', () => {
    localStorage.setItem(PENDING_RUNS_KEY, JSON.stringify({ x: 1 }));
    expect(getPendingRuns()).toEqual([]);
  });

  it('스키마가 깨진 항목은 무시한다 (localId/input 누락)', () => {
    localStorage.setItem(
      PENDING_RUNS_KEY,
      JSON.stringify([{ broken: true }, { localId: 'ok', input: {} }]),
    );
    const all = getPendingRuns();
    expect(all).toHaveLength(1);
    expect(all[0].localId).toBe('ok');
  });
});

describe('pendingTrainingRuns: outcome 큐', () => {
  it('pushOutcomeNotice 로 쌓고 popOutcomeNotices 로 한 번에 가져온 뒤 큐를 비운다', () => {
    pushOutcomeNotice({ localId: 'x1', outcome: 'success', at: 1, title: '집중력' });
    pushOutcomeNotice({ localId: 'x2', outcome: 'final-failure', at: 2, lastError: 'oops' });
    const popped = popOutcomeNotices();
    expect(popped).toHaveLength(2);
    expect(popped.map((p) => p.localId).sort()).toEqual(['x1', 'x2']);
    // 한 번 pop 한 후엔 비어 있어야 한다 — 같은 결과가 두 번 노출되지 않도록.
    expect(popOutcomeNotices()).toEqual([]);
  });

  it('같은 localId 의 outcome 이 다시 들어오면 가장 최신 상태로 갱신된다', () => {
    pushOutcomeNotice({ localId: 'y', outcome: 'success', at: 1 });
    pushOutcomeNotice({ localId: 'y', outcome: 'final-failure', at: 2, lastError: 'after' });
    const popped = popOutcomeNotices();
    expect(popped).toHaveLength(1);
    expect(popped[0].outcome).toBe('final-failure');
    expect(popped[0].lastError).toBe('after');
  });

  it('outcome 큐 손상 시에도 빈 배열을 반환한다', () => {
    localStorage.setItem(PENDING_OUTCOMES_KEY, 'broken');
    expect(popOutcomeNotices()).toEqual([]);
  });
});
