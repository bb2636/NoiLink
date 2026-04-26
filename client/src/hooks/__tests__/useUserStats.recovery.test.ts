/**
 * useUserStats 의 회복(recovery) 통계 집계 회귀 테스트.
 *
 * /metrics/session/:id 응답의 raw.recovery 를 세션 1:1 로 받아 aggregateRecoveryStats
 * 에 그대로 넘기는 흐름을 보호한다 — 회복이 없었던 세션은 null 슬롯으로 남아
 * 분모에 포함되어야 "최근 N세션 평균" 의미가 깨지지 않는다 (task #46).
 *
 * 코칭 임계 분기(shouldShowRecoveryCoaching)도 함께 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  RECOVERY_COACHING_MIN_SESSIONS,
  RECOVERY_COACHING_THRESHOLD_MS,
  shouldShowRecoveryCoaching,
} from '@noilink/shared';

vi.mock('../../utils/api', () => {
  const getUserSessions = vi.fn();
  const get = vi.fn();
  const apiObj = { getUserSessions, get };
  return {
    default: apiObj,
    api: apiObj,
  };
});

import { api } from '../../utils/api';
import { useUserStats } from '../useUserStats';

const mockedApi = api as unknown as {
  getUserSessions: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};

// useUserStats 내부의 모듈-스코프 캐시 오염을 막기 위해, 테스트마다 새로운 userId 를 사용한다.
let nextUserSeq = 0;
function freshUserId(): string {
  nextUserSeq += 1;
  return `u-${nextUserSeq}-${Date.now()}`;
}

function makeSession(id: string, daysAgo: number) {
  const t = new Date();
  t.setDate(t.getDate() - daysAgo);
  return {
    id,
    userId: 'will-be-overwritten',
    mode: 'FOCUS',
    bpm: 60,
    level: 1,
    duration: 30_000,
    isComposite: false,
    isValid: true,
    phases: [],
    createdAt: t.toISOString(),
  };
}

function metricsResponse(
  sessionId: string,
  recovery: { excludedMs: number; windows: number } | null,
) {
  return {
    success: true,
    data: {
      raw: {
        sessionId,
        userId: 'irrelevant',
        touchCount: 1,
        hitCount: 1,
        rtMean: 0,
        rtSD: 0,
        createdAt: new Date().toISOString(),
        ...(recovery ? { recovery } : {}),
      },
      score: {
        sessionId,
        userId: 'irrelevant',
        focus: 80,
        createdAt: new Date().toISOString(),
      },
    },
  };
}

beforeEach(() => {
  mockedApi.getUserSessions.mockReset();
  mockedApi.get.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useUserStats — recoveryStats 집계', () => {
  it('회복 없는 세션은 null 슬롯으로 분모에 남기고 평균을 (totalMs / sessionsCount) 로 산출한다', async () => {
    const userId = freshUserId();
    const sessions = [
      makeSession('s1', 3),
      makeSession('s2', 2),
      makeSession('s3', 1),
    ];
    mockedApi.getUserSessions.mockResolvedValue({ success: true, data: sessions });
    mockedApi.get.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/metrics/session/s1') return metricsResponse('s1', null);
      if (endpoint === '/metrics/session/s2') {
        return metricsResponse('s2', { excludedMs: 9_000, windows: 1 });
      }
      if (endpoint === '/metrics/session/s3') return metricsResponse('s3', null);
      throw new Error(`unexpected endpoint: ${endpoint}`);
    });

    const { result } = renderHook(() => useUserStats(userId));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recoveryStats.sessionsCount).toBe(3);
    expect(result.current.recoveryStats.sessionsWithRecovery).toBe(1);
    expect(result.current.recoveryStats.totalMs).toBe(9_000);
    expect(result.current.recoveryStats.windowsTotal).toBe(1);
    // 평균은 항상 전체 세션 수를 분모로: 9_000 / 3 = 3_000
    expect(result.current.recoveryStats.avgMsPerSession).toBe(3_000);
    expect(shouldShowRecoveryCoaching(result.current.recoveryStats)).toBe(false);
  });

  it('세션 통계 응답이 실패해도 해당 슬롯을 null 로 보존해 분모를 깎지 않는다', async () => {
    const userId = freshUserId();
    const sessions = [makeSession('a1', 2), makeSession('a2', 1)];
    mockedApi.getUserSessions.mockResolvedValue({ success: true, data: sessions });
    mockedApi.get.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/metrics/session/a1') {
        return metricsResponse('a1', { excludedMs: 6_000, windows: 1 });
      }
      // a2 는 응답 실패 — useUserStats 는 catch 후 success:false 를 받은 것처럼 다룬다.
      throw new Error('boom');
    });

    const { result } = renderHook(() => useUserStats(userId));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recoveryStats.sessionsCount).toBe(2);
    expect(result.current.recoveryStats.sessionsWithRecovery).toBe(1);
    expect(result.current.recoveryStats.totalMs).toBe(6_000);
    expect(result.current.recoveryStats.avgMsPerSession).toBe(3_000);
  });

  it('최근 평균이 임계(30s) 이상이고 최소 세션 수를 충족하면 코칭 신호가 켜진다', async () => {
    const userId = freshUserId();
    // 3개 세션 모두 30s 이상 — 평균이 임계 이상이 되도록 구성.
    const sessions = [
      makeSession('h1', 3),
      makeSession('h2', 2),
      makeSession('h3', 1),
    ];
    mockedApi.getUserSessions.mockResolvedValue({ success: true, data: sessions });
    mockedApi.get.mockImplementation(async (endpoint: string) => {
      const ms = 31_000;
      if (endpoint === '/metrics/session/h1') {
        return metricsResponse('h1', { excludedMs: ms, windows: 1 });
      }
      if (endpoint === '/metrics/session/h2') {
        return metricsResponse('h2', { excludedMs: ms, windows: 1 });
      }
      if (endpoint === '/metrics/session/h3') {
        return metricsResponse('h3', { excludedMs: ms, windows: 1 });
      }
      throw new Error(`unexpected endpoint: ${endpoint}`);
    });

    const { result } = renderHook(() => useUserStats(userId));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recoveryStats.sessionsCount).toBeGreaterThanOrEqual(
      RECOVERY_COACHING_MIN_SESSIONS,
    );
    expect(result.current.recoveryStats.avgMsPerSession).toBeGreaterThanOrEqual(
      RECOVERY_COACHING_THRESHOLD_MS,
    );
    expect(shouldShowRecoveryCoaching(result.current.recoveryStats)).toBe(true);
  });

  it('단일 세션의 큰 회복값(임계 이상)만으로는 코칭이 켜지지 않는다 — 최소 세션 수 가드', async () => {
    const userId = freshUserId();
    const sessions = [makeSession('lone-1', 1)];
    mockedApi.getUserSessions.mockResolvedValue({ success: true, data: sessions });
    mockedApi.get.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/metrics/session/lone-1') {
        return metricsResponse('lone-1', { excludedMs: 60_000, windows: 5 });
      }
      throw new Error(`unexpected endpoint: ${endpoint}`);
    });

    const { result } = renderHook(() => useUserStats(userId));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recoveryStats.sessionsCount).toBeLessThan(
      RECOVERY_COACHING_MIN_SESSIONS,
    );
    expect(shouldShowRecoveryCoaching(result.current.recoveryStats)).toBe(false);
  });

  it('일부 세션만 큰 회복값이라도 평균이 임계 미만이면 코칭이 켜지지 않는다', async () => {
    const userId = freshUserId();
    // 6개 세션, 2개만 35s — 평균은 (35_000*2)/6 ≈ 11_667ms
    const sessions = [
      makeSession('m1', 6),
      makeSession('m2', 5),
      makeSession('m3', 4),
      makeSession('m4', 3),
      makeSession('m5', 2),
      makeSession('m6', 1),
    ];
    mockedApi.getUserSessions.mockResolvedValue({ success: true, data: sessions });
    mockedApi.get.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/metrics/session/m1') {
        return metricsResponse('m1', { excludedMs: 35_000, windows: 1 });
      }
      if (endpoint === '/metrics/session/m2') {
        return metricsResponse('m2', { excludedMs: 35_000, windows: 1 });
      }
      // 나머지는 회복 없음
      const id = endpoint.replace('/metrics/session/', '');
      return metricsResponse(id, null);
    });

    const { result } = renderHook(() => useUserStats(userId));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.recoveryStats.sessionsCount).toBe(6);
    expect(result.current.recoveryStats.sessionsWithRecovery).toBe(2);
    expect(result.current.recoveryStats.avgMsPerSession).toBeLessThan(
      RECOVERY_COACHING_THRESHOLD_MS,
    );
    expect(shouldShowRecoveryCoaching(result.current.recoveryStats)).toBe(false);
  });

  it('세션 목록 자체가 비면 recoveryStats 는 0 으로 초기화된다', async () => {
    const userId = freshUserId();
    mockedApi.getUserSessions.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() => useUserStats(userId));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockedApi.get).not.toHaveBeenCalled();
    expect(result.current.recoveryStats).toEqual({
      sessionsCount: 0,
      sessionsWithRecovery: 0,
      totalMs: 0,
      windowsTotal: 0,
      avgMsPerSession: 0,
    });
  });
});
