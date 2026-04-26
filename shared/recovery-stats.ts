/**
 * 재연결 회복(BLE 단절·자동 회복 구간) 메타를 사용자별 통계·코칭 신호로 집계한다.
 *
 * 정책 배경:
 *  - 결과 화면(Result.tsx)은 단일 세션의 회복 시간을 즉시 알려준다.
 *  - 누적 통계는 "최근 N세션 평균 ≥30초" 같은 신호로 BLE 환경 점검 코칭을
 *    띄울 때 사용한다 — 한두 번의 일시 단절은 무시하고 추세가 잡힐 때만 안내한다.
 *
 * 모든 ms 입력은 정수로 가정한다. NaN/음수는 0으로 정규화한다.
 */

import type { RecoveryRawMetrics } from './types.js';

/** 세션당 평균 회복 시간이 이 임계 이상이면 "환경 점검" 코칭 카드를 켠다. */
export const RECOVERY_COACHING_THRESHOLD_MS = 30_000;

/** 코칭 신호를 만들기 위해 최소한 필요한 세션 수(노이즈 방지). */
export const RECOVERY_COACHING_MIN_SESSIONS = 3;

export interface AggregatedRecoveryStats {
  /**
   * 집계 대상 전체 세션 수 — recovery 가 0인 세션을 포함한 분모.
   * 평균 산출 시에도 이 값을 분모로 사용해 "최근 전체 세션의 평균 회복 시간" 의미를 유지.
   */
  sessionsCount: number;
  /**
   * 회복 구간이 실제로 발생한 세션 수.
   * "X개 세션 중 Y개에서 회복 발생" 같은 안내 문구에 사용.
   */
  sessionsWithRecovery: number;
  /** 누적 회복 시간(ms). */
  totalMs: number;
  /** 누적 회복 구간 발생 횟수. */
  windowsTotal: number;
  /** 세션당 평균 회복 시간(ms) = totalMs / sessionsCount. sessionsCount=0 이면 0. */
  avgMsPerSession: number;
}

const EMPTY_STATS: AggregatedRecoveryStats = {
  sessionsCount: 0,
  sessionsWithRecovery: 0,
  totalMs: 0,
  windowsTotal: 0,
  avgMsPerSession: 0,
};

function sanitizeNumber(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * 회복 구간 세그먼트(타임라인) 1개를 안전한 모양으로 정규화한다.
 *
 * - startedAt/durationMs 가 모두 정수 ms 로 통일된다 (음수·NaN 은 0).
 * - durationMs <= 0 인 항목은 의미 없는 더미로 보고 제외한다 — 결과 화면의
 *   "평균/최장 끊김" 계산이 0짜리 항목으로 희석되지 않도록 한다.
 * - object 가 아니거나 필드가 누락되면 null 을 반환한다.
 */
function sanitizeSegment(
  input: unknown,
): { startedAt: number; durationMs: number } | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  const startedAt = Math.round(sanitizeNumber(obj.startedAt));
  const durationMs = Math.round(sanitizeNumber(obj.durationMs));
  if (durationMs <= 0) return null;
  return { startedAt, durationMs };
}

/**
 * recovery 페이로드를 안전한 모양으로 정규화한다 — 음수/NaN/누락 필드를 0으로.
 * 서버 측 입력 검증용으로도 사용한다(잘못된 모양이 통계를 오염시키지 않도록).
 *
 * Task #61: segments(회복 구간 타임라인)도 정수 ms 로 정규화해 통과시킨다 —
 * 운영자가 지난 세션의 끊김 패턴을 다시 들여다볼 수 있도록 서버에 보존한다.
 * 누적 통계는 excludedMs/windows 만 보면 충분하므로 segments 가 비어 있으면
 * 굳이 빈 배열을 만들지 않고 필드를 생략한다 (과거 페이로드와 모양 호환).
 */
export function sanitizeRecoveryRawMetrics(
  input: unknown,
): RecoveryRawMetrics | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  const excludedMs = Math.round(sanitizeNumber(obj.excludedMs));
  const windows = Math.round(sanitizeNumber(obj.windows));
  const segments = Array.isArray(obj.segments)
    ? obj.segments
        .map(sanitizeSegment)
        .filter((s): s is { startedAt: number; durationMs: number } => s !== null)
    : [];
  if (excludedMs === 0 && windows === 0 && segments.length === 0) return undefined;
  const result: RecoveryRawMetrics = { excludedMs, windows };
  if (segments.length > 0) result.segments = segments;
  return result;
}

/**
 * 여러 세션의 recovery 메타를 합산한다.
 *
 * 입력은 "최근 N세션을 정확히 N개 항목으로" 넘긴다. 회복이 없었던 세션은
 * null/undefined 로 남겨야 sessionsCount(분모) 가 올바르게 잡힌다 —
 * 평균은 항상 "최근 전체 세션 기준" 값으로 산출된다.
 */
export function aggregateRecoveryStats(
  recoveries: ReadonlyArray<RecoveryRawMetrics | null | undefined>,
): AggregatedRecoveryStats {
  if (recoveries.length === 0) return EMPTY_STATS;

  let sessionsWithRecovery = 0;
  let totalMs = 0;
  let windowsTotal = 0;

  for (const r of recoveries) {
    if (!r) continue;
    const ms = sanitizeNumber(r.excludedMs);
    const w = sanitizeNumber(r.windows);
    if (ms === 0 && w === 0) continue;
    sessionsWithRecovery += 1;
    totalMs += ms;
    windowsTotal += w;
  }

  return {
    sessionsCount: recoveries.length,
    sessionsWithRecovery,
    totalMs,
    windowsTotal,
    avgMsPerSession: Math.round(totalMs / recoveries.length),
  };
}

/**
 * "환경 점검" 코칭 카드를 띄울지 판정한다.
 *
 * 기준 (단일·명시):
 *  - 최근 RECOVERY_COACHING_MIN_SESSIONS 회 이상 세션이 누적되어 추세가 잡혔고,
 *  - 그 세션들의 세션당 평균 회복 시간이 RECOVERY_COACHING_THRESHOLD_MS 이상.
 *
 * 보조 조건은 추가하지 않는다 — UI 카드 카피("평균 회복 시간이 30초를 넘었어요")와
 * 트리거가 1:1 로 일치해야 사용자가 메시지를 신뢰할 수 있다.
 */
export function shouldShowRecoveryCoaching(
  stats: AggregatedRecoveryStats,
): boolean {
  if (stats.sessionsCount < RECOVERY_COACHING_MIN_SESSIONS) return false;
  return stats.avgMsPerSession >= RECOVERY_COACHING_THRESHOLD_MS;
}
