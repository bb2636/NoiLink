/**
 * useUserStats 주간 출석 도장(checkedDays) 회귀 테스트 — Task #144.
 *
 * 보호하는 정책:
 *  - "이번 주 월~일" 의 7칸 인덱스가 디바이스 시간대(`process.env.TZ`) 와 무관하게
 *    KST(`Asia/Seoul`) 기준의 같은 요일에 떨어진다.
 *  - 자정 직전(KST) 에 끝낸 세션이 UTC 디바이스에서도 같은 KST 요일 칸을 채운다
 *    (이전 구현은 `new Date().getDay()` + `setHours(0,0,0,0)` 로 디바이스 로컬을 사용해
 *    UTC 디바이스에서 한 칸 일찍/주를 가로질러 떨어지는 어긋남이 있었다).
 *  - 다른 주에 떨어지는 세션은 7칸 어디에도 체크되지 않는다.
 *
 * 시간대 시뮬레이션:
 *  - `process.env.TZ` 를 "UTC" 로 바꿔 Node 의 `Date` 로컬 메서드가 UTC 를 보도록 한다.
 *  - 새 helper(`kstStartOfWeekMonYmd` / `isoToKstLocalDate`) 는 `Intl` 에 명시한 KST 를 쓰므로
 *    이 변경의 영향을 받지 않는다 — 그래서 검증은 디바이스 TZ 에 둔감해야 한다.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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

let nextUserSeq = 0;
function freshUserId(): string {
  nextUserSeq += 1;
  return `weekly-u-${nextUserSeq}-${Date.now()}`;
}

function buildSession(id: string, createdAtIso: string) {
  return {
    id,
    userId: 'irrelevant',
    mode: 'FOCUS',
    bpm: 60,
    level: 1,
    duration: 30_000,
    isComposite: false,
    isValid: true,
    phases: [],
    createdAt: createdAtIso,
  };
}

function metricsResponse(sessionId: string) {
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

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  // UTC 디바이스를 시뮬레이션 — 새 구현이 KST 로 잠겨 있는지 검증하기 위함.
  process.env.TZ = 'UTC';
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

beforeEach(() => {
  mockedApi.getUserSessions.mockReset();
  mockedApi.get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useUserStats — checkedDays 가 KST 기준으로 잠긴다 (Task #144)', () => {
  it('자정 직전(KST) 에 끝낸 세션은 UTC 디바이스에서도 KST 요일 칸을 채운다', async () => {
    // "현재" 를 KST 2026-04-26(일) 12:00 = UTC 03:00 로 고정.
    //  - 이번 주(KST) 월요일 = 2026-04-20.
    //  - 디바이스 TZ 가 UTC 라도 helper 가 KST 로 잠그면 같은 주를 가리켜야 한다.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-26T03:00:00.000Z'));

    // 세션: UTC 2026-04-22T15:30Z = KST 2026-04-23(목) 00:30
    //  - 디바이스(UTC) 로컬로는 수요일(인덱스 2) 로 보일 수 있는 시각이지만
    //  - KST 로 잠그면 목요일(인덱스 3) 칸이 체크돼야 한다.
    const userId = freshUserId();
    mockedApi.getUserSessions.mockResolvedValue({
      success: true,
      data: [buildSession('s-thu-kst', '2026-04-22T15:30:00.000Z')],
    });
    mockedApi.get.mockImplementation(async (endpoint: string) => {
      const id = endpoint.replace('/metrics/session/', '');
      return metricsResponse(id);
    });

    const { result } = renderHook(() => useUserStats(userId));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 정확히 KST 목요일(=3) 한 칸만 체크돼야 한다 — UTC 수요일(=2) 칸이 체크되면 회귀.
    expect(result.current.checkedDays).toEqual([
      false, // 월
      false, // 화
      false, // 수  ← 디바이스(UTC) 로컬을 보면 잘못 체크되던 칸
      true,  // 목  ← KST 기준의 정답 칸
      false, // 금
      false, // 토
      false, // 일
    ]);
  });

  it('지난 주 일요일(KST 23:59) 세션은 다음 주 월요일이 아닌 어떤 칸도 채우지 않는다', async () => {
    // "현재" = KST 2026-04-27(월) 09:00 = UTC 2026-04-27T00:00Z
    //  - 이번 주(KST) 월요일 = 2026-04-27, 새 주의 첫 날.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-27T00:00:00.000Z'));

    // 세션: UTC 2026-04-26T14:30Z = KST 2026-04-26(일) 23:30 — 지난 주 마지막 날.
    //  - 새 헬퍼는 KST 일요일을 정확히 인식해 이번 주 7칸 어디에도 체크하지 않아야 한다.
    //  - 이전 구현은 디바이스 로컬(UTC) 을 보아 "토요일" 슬롯에 잘못 체크할 가능성이 있었다.
    const userId = freshUserId();
    mockedApi.getUserSessions.mockResolvedValue({
      success: true,
      data: [buildSession('s-last-week', '2026-04-26T14:30:00.000Z')],
    });
    mockedApi.get.mockImplementation(async (endpoint: string) => {
      const id = endpoint.replace('/metrics/session/', '');
      return metricsResponse(id);
    });

    const { result } = renderHook(() => useUserStats(userId));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.checkedDays).toEqual([false, false, false, false, false, false, false]);
  });

  it('이번 주 월요일 새벽(KST 00:30) 세션은 첫 칸(월=0) 을 채운다', async () => {
    // "현재" = KST 2026-04-22(수) 12:00 = UTC 03:00
    //  - 이번 주(KST) 월요일 = 2026-04-20.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-22T03:00:00.000Z'));

    // 세션: UTC 2026-04-19T15:30Z = KST 2026-04-20(월) 00:30
    //  - 디바이스(UTC) 로컬로는 일요일(지난 주!) 로 보이지만
    //  - KST 로 잠그면 이번 주 월요일 첫 칸이 체크돼야 한다 — 주 경계 회귀의 핵심.
    const userId = freshUserId();
    mockedApi.getUserSessions.mockResolvedValue({
      success: true,
      data: [buildSession('s-mon-kst', '2026-04-19T15:30:00.000Z')],
    });
    mockedApi.get.mockImplementation(async (endpoint: string) => {
      const id = endpoint.replace('/metrics/session/', '');
      return metricsResponse(id);
    });

    const { result } = renderHook(() => useUserStats(userId));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.checkedDays).toEqual([true, false, false, false, false, false, false]);
  });
});
