import { describe, it, expect } from 'vitest';
import {
  RECOVERY_COACHING_THRESHOLD_MS,
  RECOVERY_COACHING_MIN_SESSIONS,
  aggregateRecoveryStats,
  sanitizeRecoveryRawMetrics,
  shouldShowRecoveryCoaching,
} from './recovery-stats.js';

describe('sanitizeRecoveryRawMetrics', () => {
  it('returns undefined for non-object input', () => {
    expect(sanitizeRecoveryRawMetrics(null)).toBeUndefined();
    expect(sanitizeRecoveryRawMetrics(undefined)).toBeUndefined();
    expect(sanitizeRecoveryRawMetrics('foo')).toBeUndefined();
    expect(sanitizeRecoveryRawMetrics(123)).toBeUndefined();
  });

  it('drops empty (0/0) shapes so the field is treated as absent', () => {
    expect(sanitizeRecoveryRawMetrics({ excludedMs: 0, windows: 0 })).toBeUndefined();
  });

  it('clamps negative / NaN to 0 and returns undefined when both end up 0', () => {
    expect(sanitizeRecoveryRawMetrics({ excludedMs: -10, windows: NaN })).toBeUndefined();
  });

  it('rounds and preserves valid values', () => {
    expect(sanitizeRecoveryRawMetrics({ excludedMs: 1234.7, windows: 2.4 })).toEqual({
      excludedMs: 1235,
      windows: 2,
    });
  });

  it('keeps a non-zero result even when only one field is non-zero', () => {
    expect(sanitizeRecoveryRawMetrics({ excludedMs: 0, windows: 3 })).toEqual({
      excludedMs: 0,
      windows: 3,
    });
  });

  // ───────────────────────────────────────────────────────────
  // Task #61: segments(회복 구간 타임라인) 보존 회귀
  // 서버가 결과 화면 재진입·운영자 분석을 위해 segments 를 그대로 저장하려면
  // sanitize 가 segments 를 통과시키되 정수 ms 로 정규화해야 한다.
  // ───────────────────────────────────────────────────────────

  it('preserves segments and rounds startedAt / durationMs to integer ms (Task #61)', () => {
    const result = sanitizeRecoveryRawMetrics({
      excludedMs: 4_123,
      windows: 2,
      segments: [
        { startedAt: 5_000.4, durationMs: 1_500.6 },
        { startedAt: 22_000, durationMs: 2_623.2 },
      ],
    });
    expect(result).toEqual({
      excludedMs: 4_123,
      windows: 2,
      segments: [
        { startedAt: 5_000, durationMs: 1_501 },
        { startedAt: 22_000, durationMs: 2_623 },
      ],
    });
  });

  it('omits segments field entirely when the array is empty so the payload shape stays back-compatible', () => {
    const result = sanitizeRecoveryRawMetrics({
      excludedMs: 4_000,
      windows: 1,
      segments: [],
    });
    expect(result).toEqual({ excludedMs: 4_000, windows: 1 });
    expect(result).not.toHaveProperty('segments');
  });

  it('drops segment entries with non-positive durationMs so averages are not diluted by zero-length items', () => {
    const result = sanitizeRecoveryRawMetrics({
      excludedMs: 3_000,
      windows: 1,
      segments: [
        { startedAt: 1_000, durationMs: 0 },
        { startedAt: 2_000, durationMs: -50 },
        { startedAt: 5_000, durationMs: 3_000 },
      ],
    });
    expect(result?.segments).toEqual([{ startedAt: 5_000, durationMs: 3_000 }]);
  });

  it('clamps negative / NaN startedAt to 0 while keeping the segment when duration is valid', () => {
    const result = sanitizeRecoveryRawMetrics({
      excludedMs: 1_000,
      windows: 1,
      segments: [{ startedAt: -100, durationMs: 1_000 }],
    });
    expect(result?.segments).toEqual([{ startedAt: 0, durationMs: 1_000 }]);
  });

  it('treats segments as absent when not an array (defensive against malformed payloads)', () => {
    const result = sanitizeRecoveryRawMetrics({
      excludedMs: 2_000,
      windows: 1,
      segments: 'oops' as unknown as never,
    });
    expect(result).toEqual({ excludedMs: 2_000, windows: 1 });
    expect(result).not.toHaveProperty('segments');
  });

  it('drops non-object segment entries silently (defensive against malformed payloads)', () => {
    const result = sanitizeRecoveryRawMetrics({
      excludedMs: 2_000,
      windows: 1,
      segments: [
        null,
        'oops',
        { startedAt: 5_000, durationMs: 2_000 },
      ] as unknown as never[],
    });
    expect(result?.segments).toEqual([{ startedAt: 5_000, durationMs: 2_000 }]);
  });

  it('keeps a non-empty segments-only payload (excludedMs/windows = 0 but segments present is still meaningful)', () => {
    const result = sanitizeRecoveryRawMetrics({
      excludedMs: 0,
      windows: 0,
      segments: [{ startedAt: 1_000, durationMs: 500 }],
    });
    expect(result).toEqual({
      excludedMs: 0,
      windows: 0,
      segments: [{ startedAt: 1_000, durationMs: 500 }],
    });
  });
});

