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
