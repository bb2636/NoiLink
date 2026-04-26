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
  /**
   * 이번 제출이 서버 idempotency 캐시 hit 으로 흡수되었는지(= 첫 응답이 그대로
   * 재반환됐는지) 여부. createSession / calculateMetrics 두 단계 중 하나라도
   * 캐시 hit 으로 응답되면 true 가 된다 — 한 단계라도 첫 응답을 다시 받았다면
   * 사용자 입장에선 "이미 저장된 결과를 또 보낸 셈" 이므로 안내가 필요하다.
   * 일반(첫 응답) 흐름에서는 undefined.
   */
  replayed?: boolean;
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
  /**
   * 부분 결과로 저장되는 세션의 진행률(정수 %, 0~100).
   * 값이 있으면 createSession 시 `meta.partial.progressPct` 로 영속화돼,
   * 결과 화면·히스토리 목록이 정상 완료 세션과 시각적으로 구분할 수 있다.
   * 정상 완료(전체 진행) 세션에서는 undefined.
   */
  partialProgressPct?: number;
  /**
   * 한 트레이닝 결과를 식별하는 안정 키.
   * 화면 내 자동 재시도, 사용자의 수동 재시도, 다음 진입의 백그라운드 drain 까지
   * 모두 같은 값을 사용해야 — 서버 idempotency 가 같은 키의 두 번째 요청을
   * 첫 응답으로 흡수해 트레이닝이 두 번 저장되는 것을 막는다.
   * (보통 pending 큐의 `localId` 가 그대로 들어온다.)
   */
  localId?: string;
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
  // 두 단계(createSession / calculateMetrics) 중 하나라도 캐시 hit 으로 흡수되면
  // true 가 되어 호출부에 함께 반환된다. existingSessionId 로 createSession 단계를
  // 건너뛴 경우는 metrics 단계의 신호만 반영된다(이전 시도에서 createSession 의
  // replayed 신호는 그 시도 결과로 이미 노출되었기 때문).
  let replayed = false;

  if (!sessionCreated) {
    const phases = buildTrainingPhases({
      totalDurationMs: durationMs,
      bpm: input.bpm,
      level: input.level,
      mode: input.mode,
      isComposite: input.isComposite,
      quality: q,
    });

    // 부분 결과 세션은 meta.partial 로 진행률을 함께 영속화한다(결과·기록 화면 배지 노출용).
    // 정상 완료 세션은 meta 를 보내지 않아 기존 응답과 동일하게 유지된다.
    const partialMeta =
      typeof input.partialProgressPct === 'number'
        ? {
            partial: {
              progressPct: Math.max(
                0,
                Math.min(100, Math.round(input.partialProgressPct)),
              ),
            },
          }
        : undefined;

    const sessionRes = await api.createSession(
      {
        userId: input.userId,
        mode: input.mode,
        bpm: input.bpm,
        level: input.level,
        duration: durationMs,
        isComposite: input.mode === 'COMPOSITE' || input.isComposite,
        isValid: true,
        phases,
        ...(partialMeta ? { meta: partialMeta } : {}),
      },
      input.localId ? { idempotencyKey: input.localId } : undefined,
    );

    if (!sessionRes.success || !sessionRes.data?.id) {
      return {
        sessionId: '',
        sessionCreated: false,
        error: sessionRes.error || '세션 저장 실패',
      };
    }

    sessionId = sessionRes.data.id as string;
    sessionCreated = true;
    if (sessionRes.replayed) replayed = true;
  }

  if (!input.yieldsScore || input.mode === 'FREE') {
    return { sessionId, sessionCreated, ...(replayed ? { replayed: true } : {}) };
  }

  const raw: RawMetrics = input.engineMetrics
    ? { ...input.engineMetrics, sessionId, userId: input.userId }
    : buildSyntheticRawMetrics({ sessionId, userId: input.userId, quality: q });
  const calcRes = await api.calculateMetrics(
    raw,
    input.localId ? { idempotencyKey: input.localId } : undefined,
  );
  if (!calcRes.success || !calcRes.data) {
    return {
      sessionId,
      sessionCreated: true,
      error: calcRes.error || '지표 계산 실패',
      ...(replayed ? { replayed: true } : {}),
    };
  }
  if (calcRes.replayed) replayed = true;

  return {
    sessionId,
    sessionCreated: true,
    displayScore: avgMetricScore(calcRes.data as MetricsScore),
    ...(replayed ? { replayed: true } : {}),
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
