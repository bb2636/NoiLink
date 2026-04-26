/**
 * 로그아웃 시 결과 화면 "이미 저장된 결과를 불러왔어요" 안내의 sessionId 기준
 * "본 적 있음" 기억(Task #118)이 함께 비워지는지 검증한다 (Task #130 회귀).
 *
 * 보호 정책:
 *  - 로그인 → 결과 화면에서 어떤 sessionId 들을 본 적 있음으로 표시 → 로그아웃
 *    하면, 이후 같은 기기에서 새 사용자가 로그인해 어떤 sessionId 로 결과 화면에
 *    진입하더라도 직전 사용자의 "본 적 있음" 기억이 남아 있지 않아 안내가 정상적으로
 *    1회 노출된다.
 *  - 회복 코칭 카드의 `clearAllDismissals` 가 로그아웃에서 호출되는 패턴과 동일.
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
  // 돌려준다. 이 테스트의 관심사는 결과 화면 힌트 기억 정리이므로 본문은 무시.
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

describe('useAuth × 결과 화면 replayed 힌트 기억 정리 (Task #130)', () => {
  it('로그아웃 후에는 직전 사용자의 sessionId "본 적 있음" 기억이 남아 있지 않다', async () => {
    // 사전: 세션 복원으로 로그인 상태 진입.
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
    markReplayedHintSeen('sess-prev-A');
    markReplayedHintSeen('sess-prev-B');
    expect(hasSeenReplayedHint('sess-prev-A')).toBe(true);
    expect(hasSeenReplayedHint('sess-prev-B')).toBe(true);

    // 로그아웃.
    await act(async () => {
      captured!.logout();
      await flushMicrotasks();
    });

    // 로그아웃 직후에는 직전 사용자의 어떤 sessionId 도 "본 적 있음" 으로
    // 평가되지 않아야 한다 — 같은 기기에서 다음 사용자가 진입해도 안내가
    // 정상적으로 1회 노출된다.
    expect(hasSeenReplayedHint('sess-prev-A')).toBe(false);
    expect(hasSeenReplayedHint('sess-prev-B')).toBe(false);

    // 추가 회귀: 로그아웃 이후 새 sessionId 로 진입해도 한 번은 본 적 없음.
    expect(hasSeenReplayedHint('sess-new-X')).toBe(false);
    // 그리고 한 번 mark 하면 그 다음부터는 정상적으로 1회 노출 정책이 동작한다.
    markReplayedHintSeen('sess-new-X');
    expect(hasSeenReplayedHint('sess-new-X')).toBe(true);
  });
});
