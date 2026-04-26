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
  /**
   * 결과 화면 비교 카드에 사용할 직전 세션 점수(Task #122).
   * `includePreviousScore: true` 가 입력으로 들어와 사용자 결과 화면 진입과
   * 함께 호출된 경우에만 채워진다(background drain 등은 undefined 로 둔다).
   * - 직전 세션이 없거나(첫 세션) 모두 점수 미산출이면 `null`.
   * - 조회 자체가 실패하면(네트워크 등) 그대로 `null` 로 폴백한다 — 결과 화면이
   *   비교 카드를 자연스럽게 숨기고, 가짜 폴백을 만들지 않는다.
   * 입력에서 fetch 를 요구하지 않았거나 직전 점수를 의미 있게 조회할 수 없는
   * 흐름(createSession 실패 / FREE 모드) 에서는 undefined 로 남는다.
   */
  previousScore?: number | null;
  /**
   * 직전 점수의 세션 `createdAt`(ISO 8601, Task #122).
   * 결과 화면 비교 카드의 직전 날짜 라벨용 — 점수와 한 쌍으로만 채워져,
   * 라벨이 어긋난 채 새어 나가는 일이 없다. 직전 세션이 없거나 조회 실패면 `null`.
   */
  previousScoreCreatedAt?: string | null;
  /**
   * 직전 점수 세션의 KST 기준 표시용 날짜(`YYYY-MM-DD`, Task #132).
   * 서버가 같은 KST 헬퍼(`shared/kst-date.ts` 의 `isoToKstLocalDate`) 로
   * 만들어 보낸 값으로, 디바이스 시간대와 무관하게 자정 경계에서도 라벨이
   * 흔들리지 않게 한다. 점수가 없으면 같이 `null` 로 폴백된다.
   */
  previousScoreLocalDate?: string | null;
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
  /**
   * true 면 calculateMetrics 와 함께 직전 점수 단건 엔드포인트
   * (`/metrics/session/:sessionId/previous-score`) 를 병렬 호출해 결과에
   * `previousScore`/`previousScoreCreatedAt` 을 채운다(Task #122).
   *
   * 사용자가 결과 화면으로 곧장 진입하는 흐름(TrainingSessionPlay) 에서만 true 를
   * 넘긴다. background drain 같이 결과 화면을 띄우지 않는 흐름은 명시적으로
   * 생략(또는 false) 해 불필요한 네트워크를 만들지 않는다.
   *
   * 호출 시점:
   *  - createSession 이 성공해 sessionId 가 확보된 직후 calculateMetrics 와
   *    `Promise.all` 로 묶인다 — 직전 점수 조회 때문에 제출 자체가 느려지지 않는다.
   *  - FREE 모드 / yieldsScore=false 처럼 결과 화면이 비교 카드를 그리지 않는
   *    흐름에서는 플래그가 true 여도 호출하지 않는다(낭비 방지).
   *  - 조회가 실패해도 제출 결과 자체에는 영향이 없다 — 결과 객체에서
   *    previousScore 가 null 로 폴백된다.
   */
  includePreviousScore?: boolean;
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
    if (sessionRes.replayed) {
      replayed = true;
      // 사용자에게 노출되는 안내(replayed 힌트)는 결과 객체로만 흐르고,
      // 운영 디버깅용으로 어느 단계에서 캐시 hit 이 났는지만 콘솔에 남긴다.
      // "왜 replayed 가 떴지?" 진단 시 createSession / calculateMetrics
      // 둘 중 어느 쪽이 흡수된 건지 즉시 보이도록 단계 라벨을 함께 적는다.
      console.info('[submit] idempotency replay', { stage: 'createSession' });
    }
  }

  if (!input.yieldsScore || input.mode === 'FREE') {
    return { sessionId, sessionCreated, ...(replayed ? { replayed: true } : {}) };
  }

  const raw: RawMetrics = input.engineMetrics
    ? { ...input.engineMetrics, sessionId, userId: input.userId }
    : buildSyntheticRawMetrics({ sessionId, userId: input.userId, quality: q });
  // 직전 점수 단건 엔드포인트(Task #114) 를 calculateMetrics 와 병렬로 호출해
  // 결과 화면 비교 카드용 직전 점수/날짜를 함께 채운다(Task #122). 이 두 호출은
  // 서로 의존하지 않으므로 `Promise.all` 로 묶어 직전 점수 조회 때문에 제출이
  // 느려지지 않게 한다. `includePreviousScore=false` (기본값) 면 호출하지 않아
  // background drain 등은 기존과 동일한 단일 호출 비용만 든다.
  // 조회 실패는 제출 결과 자체에 영향을 주지 않는다 — 결과의 previousScore 가
  // `null` 로 폴백되어 결과 화면이 비교 카드를 자연스럽게 숨긴다.
  const previousScorePromise = input.includePreviousScore
    ? fetchPreviousScore(sessionId)
    : null;
  const calcRes = await api.calculateMetrics(
    raw,
    input.localId ? { idempotencyKey: input.localId } : undefined,
  );
  if (!calcRes.success || !calcRes.data) {
    // 제출 자체가 실패한 경우에도 직전 점수 promise 는 시작돼 있으므로
    // unhandled rejection 을 막기 위해 결과를 흡수만 하고 버린다.
    if (previousScorePromise) await previousScorePromise.catch(() => null);
    return {
      sessionId,
      sessionCreated: true,
      error: calcRes.error || '지표 계산 실패',
      ...(replayed ? { replayed: true } : {}),
    };
  }
  if (calcRes.replayed) {
    replayed = true;
    // createSession 쪽과 동일한 형식으로 단계 라벨을 남겨, 두 단계 중
    // 어느 쪽(또는 둘 다)이 흡수됐는지 로그만 봐도 즉시 구분 가능하게 한다.
    console.info('[submit] idempotency replay', { stage: 'calculateMetrics' });
  }
  const previousScoreOutcome = previousScorePromise
    ? await previousScorePromise
    : undefined;

  return {
    sessionId,
    sessionCreated: true,
    displayScore: avgMetricScore(calcRes.data as MetricsScore),
    ...(replayed ? { replayed: true } : {}),
    ...(previousScoreOutcome
      ? {
          previousScore: previousScoreOutcome.previousScore,
          previousScoreCreatedAt: previousScoreOutcome.previousScoreCreatedAt,
          previousScoreLocalDate: previousScoreOutcome.previousScoreLocalDate,
        }
      : {}),
  };
}

