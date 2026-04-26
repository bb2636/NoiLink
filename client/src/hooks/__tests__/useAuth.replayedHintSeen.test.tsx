/**
 * 결과 화면 "이미 저장된 결과를 불러왔어요" 안내의 사용자별 "본 적 있음" 기억
 * 격리(Task #133) 회귀 테스트.
 *
 * 보호 정책 (Task #130 의 "한 번에 비우기" 동작을 사용자별 prefix 키 분리로 대체):
 *  - 로그인 → 결과 화면에서 어떤 sessionId 들을 본 적 있음으로 표시 → 로그아웃
 *    하더라도 같은 사용자가 다시 로그인하면 자기 키가 살아 있어 직전에 본
 *    sessionId 의 안내가 다시 뜨지 않는다.
 *  - 같은 기기에서 다른 계정으로 로그인하면 그 사용자 버킷은 비어 있어
 *    안내가 정상적으로 1회 노출된다(현재 동작 유지).
 *  - useAuth 의 logout 은 더 이상 replayed 힌트 prefix 를 강제로 비우지 않는다 —
 *    이 보호는 키가 사용자 id 별로 분리됐기 때문에 가능해진다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { setBleStabilityOverrideResolver } from '@noilink/shared';
import { STORAGE_KEYS } from '../../utils/constants';
import {
  hasSeenReplayedHint,
  markReplayedHintSeen,
} from '../../utils/replayedHintSeen';

vi.mock('../../utils/api', () => {
  const login = vi.fn();
  const getMe = vi.fn();
  return {
    default: { login, getMe },
  };
});

vi.mock('../../native/initNativeBridge', () => ({
  isNoiLinkNativeShell: () => false,
}));
vi.mock('../../native/nativeBridgeClient', () => ({
  notifyNativeClearSession: vi.fn(),
  notifyNativePersistSession: vi.fn(),
}));

import api from '../../utils/api';
import { AuthProvider, useAuth } from '../useAuth';

const mockedApi = api as unknown as {
  login: ReturnType<typeof vi.fn>;
  getMe: ReturnType<typeof vi.fn>;
};

const originalFetch = globalThis.fetch;

let container: HTMLDivElement;
let root: Root;

function HarnessChild({
  onReady,
}: {
  onReady: (ctx: ReturnType<typeof useAuth>) => void;
}): React.ReactElement {
  const ctx = useAuth();
  React.useEffect(() => {
    onReady(ctx);
  }, [ctx, onReady]);
  return <div data-testid="user">{ctx.user?.id ?? 'anon'}</div>;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  setBleStabilityOverrideResolver(null);
  localStorage.clear();
  mockedApi.login.mockReset();
  mockedApi.getMe.mockReset();
  // BLE 원격 설정 호출이 마운트 도중 일어나도 테스트가 깨지지 않도록 빈 200 응답을
  // 돌려준다. 이 테스트의 관심사는 결과 화면 힌트 기억 격리이므로 본문은 무시.
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: { rules: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setBleStabilityOverrideResolver(null);
  localStorage.clear();
  globalThis.fetch = originalFetch;
});

describe('useAuth × 결과 화면 replayed 힌트 사용자별 격리 (Task #133)', () => {
  it('로그아웃 후 같은 사용자로 다시 로그인하면 직전 sessionId "본 적 있음" 기억이 살아 있다', async () => {
    // 사전: 세션 복원으로 사용자 u-prev 로 로그인 상태 진입.
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-restored');
    mockedApi.getMe.mockResolvedValueOnce({
      success: true,
      data: { id: 'u-prev', username: 'prev' },
    });

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <HarnessChild onReady={(c) => (captured = c)} />
          </AuthProvider>
        </MemoryRouter>,
      );
      await flushMicrotasks();
    });

    // 로그인 상태에서 결과 화면 안내를 두 sessionId 에 대해 본 것으로 기록.
    markReplayedHintSeen('u-prev', 'sess-prev-A');
    markReplayedHintSeen('u-prev', 'sess-prev-B');
    expect(hasSeenReplayedHint('u-prev', 'sess-prev-A')).toBe(true);
    expect(hasSeenReplayedHint('u-prev', 'sess-prev-B')).toBe(true);

    // 로그아웃.
    await act(async () => {
      captured!.logout();
      await flushMicrotasks();
    });

    // 같은 사용자(u-prev)로 다시 로그인하면 직전에 본 sessionId 의 안내가
    // 다시 뜨지 않아야 한다 — 자기 prefix 키가 살아 있기 때문.
    expect(hasSeenReplayedHint('u-prev', 'sess-prev-A')).toBe(true);
    expect(hasSeenReplayedHint('u-prev', 'sess-prev-B')).toBe(true);
  });

  it('로그아웃 후 다른 사용자로 로그인하면 새 사용자에게 안내가 1회 정상 노출된다', async () => {
    // 사전: 세션 복원으로 사용자 u-prev 로 로그인 상태 진입.
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-restored');
    mockedApi.getMe.mockResolvedValueOnce({
      success: true,
      data: { id: 'u-prev', username: 'prev' },
    });

    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <HarnessChild onReady={(c) => (captured = c)} />
          </AuthProvider>
        </MemoryRouter>,
      );
      await flushMicrotasks();
    });

    // 직전 사용자가 두 sessionId 의 안내를 본 적 있음으로 기록.
    markReplayedHintSeen('u-prev', 'sess-shared');
    markReplayedHintSeen('u-prev', 'sess-only-prev');
    expect(hasSeenReplayedHint('u-prev', 'sess-shared')).toBe(true);

    // 로그아웃.
    await act(async () => {
      captured!.logout();
      await flushMicrotasks();
    });

    // 다른 사용자(u-new)의 버킷에서는 같은 sessionId 라도 본 적 없음.
    expect(hasSeenReplayedHint('u-new', 'sess-shared')).toBe(false);
    expect(hasSeenReplayedHint('u-new', 'sess-only-prev')).toBe(false);
    // 그리고 한 번 mark 하면 그 다음부터는 정상적으로 1회 노출 정책이 동작한다.
    markReplayedHintSeen('u-new', 'sess-shared');
    expect(hasSeenReplayedHint('u-new', 'sess-shared')).toBe(true);
    // 직전 사용자의 기억은 그 사이에도 영향을 받지 않아야 한다.
    expect(hasSeenReplayedHint('u-prev', 'sess-shared')).toBe(true);
  });
});
