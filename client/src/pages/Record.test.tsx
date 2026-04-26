/**
 * Record 페이지 — 부분 결과 배지 회귀 테스트 (Task #63)
 *
 * 보호 대상:
 *   - 세션 카드 안에 `meta.partial.progressPct` 가 있는 세션은 같은 줄에
 *     "부분 결과 · X%" 칩이 노출된다 (BPM/Lv 칩들과 같은 카드 안).
 *   - `meta.partial` 이 없는 세션은 같은 칩이 노출되지 않는다 (회귀 보호).
 *   - X% 값은 `getSessionPartialProgressPct` 헬퍼가 정규화한 값과 일치한다.
 *
 * api 호출과 useAuth 컨텍스트는 가벼운 더미로 대체한다 — 본 테스트는 Record.tsx
 * 의 렌더 분기만 검증한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { MemoryRouter } from 'react-router-dom';
import type { Session } from '@noilink/shared';

vi.mock('../components/Layout', () => ({
  MobileLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mobile-layout">{children}</div>
  ),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', nickname: '테스트유저' } }),
}));

// 세션 카드 클릭 → /result 네비게이션 검증을 위해 useNavigate 만 가로챈다.
// react-router-dom 의 다른 export(MemoryRouter 등)는 그대로 두고 한 함수만
// 교체해 라우팅 컨텍스트는 정상 동작하게 한다.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Record 는 api.getUserSessions 만 사용한다. mock 이 반환할 세션 배열은
// 각 테스트가 `setMockSessions` 로 직접 주입한다.
let mockSessions: Session[] = [];
vi.mock('../utils/api', () => ({
  default: {
    getUserSessions: vi.fn(async () => ({
      success: true,
      data: mockSessions,
    })),
  },
}));

import Record from './Record';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    userId: 'user-1',
    mode: 'FOCUS',
    bpm: 60,
    level: 1,
    duration: 60_000,
    score: 72,
    isComposite: false,
    isValid: true,
    phases: [],
    createdAt: new Date('2026-04-20T10:00:00Z').toISOString(),
    ...overrides,
  };
}

async function renderRecord(sessions: Session[]) {
  mockSessions = sessions;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={['/record']}>
        <Record />
      </MemoryRouter>,
    );
  });
  // useEffect → load() → setSessions 비동기 흐름이 모두 flush 되도록 한 번 더.
  await act(async () => {
    await Promise.resolve();
  });
}

function unmountRecord() {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
}

describe('Record — 세션 카드 부분 결과 배지 (Task #23 / Task #63)', () => {
  beforeEach(() => {
    mockSessions = [];
    mockNavigate.mockReset();
  });

  afterEach(() => {
    unmountRecord();
    vi.clearAllMocks();
  });

  it('meta.partial.progressPct 가 있는 세션은 카드 안에 "부분 결과 · 82%" 칩이 보인다', async () => {
    await renderRecord([
      makeSession({
        id: 'sess-partial',
        meta: { partial: { progressPct: 82 } },
      }),
    ]);

    const text = container?.textContent ?? '';
    expect(text).toContain('부분 결과 · 82%');

    const badge = container?.querySelector(
      '[aria-label="부분 결과 82 퍼센트 진행"]',
    );
    expect(badge).toBeTruthy();
  });

  it('meta.partial 이 없는 세션은 부분 결과 칩이 노출되지 않는다 (정상 완료 회귀 보호)', async () => {
    await renderRecord([makeSession({ id: 'sess-normal' })]);

    const text = container?.textContent ?? '';
    expect(text).not.toContain('부분 결과');
    // BPM/Lv 등 다른 칩들은 정상 노출되어 카드 자체는 비어있지 않음을 함께 확인.
    expect(text).toContain('BPM 60');
    expect(text).toContain('Lv 1');
  });

  it('progressPct 가 잘못된 값(NaN)이면 칩이 숨겨진다 (저장 손상 안전망)', async () => {
    await renderRecord([
      makeSession({
        id: 'sess-corrupt',
        // shared 헬퍼가 NaN 을 undefined 로 정규화해 칩이 숨겨져야 한다.
        meta: { partial: { progressPct: Number.NaN } },
      }),
    ]);

    const text = container?.textContent ?? '';
    expect(text).not.toContain('부분 결과');
  });

  it('부분 결과 / 정상 세션이 섞여 있으면 부분 세션의 카드에서만 칩이 보인다', async () => {
    await renderRecord([
      makeSession({
        id: 'sess-partial',
        meta: { partial: { progressPct: 65 } },
      }),
      makeSession({ id: 'sess-normal' }),
    ]);

    // 페이지 전체에 정확히 한 개의 부분 결과 칩만 존재해야 한다.
    const badges = container?.querySelectorAll('[aria-label^="부분 결과"]') ?? [];
    expect(badges.length).toBe(1);
    expect((badges[0] as HTMLElement).textContent).toContain('부분 결과 · 65%');
  });
});

/**
 * Record — 세션 카드 클릭 → /result 네비게이션 (Task #94)
 *
 * 보호 대상:
 *   - 세션 카드를 클릭하면 `navigate('/result', { state: { sessionId, title, ... } })`
 *     형태로 결과 화면이 열린다. Result 화면은 sessionId 만 있어도 서버에서
 *     raw.recovery 를 다시 받아 회복 카드를 그리도록 Task #75 에서 정비됐다.
 *   - 일반 모드(FOCUS 등)는 yieldsScore=true, 자유 트레이닝(FREE)은 yieldsScore=false
 *     로 명시되어야 Result 의 자유 트레이닝 폴백 분기가 정상 동작한다.
 *   - 저장된 점수가 있으면 displayScore 로 그대로 넘겨야 점수 원이 데모 폴백
 *     (DEMO_PROFILE.brainIndex)으로 떨어지지 않는다.
 */
