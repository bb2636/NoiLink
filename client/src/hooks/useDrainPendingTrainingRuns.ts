/**
 * 결과 저장 실패로 큐에 남아 있던 트레이닝 런을 백그라운드로 다시 보낸다.
 *
 * 트리거:
 *  - 앱 진입(인증 완료) 직후 1회.
 *  - 앱이 켜진 채 네트워크가 재연결되었을 때(`online` 이벤트). 다음 앱 진입까지
 *    기다리지 않고 즉시 큐를 비워 사용자가 더 빨리 결과 안내를 받게 한다.
 *  - 앱이 백그라운드에서 포그라운드로 돌아왔을 때(`visibilitychange` → visible,
 *    `pageshow`). 모바일 환경에서 백그라운드 동안 네트워크가 잠깐 끊겼다 붙어
 *    `online` 이벤트가 누락되더라도 사용자가 앱을 다시 보는 순간 큐가 비워지도록
 *    한 번 더 기회를 만든다. throttle/in-flight 가드를 그대로 통과하므로 시도
 *    폭주는 발생하지 않는다.
 *  - 네이티브 셸(noilink-native)이 OS 단에서 네트워크 복구를 감지해
 *    `network.online` 메시지를 보낼 때(WebView 의 `online` 이벤트가 누락/지연될 수
 *    있는 환경 보강). 같은 trigger 경로를 통과하므로 throttle/in-flight 가드가
 *    동일하게 적용된다.
 *
 * 정책:
 *  - 사용자가 직접 트리거하지 않는 백그라운드 흐름이므로, UI 를 막거나 에러를 화면에
 *    노출하지 않는다(조용히 처리). 결과는 outcome notice 로 1회성 안내로 전달된다.
 *  - 인증된 사용자의 항목만 처리한다. (다른 계정 잔여 항목은 다음 그 계정 로그인 때 처리)
 *  - 한 항목이 누적 시도(MAX_TOTAL_ATTEMPTS)를 초과하면 'final-failure' 로 정리한다.
 *  - 큐가 비어 있을 때는 어떤 네트워크 호출도 하지 않는다.
 *
 * 중복 방지 / 시도 폭주 방지:
 *  - drain 은 모듈 단위 in-flight 가드로 동시에 하나만 실행된다. 같은 항목이 두 cycle
 *    에서 동시에 시도되어 outcome notice 가 중복 노출되거나 attempts 가 두 배로
 *    빠르게 소진되는 일을 막는다.
 *  - drain 사이에 최소 간격(MIN_DRAIN_INTERVAL_MS) throttle 을 적용한다. `online`
 *    이벤트가 짧은 시간 내에 여러 번 들어와도 MAX_TOTAL_ATTEMPTS 가 빠르게 소진되지
 *    않는다. 간격이 차지 않은 상태에서 트리거가 들어오면 한 번의 follow-up 으로
 *    합쳐서 예약한다.
 *  - StrictMode 등으로 마운트 effect 가 두 번 실행되어도 위 가드 덕분에 안전하다.
 */
import { useEffect } from 'react';
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

/**
 * 연속 drain 사이의 최소 간격(ms). 네트워크가 짧은 시간 내에 여러 번 깜빡여도
 * 같은 항목의 MAX_TOTAL_ATTEMPTS 가 즉시 소진되지 않도록 한다. 한 cycle 의
 * in-screen 자동 백오프(약 1.5s)와 합쳐도 한 항목당 분당 시도 횟수가 2회 이내가
 * 되도록 보수적으로 설정.
 */
export const MIN_DRAIN_INTERVAL_MS = 30_000;

interface DrainOptions {
  /** 테스트/디버깅용으로 drain 동작을 강제하거나 막을 수 있다. */
  enabled?: boolean;
}

// ───────────────────────────────────────────────────────────
// 사용자별 가드 — 모든 호출(마운트/online 이벤트/외부 호출)이 공유한다.
// userId 단위로 상태를 분리해, 계정 전환 직후 다른 사용자의 follow-up 예약이
// 새 사용자의 drain 트리거를 막지 않도록 한다(throttle 는 본질적으로 같은
// userId 의 항목들이 MAX_TOTAL_ATTEMPTS 를 빠르게 소진하지 않게 하기 위한 것이므로
// userId 단위로 충분).
// ───────────────────────────────────────────────────────────

interface UserDrainState {
  inFlight: Promise<void> | null;
  lastStartedAt: number;
  followUpTimer: ReturnType<typeof setTimeout> | null;
}

const drainStates = new Map<string, UserDrainState>();

function getDrainState(userId: string): UserDrainState {
  let s = drainStates.get(userId);
  if (!s) {
    s = { inFlight: null, lastStartedAt: 0, followUpTimer: null };
    drainStates.set(userId, s);
  }
  return s;
}

function clearPendingFollowUp(state: UserDrainState): void {
  if (state.followUpTimer != null) {
    clearTimeout(state.followUpTimer);
    state.followUpTimer = null;
  }
}

/**
 * drain 을 안전하게 트리거한다. in-flight / throttle / 빈 큐를 일관되게 처리한다.
 *
 * - in-flight 중이면 follow-up 한 번만 예약한다(현재 cycle 종료 후 throttle 만료
 *   시점에 한 번 더 실행되도록). 이미 예약되어 있으면 추가 예약은 무시.
 * - 마지막 drain 시작 후 throttle 시간이 지나지 않았다면 남은 시간만큼 미뤄서
 *   예약한다. 이미 예약되어 있으면 그대로 둔다(중복 예약 X).
 * - 큐가 비어 있으면 아무 일도 하지 않는다(예약도 하지 않는다).
 */
