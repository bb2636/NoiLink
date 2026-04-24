import type { Level, MetricsScore, RawMetrics, TrainingMode } from '@noilink/shared';
import {
  buildSyntheticRawMetrics,
  buildTrainingPhases,
  inferQualityFromTaps,
} from '@noilink/shared';
import api from './api';

function avgMetricScore(m: MetricsScore): number | undefined {
  const vals = [
    m.memory,
    m.comprehension,
    m.focus,
    m.judgment,
    m.agility,
    m.endurance,
  ].filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return undefined;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export interface SubmitCompletedTrainingResult {
  /** 서버가 부여한 sessionId. createSession 실패 시 빈 문자열. */
  sessionId: string;
  displayScore?: number;
  error?: string;
  /** createSession 단계가 성공했는지 — 실패한 단계 식별과 재시도 시 활용. */
  sessionCreated: boolean;
}

export interface SubmitCompletedTrainingInput {
  userId: string;
  mode: TrainingMode;
  bpm: number;
  level: Level;
  totalDurationSec: number;
  yieldsScore: boolean;
  isComposite: boolean;
  tapCount: number;
  /** 게임 엔진이 산출한 실제 원시 메트릭(있으면 우선). */
  engineMetrics?: Omit<RawMetrics, 'sessionId' | 'userId'>;
  /**
   * 이미 createSession 까지 성공한 부분 진행분이 있다면 그 sessionId 를 넘겨
   * 세션 중복 생성을 피하고 metrics 단계만 재시도한다.
   */
  existingSessionId?: string;
}

/**
 * 세션 저장 → (점수 모드) 원시 메트릭 산출·저장 → 서버가 세션 score·리포트 갱신.
 *
 * `engineMetrics` 가 있으면 게임 엔진이 실제 측정한 값으로 제출,
 * 없으면 종전처럼 합성 값으로 제출(자유 모드/엔진 미사용 케이스용).
 *
 * `existingSessionId` 가 있으면 createSession 단계를 건너뛰고 metrics 단계만 재시도한다.
 * 이는 부분 진행분(세션은 만들어졌지만 metrics 저장이 실패한 케이스)을
 * 안전하게 재시도하기 위한 통로다.
 */
export async function submitCompletedTraining(
  input: SubmitCompletedTrainingInput,
): Promise<SubmitCompletedTrainingResult> {
  const durationMs = input.totalDurationSec * 1000;
  const q = inferQualityFromTaps(input.tapCount, input.totalDurationSec);

  let sessionId = input.existingSessionId ?? '';
  let sessionCreated = !!input.existingSessionId;

  if (!sessionCreated) {
    const phases = buildTrainingPhases({
      totalDurationMs: durationMs,
      bpm: input.bpm,
      level: input.level,
      mode: input.mode,
      isComposite: input.isComposite,
      quality: q,
    });

    const sessionRes = await api.createSession({
      userId: input.userId,
      mode: input.mode,
      bpm: input.bpm,
      level: input.level,
      duration: durationMs,
      isComposite: input.mode === 'COMPOSITE' || input.isComposite,
      isValid: true,
      phases,
    });

    if (!sessionRes.success || !sessionRes.data?.id) {
      return {
        sessionId: '',
        sessionCreated: false,
        error: sessionRes.error || '세션 저장 실패',
      };
    }

    sessionId = sessionRes.data.id as string;
    sessionCreated = true;
  }

  if (!input.yieldsScore || input.mode === 'FREE') {
    return { sessionId, sessionCreated };
  }

  const raw: RawMetrics = input.engineMetrics
    ? { ...input.engineMetrics, sessionId, userId: input.userId }
    : buildSyntheticRawMetrics({ sessionId, userId: input.userId, quality: q });
  const calcRes = await api.calculateMetrics(raw);
  if (!calcRes.success || !calcRes.data) {
    return {
      sessionId,
      sessionCreated: true,
      error: calcRes.error || '지표 계산 실패',
    };
  }

  return {
    sessionId,
    sessionCreated: true,
    displayScore: avgMetricScore(calcRes.data as MetricsScore),
  };
}

// ───────────────────────────────────────────────────────────
// 재시도 헬퍼
// ───────────────────────────────────────────────────────────

/** 재시도 사이 백오프(ms). 길이가 곧 최대 재시도 횟수 - 1. */
export const DEFAULT_RETRY_BACKOFFS_MS = [800, 2400] as const;

export interface SubmitWithRetryOptions {
  /** 사이 대기시간(ms) 배열. 길이 = 최대 추가 시도 수. 기본값: [800, 2400]. */
  backoffsMs?: readonly number[];
  /**
   * 한 번의 시도가 끝날 때마다 호출되는 콜백.
   * `partialSessionId` 가 새로 확보되면 외부에서 큐 등에 즉시 반영할 수 있게 한다.
   */
  onAttempt?: (info: {
    attemptIndex: number;
    result: SubmitCompletedTrainingResult;
  }) => void;
  /** sleep 구현(테스트용 주입). 기본 setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `submitCompletedTraining` 을 백오프와 함께 자동 재시도한다.
 * 한 번이라도 createSession 이 성공하면 이후 시도에는 그 sessionId 를 재사용해
 * 동일 트레이닝이 중복 저장되는 것을 방지한다.
 *
 * @returns 마지막 시도 결과(성공이면 error 없음, 실패면 마지막 에러 포함).
 */
export async function submitCompletedTrainingWithRetry(
  input: SubmitCompletedTrainingInput,
  options: SubmitWithRetryOptions = {},
): Promise<SubmitCompletedTrainingResult & { totalAttempts: number }> {
  const backoffs = options.backoffsMs ?? DEFAULT_RETRY_BACKOFFS_MS;
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = backoffs.length + 1;

  let currentInput = { ...input };
  let lastResult: SubmitCompletedTrainingResult | null = null;

  for (let i = 0; i < maxAttempts; i += 1) {
    const result = await submitCompletedTraining(currentInput);
    lastResult = result;
    options.onAttempt?.({ attemptIndex: i, result });
    if (!result.error) {
      return { ...result, totalAttempts: i + 1 };
    }
    // createSession 이 성공한 부분 진행분은 다음 시도부터 재사용한다.
    if (result.sessionCreated && result.sessionId && !currentInput.existingSessionId) {
      currentInput = { ...currentInput, existingSessionId: result.sessionId };
    }
    if (i < backoffs.length) {
      await sleep(backoffs[i]);
    }
  }

  return { ...(lastResult as SubmitCompletedTrainingResult), totalAttempts: maxAttempts };
}