describe('Record — 세션 카드 클릭 → /result 네비게이션 (Task #94)', () => {
  beforeEach(() => {
    mockSessions = [];
    mockNavigate.mockReset();
  });

  afterEach(() => {
    unmountRecord();
    vi.clearAllMocks();
  });

  it('세션 카드를 클릭하면 /result 로 sessionId·title·displayScore·apiMode 가 함께 넘어간다', async () => {
    await renderRecord([
      makeSession({
        id: 'sess-focus',
        mode: 'FOCUS',
        score: 81,
      }),
    ]);

    const card = container?.querySelector(
      '[aria-label="집중력 세션 결과 열기"]',
    ) as HTMLElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card!.click();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/result', {
      state: expect.objectContaining({
        sessionId: 'sess-focus',
        title: '집중력',
        yieldsScore: true,
        displayScore: 81,
        apiMode: 'FOCUS',
      }),
    });
  });

  it('자유 트레이닝(FREE) 카드는 yieldsScore=false 로 넘겨 Result 의 점수 없음 폴백을 켠다', async () => {
    await renderRecord([
      makeSession({
        id: 'sess-free',
        mode: 'FREE',
        score: undefined,
      }),
    ]);

    // FREE 카드는 카탈로그 title("자유 트레이닝")로 aria-label 이 만들어진다.
    const card = container?.querySelector(
      '[aria-label$="세션 결과 열기"]',
    ) as HTMLElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card!.click();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const [, options] = mockNavigate.mock.calls[0] as [
      string,
      { state: { sessionId: string; yieldsScore: boolean; displayScore?: number } },
    ];
    expect(options.state.sessionId).toBe('sess-free');
    expect(options.state.yieldsScore).toBe(false);
    // 점수가 없는 세션은 displayScore 키 자체를 넘기지 않아 Result 의 자체 폴백을 따라간다.
    expect(options.state.displayScore).toBeUndefined();
  });

  // Task #111 — 부분 결과 세션을 기록에서 다시 열어도 결과 화면이 부분 결과
  // 배지를 그릴 수 있게, navigate state 에 `isPartial: true` 와
  // `partialProgressPct` 가 함께 실려야 한다. 정상 완료 세션은 두 키 모두
  // 빠져 있어야 Result 의 isPartial 분기가 켜지지 않는다(회귀 보호).
  it('부분 결과 세션을 누르면 navigate state 에 isPartial=true · partialProgressPct 가 실린다 (Task #111)', async () => {
    await renderRecord([
      makeSession({
        id: 'sess-partial',
        mode: 'FOCUS',
        score: 64,
        meta: { partial: { progressPct: 73 } },
      }),
    ]);

    const card = container?.querySelector(
      '[aria-label="집중력 세션 결과 열기"]',
    ) as HTMLElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card!.click();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/result', {
      state: expect.objectContaining({
        sessionId: 'sess-partial',
        isPartial: true,
        partialProgressPct: 73,
      }),
    });
  });

  it('정상 완료 세션은 navigate state 에 isPartial / partialProgressPct 가 실리지 않는다 (Task #111 회귀 보호)', async () => {
    await renderRecord([
      makeSession({
        id: 'sess-normal',
        mode: 'FOCUS',
        score: 81,
      }),
    ]);

    const card = container?.querySelector(
      '[aria-label="집중력 세션 결과 열기"]',
    ) as HTMLElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card!.click();
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const [, options] = mockNavigate.mock.calls[0] as [
      string,
      { state: { isPartial?: boolean; partialProgressPct?: number } },
    ];
    expect(options.state.isPartial).toBeUndefined();
    expect(options.state.partialProgressPct).toBeUndefined();
  });

  it('Enter 키로도 카드를 열 수 있다(키보드 접근성)', async () => {
    await renderRecord([
      makeSession({
        id: 'sess-keyboard',
        mode: 'MEMORY',
        score: 70,
      }),
    ]);

    const card = container?.querySelector(
      '[aria-label$="세션 결과 열기"]',
    ) as HTMLElement | null;
    expect(card).toBeTruthy();

    act(() => {
      card!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/result',
      expect.objectContaining({
        state: expect.objectContaining({ sessionId: 'sess-keyboard' }),
      }),
    );
  });
});
