/**
 * 앱 부트 시점에 두 안전망 청소 함수가 모두 한 번씩 실제로 호출되는지를
 * 통합 테스트로 잠근다 (Task #137).
 *
 * 보호 정책:
 *  - `AuthProvider` 가 마운트되면 다음 두 함수가 모두 한 번씩 호출되어야 한다.
 *      1) `cleanupExpiredDismissals`         (회복 코칭 닫힘 기억 — Task #98)
 *      2) `cleanupExpiredReplayedHintSeen`   (결과 화면 안내 기억 — Task #134)
 *  - 단위 테스트는 두 함수의 동작(만료 경계, 손상된 값 처리 등)을 잠그지만,
 *    "부트 useEffect 에서 실제로 호출되는지" 는 통합 테스트로만 잠을 수 있다.
 *  - 어느 한쪽이 호출 누락되면 사용자는 "기억이 영원히 안 청소됨" 이라는
 *    조용한 회귀를 모르고 지나칠 수 있으므로, spy 로 호출을 직접 확인한다.
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

// 두 청소 함수 모두를 spy 로 대체한다. 다른 export(`clearAllDismissals` /
// `clearAllReplayedHintSeen` 등)는 useAuth 의 로그아웃 경로에서 참조하므로
// 원본을 그대로 살려 둔다.
vi.mock('../../utils/recoveryCoachingDismissal', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../utils/recoveryCoachingDismissal')
  >();
  return {
    ...actual,
    cleanupExpiredDismissals: vi.fn(actual.cleanupExpiredDismissals),
  };
});
vi.mock('../../utils/replayedHintSeen', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../utils/replayedHintSeen')
  >();
  return {
    ...actual,
    cleanupExpiredReplayedHintSeen: vi.fn(actual.cleanupExpiredReplayedHintSeen),
  };
});

import api from '../../utils/api';
import { cleanupExpiredDismissals } from '../../utils/recoveryCoachingDismissal';
import { cleanupExpiredReplayedHintSeen } from '../../utils/replayedHintSeen';
import { AuthProvider } from '../useAuth';

const mockedApi = api as unknown as {
  login: ReturnType<typeof vi.fn>;
  getMe: ReturnType<typeof vi.fn>;
};

const cleanupDismissalsSpy = cleanupExpiredDismissals as unknown as ReturnType<
  typeof vi.fn
>;
const cleanupReplayedHintSpy =
  cleanupExpiredReplayedHintSeen as unknown as ReturnType<typeof vi.fn>;

const originalFetch = globalThis.fetch;

let container: HTMLDivElement;
let root: Root;

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
  cleanupDismissalsSpy.mockClear();
  cleanupReplayedHintSpy.mockClear();
  // BLE 원격 설정 호출이 마운트 도중 일어나도 테스트가 깨지지 않도록 빈 200
  // 응답을 돌려준다. 이 테스트의 관심사는 부트 청소 호출 검증이므로 본문 무시.
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

describe('useAuth × 부트 청소 안전망 호출 (Task #137 / Task #142)', () => {
  // Task #142 — 부트 useEffect 는 마운트당 정확히 한 번만 돌아야 한다.
  // 과거에는 `checkAuth = useCallback(fn, [navigate])` 가 react-router 의
  // `useNavigate()` 새 참조에 따라 다시 만들어지면서 같은 마운트 안에서도
  // effect 가 두 번 돌았고, 그 결과 두 청소 함수와 `api.getMe()` 가 두 번씩
  // 불렸다. 회귀를 막기 위해 호출 횟수를 정확히 1 로 잠근다.
  it('비로그인 상태로 부트해도 두 청소 함수가 정확히 한 번씩만 호출된다', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <div data-testid="child">child</div>
          </AuthProvider>
        </MemoryRouter>,
      );
      await flushMicrotasks();
    });

    expect(cleanupDismissalsSpy).toHaveBeenCalledTimes(1);
    expect(cleanupReplayedHintSpy).toHaveBeenCalledTimes(1);
    // 비로그인 부트(토큰 없음)에서는 getMe 자체가 불리지 않는 게 맞다.
    expect(mockedApi.getMe).not.toHaveBeenCalled();
  });

  it('세션 복원으로 로그인 상태로 부트해도 두 청소 함수와 getMe 가 정확히 한 번씩만 호출된다', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-restored');
    mockedApi.getMe.mockResolvedValueOnce({
      success: true,
      data: { id: 'u-boot', username: 'boot' },
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <div data-testid="child">child</div>
          </AuthProvider>
        </MemoryRouter>,
      );
      await flushMicrotasks();
    });

    expect(cleanupDismissalsSpy).toHaveBeenCalledTimes(1);
    expect(cleanupReplayedHintSpy).toHaveBeenCalledTimes(1);
    // Task #142 — 콜드 스타트의 getMe 도 정확히 1회만 흐른다.
    expect(mockedApi.getMe).toHaveBeenCalledTimes(1);
  });
});
