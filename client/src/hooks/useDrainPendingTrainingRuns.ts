/**
 * 앱 진입 시(인증 완료 후) 한 번만, 결과 저장 실패로 큐에 남아 있던 트레이닝 런을
 * 백그라운드로 다시 보낸다.
 *
 * 정책:
 *  - 사용자가 직접 트리거하지 않는 백그라운드 흐름이므로, UI 를 막거나 에러를 화면에
 *    노출하지 않는다(조용히 처리). 결과는 outcome notice 로 1회성 안내로 전달된다.
 *  - 인증된 사용자의 항목만 처리한다. (다른 계정 잔여 항목은 다음 그 계정 로그인 때 처리)
 *  - 한 항목이 누적 시도(MAX_TOTAL_ATTEMPTS)를 초과하면 'final-failure' 로 정리한다.
 *  - 큐가 비어 있을 때는 어떤 네트워크 호출도 하지 않는다.
 *  - 동일 마운트 내에서 두 번 실행되지 않도록 ref 가드.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import {
  getPendingRuns,
  hasExhaustedAttempts,
  pushOutcomeNotice,
  removePendingRun,
  updatePendingRun,
  MAX_TOTAL_ATTEMPTS,
  type PendingTrainingRun,
} from '../utils/pendingTrainingRuns';
import { submitCompletedTrainingWithRetry } from '../utils/submitTrainingRun';

/** 한 항목당 한 번의 drain 사이클에서 추가 시도 사이 백오프(ms). */
const DRAIN_BACKOFFS_MS = [1500] as const;

interface DrainOptions {
  /** 테스트/디버깅용으로 drain 동작을 강제하거나 막을 수 있다. */
  enabled?: boolean;
}

export function useDrainPendingTrainingRuns(options: DrainOptions = {}): void {
  const { user, loading } = useAuth();
  const ranRef = useRef(false);

  useEffect(() => {
    if (options.enabled === false) return;
    if (loading) return;
    if (!user?.id) return;
    if (ranRef.current) return;

    const runs = getPendingRuns();
    if (runs.length === 0) {
      // 빈 큐는 다음 마운트에서 다시 평가될 수 있도록 ranRef 를 켜지 않는다.
      return;
    }
    ranRef.current = true;

    const userId = user.id;
    void drainPendingRuns(userId);
  }, [user, loading, options.enabled]);
}

export interface DrainPendingRunsOptions {
  /** sleep 구현 주입(테스트용). 기본 setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 외부에서 호출 가능한 drain 함수. 테스트 또는 명시적 트리거에 사용.
 * 현재 로그인한 userId 의 항목만 처리한다.
 */
export async function drainPendingRuns(
  userId: string,
  options: DrainPendingRunsOptions = {},
): Promise<void> {
  const all = getPendingRuns();
  const mine = all.filter((r) => r.input.userId === userId);
  for (const run of mine) {
    await drainOne(run, options);
  }
}

async function drainOne(
  run: PendingTrainingRun,
  options: DrainPendingRunsOptions,
): Promise<void> {
  // 이미 시도가 가득 찬 항목은 final-failure 로 정리.
  if (hasExhaustedAttempts(run)) {
    pushOutcomeNotice({
      localId: run.localId,
      outcome: 'final-failure',
      title: run.title,
      lastError: run.lastError,
      at: Date.now(),
    });
    removePendingRun(run.localId);
    return;
  }

  // 남은 시도 한도 안에서 한 번의 drain 사이클을 실행.
  const remaining = Math.max(1, MAX_TOTAL_ATTEMPTS - run.attempts);
  const backoffs = DRAIN_BACKOFFS_MS.slice(0, Math.max(0, remaining - 1));

  let observedSessionId = run.partialSessionId;

  const result = await submitCompletedTrainingWithRetry(
    { ...run.input, existingSessionId: run.partialSessionId },
    {
      backoffsMs: backoffs,
      sleep: options.sleep,
      onAttempt: ({ result }) => {
        if (result.sessionCreated && result.sessionId && !observedSessionId) {
          observedSessionId = result.sessionId;
          // 부분 진행분이 새로 확보되면 즉시 영속화 — 도중에 앱이 죽어도 다음 진입에서 재사용.
          updatePendingRun(run.localId, { partialSessionId: observedSessionId });
        }
      },
    },
  );

  const newAttempts = run.attempts + result.totalAttempts;

  if (!result.error) {
    pushOutcomeNotice({
      localId: run.localId,
      outcome: 'success',
      title: run.title,
      at: Date.now(),
    });
    removePendingRun(run.localId);
    return;
  }

  if (newAttempts >= MAX_TOTAL_ATTEMPTS) {
    pushOutcomeNotice({
      localId: run.localId,
      outcome: 'final-failure',
      title: run.title,
      lastError: result.error,
      at: Date.now(),
    });
    removePendingRun(run.localId);
    return;
  }

  // 아직 시도가 남았으면 attempts/마지막 에러만 갱신해 다음 앱 진입에서 다시 시도.
  updatePendingRun(run.localId, {
    attempts: newAttempts,
    lastError: result.error,
    partialSessionId: observedSessionId,
  });
}