function tryTriggerDrain(userId: string, options: DrainPendingRunsOptions = {}): void {
  const state = getDrainState(userId);

  if (state.inFlight) {
    schedulePostDrainFollowUp(userId, options);
    return;
  }

  const now = Date.now();
  const elapsed = now - state.lastStartedAt;
  if (state.lastStartedAt > 0 && elapsed < MIN_DRAIN_INTERVAL_MS) {
    schedulePostDrainFollowUp(userId, options, MIN_DRAIN_INTERVAL_MS - elapsed);
    return;
  }

  // 즉시 실행 가능. 큐가 비어 있으면 굳이 cycle 을 돌지 않는다.
  const mine = getPendingRuns().filter((r) => r.input.userId === userId);
  if (mine.length === 0) return;

  startDrainCycle(userId, options);
}

function startDrainCycle(userId: string, options: DrainPendingRunsOptions): void {
  const state = getDrainState(userId);
  state.lastStartedAt = Date.now();
  state.inFlight = drainPendingRuns(userId, options)
    .catch(() => {
      // 백그라운드 흐름이므로 예외를 삼킨다. 개별 항목의 실패는 drainOne 내에서 처리됨.
    })
    .finally(() => {
      state.inFlight = null;
    });
}

function schedulePostDrainFollowUp(
  userId: string,
  options: DrainPendingRunsOptions,
  delayMs?: number,
): void {
  const state = getDrainState(userId);
  if (state.followUpTimer != null) return; // 이미 한 번 예약됨 — 추가 트리거는 흡수.

  const wait = delayMs ?? MIN_DRAIN_INTERVAL_MS;
  state.followUpTimer = setTimeout(() => {
    state.followUpTimer = null;
    // 현재 cycle 이 아직 끝나지 않았다면 끝난 뒤에 다시 한 번 시도한다.
    if (state.inFlight) {
      state.inFlight.finally(() => {
        // throttle 잔여 시간이 남았다면 한 번 더 예약될 수 있다(자기 자신 호출 X — tryTrigger 가 처리).
        tryTriggerDrain(userId, options);
      });
      return;
    }
    tryTriggerDrain(userId, options);
  }, Math.max(0, wait));
}

export function useDrainPendingTrainingRuns(options: DrainOptions = {}): void {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (options.enabled === false) return;
    if (loading) return;
    if (!user?.id) return;

    const userId = user.id;

    // 마운트 직후 한 번 시도(throttle/in-flight 가드가 중복 실행을 방지).
    tryTriggerDrain(userId);

    // 앱이 켜진 채 네트워크가 재연결되면 즉시 다시 시도한다.
    // 두 트리거(브라우저 `online` + 네이티브 셸 `network.online` 메시지)는 동일한
    // tryTriggerDrain 경로를 통과한다 — 두 신호가 같은 시점에 동시에 들어와도
    // in-flight/throttle 가드 덕분에 cycle 이 중복 실행되지 않는다.
    const onOnline = () => tryTriggerDrain(userId);
    // 앱이 다시 화면에 보일 때(visibilitychange → visible, pageshow)에도 한 번
    // 더 시도한다. 백그라운드에서 발생한 짧은 네트워크 단절로 `online` 이벤트가
    // 누락된 경우에도 사용자가 앱을 다시 보는 순간 큐가 비워진다. throttle/in-flight
    // 가드를 그대로 통과하므로 마운트/online 트리거와 합쳐져 시도 폭주는 없다.
    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        tryTriggerDrain(userId);
      }
    };
    const onPageShow = () => tryTriggerDrain(userId);
    window.addEventListener('online', onOnline);
    window.addEventListener('noilink-native-network-online', onOnline);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('noilink-native-network-online', onOnline);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [user, loading, options.enabled]);
}

export interface DrainPendingRunsOptions {
  /** sleep 구현 주입(테스트용). 기본 setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 외부에서 호출 가능한 drain 함수. 테스트 또는 명시적 트리거에 사용.
 * 현재 로그인한 userId 의 항목만 처리한다.
 *
 * 주의: 이 함수는 in-flight / throttle 가드를 우회한다. 일반 트리거에는
 * 훅 내부의 `tryTriggerDrain` 경로를 사용하라. 테스트는 결정적 실행을 위해
 * 직접 호출한다.
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
    {
      ...run.input,
      existingSessionId: run.partialSessionId,
      // 큐의 안정 키를 그대로 idempotency 키로 흘려보낸다 — 화면 내 시도와 background drain
      // 모두 같은 키를 쓰므로 서버는 같은 트레이닝을 두 번 저장하지 않는다.
      localId: run.localId,
    },
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

  // 아직 시도가 남았으면 attempts/마지막 에러만 갱신해 다음 trigger 시 다시 시도.
  updatePendingRun(run.localId, {
    attempts: newAttempts,
    lastError: result.error,
    partialSessionId: observedSessionId,
  });
}

/**
 * 테스트 편의: 모든 사용자의 drain 가드를 초기화한다.
 * 프로덕션 코드는 호출하지 않는다.
 */
export function __resetDrainGuardForTest(): void {
  for (const state of drainStates.values()) {
    clearPendingFollowUp(state);
  }
  drainStates.clear();
}