/**
 * 직전 점수 단건 엔드포인트(Task #114, `GET /api/metrics/session/:sessionId/previous-score`)
 * 를 호출해 점수와 세션 날짜를 한 쌍으로 돌려준다.
 *
 * 이 헬퍼의 역할은 "조회 실패를 결코 던지지 않는다" — submit 본문이 직전 점수
 * 조회 때문에 실패하지 않게 모든 에러/실패 응답을 `null` 한 쌍으로 정규화한다.
 * 결과 화면은 두 값이 모두 채워진 경우에만 비교 카드를 그리므로(Task #123),
 * `null`/`null` 폴백은 가짜 비교를 만들지 않고 카드를 자연스럽게 숨긴다.
 */
async function fetchPreviousScore(
  sessionId: string,
): Promise<{
  previousScore: number | null;
  previousScoreCreatedAt: string | null;
  previousScoreLocalDate: string | null;
}> {
  const res = await api
    .get<{
      previousScore: number | null;
      previousScoreCreatedAt?: string | null;
      // KST 기준 표시용 날짜(Task #132). 서버가 같은 헬퍼로 만들어 보내므로
      // 여기서는 받기만 하고 클라이언트에서 다시 계산하지 않는다 — 두 경로의
      // 라벨이 정확히 일치하도록 단일 진실원을 유지한다.
      previousScoreLocalDate?: string | null;
    }>(`/metrics/session/${sessionId}/previous-score`)
    .catch(() => null);
  if (!res || !res.success || !res.data) {
    return { previousScore: null, previousScoreCreatedAt: null, previousScoreLocalDate: null };
  }
  const score = typeof res.data.previousScore === 'number' ? res.data.previousScore : null;
  const createdAt =
    typeof res.data.previousScoreCreatedAt === 'string'
      ? res.data.previousScoreCreatedAt
      : null;
  const localDate =
    typeof res.data.previousScoreLocalDate === 'string'
      ? res.data.previousScoreLocalDate
      : null;
  // 점수가 없으면 날짜도 비워둬 라벨이 어긋난 채 새어 나가는 일이 없게 한다
  // (Result.tsx 가 점수 우선 정책으로 카드를 그리지만 안전망을 한 겹 더 둔다).
  if (score === null) {
    return { previousScore: null, previousScoreCreatedAt: null, previousScoreLocalDate: null };
  }
  return { previousScore: score, previousScoreCreatedAt: createdAt, previousScoreLocalDate: localDate };
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
