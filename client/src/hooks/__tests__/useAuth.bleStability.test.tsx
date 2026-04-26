/**
 * 로그인/로그아웃 시 BLE 안내 임계값 원격 설정이 다시 적용되는지 검증
 * (Task #70 회귀 테스트).
 *
 * 보호 정책:
 *  1. 로그인 성공 직후 `/api/config/ble-stability` 가 한 번 더 호출되고,
 *     `match.userId` 규칙이 곧바로 적용된다 — 사용자 단위 A/B 그룹이
 *     다음 트레이닝 진입부터 즉시 반영된다는 회귀 보장.
 *  2. 토큰을 가진 채 세션 복원(/me 성공) 직후에도 동일하게 재호출된다.
 *  3. 로그아웃 시에는 `setBleStabilityOverrideResolver(null)` 가 호출되어
 *     직전 사용자의 오버라이드가 익명 컨텍스트에 잘못 적용되지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

// React 18 의 act() 가 jsdom 환경에서 정상 동작하도록 플래그를 켠다.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import {
  DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
  resolveBleStabilityThresholds,
  setBleStabilityOverrideResolver,
} from '@noilink/shared';
import { STORAGE_KEYS } from '../../utils/constants';

// api 모듈 모킹 — 실제 네트워크 호출 없이 login/getMe 결과만 통제한다.
vi.mock('../../utils/api', () => {
  const login = vi.fn();
  const getMe = vi.fn();
  return {
    default: { login, getMe },
  };
});

// 네이티브 셸 분기는 브라우저 테스트와 무관하므로 끈다.
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

interface FetchCall {
  url: string;
}

function makeFetcher(body: unknown, calls: FetchCall[]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

/**
 * 두 사용자에 대해 서로 다른 임계값을 주는 원격 설정.
 * - u-power: windowThreshold=2 (강한 안내)
 * - u-other: windowThreshold=10 (느슨한 안내)
 * - 매칭 실패 시: 시스템 기본값(`DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD`)
 */
const REMOTE_BODY = {
  success: true,
  data: {
    rules: [
      { match: { userId: 'u-power' }, thresholds: { windowThreshold: 2 } },
      { match: { userId: 'u-other' }, thresholds: { windowThreshold: 10 } },
    ],
  },
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

describe('useAuth × BLE 안내 임계값 원격 설정 (Task #70)', () => {
  it('로그인 성공 직후 /api/config/ble-stability 가 다시 호출되어 사용자별 규칙이 즉시 적용된다', async () => {
    // 사전: 익명 컨텍스트에서는 어떤 오버라이드도 등록돼 있지 않다.
    expect(resolveBleStabilityThresholds({ userId: 'u-power' }).windowThreshold).toBe(
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    );

    // 로그인 후 호출될 fetch 만 가로챈다 (부트스트랩은 main.tsx 책임이므로
    // 이 테스트에선 Provider 마운트 시점의 호출이 일어나지 않는 경로를 다룬다).
    const calls: FetchCall[] = [];
    globalThis.fetch = makeFetcher(REMOTE_BODY, calls);

    // 토큰이 없는 상태에서 마운트 → checkAuth 가 즉시 종료(/me 호출 없음)
    // → user 는 null 그대로, 부트스트랩 effect 는 prev=null/curr=null 이므로 no-op.
    let captured: ReturnType<typeof useAuth> | null = null;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <HarnessChild onReady={(c) => (captured = c)} />
          </AuthProvider>
        </MemoryRouter>,
      );
      await flushMicrotasks();
    });
    expect(calls.length).toBe(0);
    expect(captured).not.toBeNull();

    // 로그인 성공 — 서버는 사용자 u-power 와 토큰을 돌려준다.
    mockedApi.login.mockResolvedValueOnce({
      success: true,
      data: { id: 'u-power', username: 'power' },
      token: 'tok-power',
    });

    await act(async () => {
      await captured!.login('power@example.com', 'pw');
      await flushMicrotasks();
    });

    // 로그인 직후 한 번 BLE 원격 설정이 다시 받아져야 한다.
    expect(calls.some((c) => c.url.includes('/api/config/ble-stability'))).toBe(true);

    // 그 결과로 u-power 컨텍스트에선 규칙이 적용되고, 다른 사용자/익명은 영향 없다.
    expect(resolveBleStabilityThresholds({ userId: 'u-power' }).windowThreshold).toBe(2);
    expect(resolveBleStabilityThresholds({ userId: 'u-other' }).windowThreshold).toBe(10);
    expect(resolveBleStabilityThresholds({ userId: 'u-stranger' }).windowThreshold).toBe(
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    );
  });

  it('토큰을 가진 채 세션 복원(/me 성공) 직후에도 한 번 더 받아 사용자별 규칙이 적용된다', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-restored');
    mockedApi.getMe.mockResolvedValueOnce({
      success: true,
      data: { id: 'u-power', username: 'power' },
    });

    const calls: FetchCall[] = [];
    globalThis.fetch = makeFetcher(REMOTE_BODY, calls);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <HarnessChild onReady={() => {}} />
          </AuthProvider>
        </MemoryRouter>,
      );
      await flushMicrotasks();
    });

    expect(mockedApi.getMe).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.url.includes('/api/config/ble-stability'))).toBe(true);
    expect(resolveBleStabilityThresholds({ userId: 'u-power' }).windowThreshold).toBe(2);
  });

  it('로그아웃 시 직전 사용자의 오버라이드가 익명 컨텍스트에 남지 않는다', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-restored');
    mockedApi.getMe.mockResolvedValueOnce({
      success: true,
      data: { id: 'u-power', username: 'power' },
    });

    const calls: FetchCall[] = [];
    globalThis.fetch = makeFetcher(REMOTE_BODY, calls);

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

    // 사전: 세션 복원 직후 u-power 규칙이 적용된 상태.
    expect(resolveBleStabilityThresholds({ userId: 'u-power' }).windowThreshold).toBe(2);

    await act(async () => {
      captured!.logout();
      await flushMicrotasks();
    });

    // 로그아웃 후엔 어떤 컨텍스트에서도 규칙이 살아 있으면 안 된다.
    expect(resolveBleStabilityThresholds({ userId: 'u-power' }).windowThreshold).toBe(
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    );
    expect(resolveBleStabilityThresholds({ userId: 'u-other' }).windowThreshold).toBe(
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    );
    expect(resolveBleStabilityThresholds().windowThreshold).toBe(
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    );
  });
});