describe('aggregateRecoveryStats', () => {
  it('returns empty stats for an empty input array', () => {
    expect(aggregateRecoveryStats([])).toEqual({
      sessionsCount: 0,
      sessionsWithRecovery: 0,
      totalMs: 0,
      windowsTotal: 0,
      avgMsPerSession: 0,
    });
  });

  it('uses the full input length as the average denominator (zero-recovery sessions stay in the denominator)', () => {
    // 3개 세션 중 1개에서 9_000ms 회복 → avg = 9_000 / 3 = 3_000
    const stats = aggregateRecoveryStats([
      null,
      { excludedMs: 9_000, windows: 1 },
      null,
    ]);
    expect(stats.sessionsCount).toBe(3);
    expect(stats.sessionsWithRecovery).toBe(1);
    expect(stats.totalMs).toBe(9_000);
    expect(stats.avgMsPerSession).toBe(3_000);
  });

  it('treats explicit 0/0 entries as "no recovery" but keeps them in the denominator', () => {
    const stats = aggregateRecoveryStats([
      { excludedMs: 0, windows: 0 },
      { excludedMs: 6_000, windows: 1 },
    ]);
    expect(stats.sessionsCount).toBe(2);
    expect(stats.sessionsWithRecovery).toBe(1);
    expect(stats.avgMsPerSession).toBe(3_000);
  });

  it('sums totalMs/windows correctly across multiple sessions', () => {
    const stats = aggregateRecoveryStats([
      { excludedMs: 4_000, windows: 1 },
      { excludedMs: 7_000, windows: 2 },
      { excludedMs: 1_000, windows: 1 },
    ]);
    expect(stats.sessionsCount).toBe(3);
    expect(stats.sessionsWithRecovery).toBe(3);
    expect(stats.totalMs).toBe(12_000);
    expect(stats.windowsTotal).toBe(4);
    expect(stats.avgMsPerSession).toBe(4_000);
  });
});

describe('shouldShowRecoveryCoaching', () => {
  it('returns false when fewer than the minimum sessions have been observed', () => {
    const stats = aggregateRecoveryStats([
      { excludedMs: 60_000, windows: 5 }, // big single-session blow-out
    ]);
    expect(stats.sessionsCount).toBeLessThan(RECOVERY_COACHING_MIN_SESSIONS);
    expect(shouldShowRecoveryCoaching(stats)).toBe(false);
  });

  it('returns true only when the per-session average crosses the threshold', () => {
    const stats = aggregateRecoveryStats([
      { excludedMs: 32_000, windows: 1 },
      { excludedMs: 31_000, windows: 1 },
      { excludedMs: 33_000, windows: 1 },
    ]);
    expect(stats.avgMsPerSession).toBeGreaterThanOrEqual(RECOVERY_COACHING_THRESHOLD_MS);
    expect(shouldShowRecoveryCoaching(stats)).toBe(true);
  });

  it('does NOT trigger on isolated outliers when the average stays below the threshold', () => {
    // 6 sessions, only 2 above 30s, average pulled down by zero-recovery sessions
    const stats = aggregateRecoveryStats([
      { excludedMs: 35_000, windows: 2 },
      { excludedMs: 35_000, windows: 1 },
      null,
      null,
      null,
      null,
    ]);
    expect(stats.avgMsPerSession).toBeLessThan(RECOVERY_COACHING_THRESHOLD_MS);
    expect(shouldShowRecoveryCoaching(stats)).toBe(false);
  });

  it('returns false when neither condition is met', () => {
    const stats = aggregateRecoveryStats([
      { excludedMs: 1_500, windows: 1 },
      { excludedMs: 800, windows: 1 },
      { excludedMs: 1_200, windows: 1 },
    ]);
    expect(shouldShowRecoveryCoaching(stats)).toBe(false);
  });
});
