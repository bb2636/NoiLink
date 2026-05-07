/**
 * Home.tsx 의 streak variant 분기 회귀 테스트 (Task #152).
 *
 * Task #151 보호:
 *  - 홈 화면의 "연속 트레이닝 트렌드" 카드는 단일 출처(`/api/rankings/user/:id/card`)
 *    의 `streakDays` 로 active / broken 분기를 결정해야 한다. 이전에는 로그인 시
 *    캐시된 `user.streak` 를 그대로 써서 새 세션을 완료해도 카운터가 0 에서 멈추는
 *    회귀가 있었다.
 *  - 이 테스트는 카드 endpoint 가 돌려준 streakDays 값에 따라 다음을 잠근다:
 *      streakDays > 0 → active variant ("X일" + 🔥 가 카드에 노출)
 *      streakDays === 0 → broken variant ("시작하기" 버튼 노출)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// ───────────────────────────────────────────────────────────
// 의존성 모킹 — streak variant 분기 외 부수효과 제거
// ───────────────────────────────────────────────────────────
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: '테스터', userType: 'PERSONAL' },
  }),
}));

vi.mock('../hooks/useHome', () => ({
  useHome: () => ({
    condition: null,
    mission: null,
    quickStart: null,
    banners: [],
    loading: false,
    refetch: () => {},
  }),
}));

vi.mock('../hooks/useUserStats', () => ({
  useUserStats: () => ({
    brainIndex: 80,
    bpmAvg: 70,
    weeklyChange: 5,
    scoreUpDelta: 3,
    trendPoints: [],
    checkedDays: [false, false, false, false, false, false, false],
    topTrainings: [],
    hasData: false,
    recoveryStats: {
      sessionsCount: 0,
      sessionsWithRecovery: 0,
      totalMs: 0,
      windowsTotal: 0,
      avgMsPerSession: 0,
    },
    loading: false,
  }),
}));

// RecoverySection 은 자체 useEffect / localStorage 분기가 있어 단순 패스스루로 대체.
vi.mock('../components/RecoverySection', () => ({
  RecoverySection: () => null,
}));

vi.mock('../utils/api', () => ({
  __esModule: true,
  default: { getMyRankingCard: vi.fn() },
  api: { getMyRankingCard: vi.fn() },
}));

import { api } from '../utils/api';
import Home from './Home';

const mockGetMyRankingCard = api.getMyRankingCard as ReturnType<typeof vi.fn>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
  });
}

async function flushAsync() {
  // 카드 endpoint 의 useEffect 안 비동기 fetch 를 microtask 큐로 흘려 보낸다.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockGetMyRankingCard.mockReset();
});

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
  vi.clearAllMocks();
});

function cardResponse(streakDays: number) {
  return {
    success: true as const,
    data: {
      windowDays: 14,
      compositeScore: null,
      totalTimeHours: 0,
      streakDays,
      attendanceRate: 0,
      myRanks: {},
    },
  };
}

describe('Home — streak variant 분기 (Task #152)', () => {
  it('카드 endpoint 의 streakDays > 0 → active variant: "X일" 과 🔥 가 노출되고 시작 버튼이 사라진다', async () => {
    mockGetMyRankingCard.mockResolvedValue(cardResponse(3));

    mount(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    await flushAsync();

    expect(mockGetMyRankingCard).toHaveBeenCalledWith('user-1');
    const text = container!.textContent || '';
    // active variant 의 핵심 노출 — 카드 endpoint 의 streakDays 가 그대로 노출된다.
    expect(text).toContain('3일');
    expect(text).toContain('🔥');
    // active 일 때는 "시작하기" CTA 가 사라져야 한다 (broken 분기와의 분리 잠금).
    expect(text).not.toContain('시작하기');
  });

  it('카드 endpoint 의 streakDays === 0 → broken variant: "시작하기" 버튼이 노출되고 "X일" 카운터는 보이지 않는다', async () => {
    mockGetMyRankingCard.mockResolvedValue(cardResponse(0));

    mount(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    await flushAsync();

    expect(mockGetMyRankingCard).toHaveBeenCalledWith('user-1');
    const text = container!.textContent || '';
    expect(text).toContain('시작하기');
    // 연속 트레이닝 트렌드 카드 안의 "N일" 카운터(active 전용)는 노출되지 않아야 한다.
    expect(text).not.toMatch(/\d+일\s*🔥/);
  });

  it('카드 endpoint 가 실패해도(네트워크 오류) broken variant 로 안전 폴백된다', async () => {
    mockGetMyRankingCard.mockRejectedValue(new Error('network down'));

    mount(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
    await flushAsync();

    const text = container!.textContent || '';
    // 응답 도착 전·실패 시 streakDays = 0 유지 → broken variant.
    expect(text).toContain('시작하기');
  });
});
