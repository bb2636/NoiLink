/**
 * `getMe` in-flight 가드의 useAuth 통합 테스트 (Task #143).
 *
 * 보호 정책:
 *  - 부트 useEffect 가 진행 중인 와중에 `noilink-native-session` 이벤트가
 *    거의 동시에 도착해도, 실제 `/users/me` 요청은 1회만 흐른다.
 *  - 단위 테스트(`api.getMeInflight.test.ts`)는 ApiClient 레이어의 가드를
 *    잠그지만, "useAuth 의 두 트리거가 실제로 합쳐지는지" 는 통합 테스트로만
 *    잠을 수 있다(부트 useEffect 와 native session 핸들러는 서로 다른 effect).
 *
 * 배경:
 *  Task #142 가 부트 useEffect 자체의 중복 트리거를 잠갔지만,
 *  부트 호출과 다른 트리거(`noilink-native-session` 등)가 거의 동시에
 *  도착하는 경합은 여전히 열려 있었다. Task #143 에서 `api.getMe()` 의
 *  in-flight Promise 공유 가드를 두어 같은 시점의 호출이 한 번의 네트워크
 *  요청으로 합쳐지게 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { setBleStabilityOverrideResolver } from '@noilink/shared';
import { STORAGE_KEYS } from '../../utils/constants';

vi.mock('../../native/initNativeBridge', () => ({
  isNoiLinkNativeShell: () => false,
}));
vi.mock('../../native/nativeBridgeClient', () => ({
  notifyNativeClearSession: vi.fn(),
  notifyNativePersistSession: vi.fn(),
}));

import { AuthProvider } from '../useAuth';

const originalFetch = globalThis.fetch;

let container: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.fn>;
let getMeFetchCount: number;
let resolveGetMeFetch: ((res: Response) => void) | null;

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  setBleStabilityOverrideResolver(null);
  localStorage.clear();
  getMeFetchCount = 0;
  resolveGetMeFetch = null;

  // /users/me 호출은 의도적으로 미해결 상태로 잡아 두어 "in-flight 인 동안
  // 다른 트리거가 들어오는" 시나리오를 직접 만든다. 그 외의 호출(BLE 원격
  // 설정 등)은 빈 200 으로 통과시켜 마운트 흐름을 깨뜨리지 않는다.
  fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/users/me')) {
      getMeFetchCount += 1;
      return new Promise<Response>((res) => {
        resolveGetMeFetch = res;
      });
    }
    return new Response(JSON.stringify({ success: true, data: { rules: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  // 미해결 상태로 둔 fetch 가 있으면 unmount 가 영원히 await 되지는 않지만
  // 다음 테스트로 넘어가기 전에 비워 두는 게 안전하다.
  if (resolveGetMeFetch) {
    resolveGetMeFetch(
      new Response(JSON.stringify({ success: false, error: 'cleanup' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    resolveGetMeFetch = null;
  }
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setBleStabilityOverrideResolver(null);
  localStorage.clear();
  globalThis.fetch = originalFetch;
});

describe('useAuth × getMe in-flight 가드 (Task #143)', () => {
  it('부트 트리거와 noilink-native-session 이벤트가 거의 동시에 도착해도 /users/me 는 한 번만 흐른다', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-restored');

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

    // 부트의 getMe 가 fetch 진행 중이며 아직 미해결 상태여야 한다
    // (이 상태가 아니면 "거의 동시에" 시나리오를 흉내내지 못한다).
    expect(getMeFetchCount).toBe(1);
    expect(resolveGetMeFetch).not.toBeNull();

    // 부트 직후 거의 동시에 native shell 이 세션 이벤트를 발사한다.
    // 핸들러가 다시 `checkAuth` 를 부르지만 in-flight 가드 덕에 추가
    // 네트워크 요청은 흐르지 않아야 한다.
    await act(async () => {
      window.dispatchEvent(new Event('noilink-native-session'));
      await flushMicrotasks();
    });
    expect(getMeFetchCount).toBe(1);

    // 응답이 도착하면 두 호출자 모두 정상 완료된다.
    await act(async () => {
      resolveGetMeFetch!(
        new Response(
          JSON.stringify({
            success: true,
            data: { id: 'u-shared', username: 'shared' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      resolveGetMeFetch = null;
      await flushMicrotasks();
    });

    // 가드가 다음 호출을 영구히 막지 않는지(이미 settle 된 후 새 트리거가
    // 들어오면 정상적으로 새 fetch 를 발사하는지) 한 번 더 확인한다.
    await act(async () => {
      window.dispatchEvent(new Event('noilink-native-session'));
      await flushMicrotasks();
    });
    expect(getMeFetchCount).toBe(2);
  });
});
