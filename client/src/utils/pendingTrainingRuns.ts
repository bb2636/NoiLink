/**
 * 결과 저장에 실패한 트레이닝 런을 사용자가 화면을 떠난 뒤에도 잃지 않도록
 * localStorage 에 보존하고, 다음 앱 진입 시 백그라운드로 다시 보내기 위한 큐.
 *
 * 흐름:
 *  1) TrainingSessionPlay 가 in-screen 자동 백오프 재시도까지 모두 실패한 상태에서
 *     사용자가 화면을 떠나면 enqueuePendingRun() 으로 입력값과(가능하면) 부분 진행분을 저장한다.
 *  2) 다음 앱 진입 시 useDrainPendingTrainingRuns 가 큐를 비우며, 각 항목을
 *     attempts 카운트와 함께 백엔드에 다시 보낸다(submitCompletedTraining).
 *  3) 성공/최종 실패가 결정되면 outcome notice 한 건을 추가한다 → 다음에 트레이닝
 *     목록 화면이 마운트될 때 사용자에게 1회성 안내 배너로 노출된다.
 *
 * 데이터 모델은 입력값(submitCompletedTraining 의 인자) 전체를 그대로 보존한다.
 * 부분 진행분(이미 createSession 까지 성공한 경우)은 partialSessionId 로 보존해
 * 재시도 시 세션 중복 생성을 피한다.
 *
 * 저장은 localStorage 한 키(QUEUE_KEY) 에 JSON 으로 직렬화된 배열을 둔다.
 * 같은 항목이 동시에 두 곳에서 수정될 가능성은 적지만, 모든 쓰기 작업은
 * 항상 최신 큐를 다시 읽어 in-place 수정 후 저장하도록 작성되어 race 가 최소화된다.
 */
import type { Level, RawMetrics, TrainingMode } from '@noilink/shared';

export const PENDING_RUNS_KEY = 'noilink_pending_training_runs';
export const PENDING_OUTCOMES_KEY = 'noilink_pending_training_outcomes';

/** 한 번에 보존할 수 있는 최대 항목 수 — 디스크/UI 폭주 방지용 안전 상한. */
export const MAX_PENDING_RUNS = 20;
/** 한 항목이 누적할 수 있는 최대 시도 횟수(in-screen + background 합산). */
export const MAX_TOTAL_ATTEMPTS = 6;

export interface PendingTrainingRunInput {
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
}

export interface PendingTrainingRun {
  /** 큐 내부 식별자 — 서버가 부여하는 sessionId 와 분리. */
  localId: string;
  /** 큐에 처음 들어간 시각(ms). 사용자에게 안내할 때 참고용. */
  enqueuedAt: number;
  /** 누적 시도 횟수(in-screen 자동 재시도 + background drain). */
  attempts: number;
  /** 마지막 실패 사유. 디버깅/안내용. */
  lastError?: string;
  /** createSession 까지 성공한 경우의 sessionId — 재시도 시 세션 중복 생성을 막는다. */
  partialSessionId?: string;
  /** 사용자에게 노출할 트레이닝 이름(예: "기억력"). */
  title?: string;
  /** 원본 입력값. */
  input: PendingTrainingRunInput;
}

export type PendingDrainOutcome = 'success' | 'final-failure';

export interface PendingTrainingOutcome {
  localId: string;
  outcome: PendingDrainOutcome;
  title?: string;
  /** outcome 결정 시각(ms). */
  at: number;
  /** 최종 실패의 경우 마지막 에러 메시지. */
  lastError?: string;
}

function safeReadArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function safeWriteArray<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage 가 quota 초과 등으로 실패해도 앱 흐름을 깨지 않는다.
  }
}

/** 안전하게 큐 전체를 읽어온다. 손상된 데이터가 있으면 빈 배열을 반환한다. */
export function getPendingRuns(): PendingTrainingRun[] {
  return safeReadArray<PendingTrainingRun>(PENDING_RUNS_KEY).filter(
    (r): r is PendingTrainingRun =>
      !!r && typeof r === 'object' && typeof r.localId === 'string' && !!r.input,
  );
}

function generateLocalId(): string {
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 새 항목을 큐에 추가한다. 큐 상한(MAX_PENDING_RUNS)을 넘으면 가장 오래된 항목을 버린다.
 * @returns 새 항목의 localId
 */
export function enqueuePendingRun(args: {
  input: PendingTrainingRunInput;
  attempts?: number;
  partialSessionId?: string;
  lastError?: string;
  title?: string;
}): string {
  const list = getPendingRuns();
  const item: PendingTrainingRun = {
    localId: generateLocalId(),
    enqueuedAt: Date.now(),
    attempts: args.attempts ?? 0,
    lastError: args.lastError,
    partialSessionId: args.partialSessionId,
    title: args.title,
    input: args.input,
  };
  list.push(item);
  // 가장 오래된 것부터 버려 상한을 유지.
  while (list.length > MAX_PENDING_RUNS) list.shift();
  safeWriteArray(PENDING_RUNS_KEY, list);
  return item.localId;
}

/** 항목을 부분 갱신한다. 존재하지 않으면 no-op. */
export function updatePendingRun(
  localId: string,
  patch: Partial<Omit<PendingTrainingRun, 'localId' | 'input' | 'enqueuedAt'>>,
): void {
  const list = getPendingRuns();
  const idx = list.findIndex((r) => r.localId === localId);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...patch };
  safeWriteArray(PENDING_RUNS_KEY, list);
}

/** 큐에서 항목을 제거. 존재하지 않으면 no-op. */
export function removePendingRun(localId: string): void {
  const list = getPendingRuns();
  const next = list.filter((r) => r.localId !== localId);
  if (next.length === list.length) return;
  safeWriteArray(PENDING_RUNS_KEY, next);
}

/** 큐 길이만 빠르게 확인. */
export function pendingRunCount(): number {
  return getPendingRuns().length;
}

/** 시도 한도를 초과했는지 확인. */
export function hasExhaustedAttempts(run: PendingTrainingRun): boolean {
  return run.attempts >= MAX_TOTAL_ATTEMPTS;
}

// ───────────────────────────────────────────────────────────
// Outcome notices — 사용자에게 1회성으로 보여줄 큐
// ───────────────────────────────────────────────────────────

export function pushOutcomeNotice(notice: PendingTrainingOutcome): void {
  const list = safeReadArray<PendingTrainingOutcome>(PENDING_OUTCOMES_KEY);
  // 같은 localId 가 이미 있으면 덮어쓴다(상태 변화 반영).
  const without = list.filter((n) => n.localId !== notice.localId);
  without.push(notice);
  safeWriteArray(PENDING_OUTCOMES_KEY, without);
}

/** 노출하려고 outcome 들을 모두 읽고, 동시에 큐를 비운다. */
export function popOutcomeNotices(): PendingTrainingOutcome[] {
  const list = safeReadArray<PendingTrainingOutcome>(PENDING_OUTCOMES_KEY);
  if (list.length === 0) return [];
  safeWriteArray(PENDING_OUTCOMES_KEY, []);
  return list;
}

/** 테스트 편의: 모든 큐를 초기화. 프로덕션 코드는 호출하지 않는다. */
export function __resetPendingTrainingRunsForTest(): void {
  safeWriteArray(PENDING_RUNS_KEY, []);
  safeWriteArray(PENDING_OUTCOMES_KEY, []);
}
