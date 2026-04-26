/**
 * 홈 화면 조회 API 의 in-flight Promise 공유 가드 회귀 테스트 (Task #146).
 *
 * 보호 정책:
 *  - 같은 `userId` 로 `getCondition`/`getMission`/`getQuickStart` 가 동시에
 *    두 번 호출되어도 실제 fetch 는 1회만 흐르고, 두 호출자는 같은 응답
 *    객체를 받는다. (라우팅 전환, 포커스 복귀, Strict Mode 이중 마운트 등
 *    여러 트리거가 거의 동시에 같은 조회를 부르는 경합 보호.)
 *  - 호출이 settle 되면 다음 호출은 새 fetch 를 발사할 수 있어야 한다
 *    (가드가 다음 호출을 영구히 막아 stale 응답을 돌려주면 안 된다).
 *  - 키는 endpoint(메서드 + 경로)로 잡혀 있어 `userId` 가 다르면 합쳐지지
 *    않는다 — 다른 사용자 조회가 같이 묶여 잘못된 응답이 흐를 위험을
 *    회귀로 잠근다.
 *
 * 배경(Task #143 → Task #146):
 *  Task #143 이 `api.getMe()` 한 곳에만 in-flight 가드를 박아 뒀던 것을
 *  `coalesceInflight(key, factory)` 헬퍼로 추출하고, 같은 패턴이 일어나는
 *  홈 조회 API 들에도 적용했다. 이 테스트는 헬퍼가 의도대로 키 단위로
 *  합쳐주고, settle 후 슬롯이 비워지며, 다른 키는 분리되는지를 잠근다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../api';
import { STORAGE_KEYS } from '../constants';

let fetchSpy: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  fetchSpy = vi.fn();
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  globalThis.fetch = originalFetch;
});

function deferredOkResponse<T>(payload: T): {
  promise: Promise<Response>;
  resolve: () => void;
} {
  let resolveFn!: (res: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolveFn = res;
  });
  return {
    promise,
    resolve: () =>
      resolveFn(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
  };
}

function okOnceJson<T>(payload: T) {
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: () => Promise.resolve(payload),
  } as unknown as Response);
}

type HomeMethod = 'getCondition' | 'getMission' | 'getQuickStart';

const HOME_METHODS: ReadonlyArray<{ method: HomeMethod; pathFragment: string }> = [
  { method: 'getCondition', pathFragment: '/home/condition/' },
  { method: 'getMission', pathFragment: '/home/mission/' },
  { method: 'getQuickStart', pathFragment: '/home/quickstart/' },
];

describe('홈 조회 API: in-flight 가드 (Task #146)', () => {
  for (const { method, pathFragment } of HOME_METHODS) {
    describe(`api.${method}()`, () => {
      it('같은 userId 로 동시에 두 번 호출되어도 fetch 는 한 번만 흐르고 두 호출자는 같은 응답을 받는다', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-home-1');

        const deferred = deferredOkResponse({
          success: true,
          data: { value: 42 },
        });
        fetchSpy.mockImplementationOnce(() => deferred.promise);

        const userId = 'u-home-shared';
        const p1 = api[method](userId);
        const p2 = api[method](userId);

        await Promise.resolve();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(String(fetchSpy.mock.calls[0][0])).toContain(`${pathFragment}${userId}`);

        deferred.resolve();
        const [r1, r2] = await Promise.all([p1, p2]);

        // 같은 Promise 를 공유하므로 결과 객체도 동일 reference 여야 한다.
        expect(r1).toBe(r2);
        expect(r1.success).toBe(true);
      });

      it('settle 이후 재호출은 새 fetch 를 발사한다 (가드가 다음 호출을 막지 않음)', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-home-2');

        fetchSpy.mockImplementation(() =>
          okOnceJson({ success: true, data: { value: 1 } }),
        );

        const userId = 'u-home-resettle';
        await api[method](userId);
        await api[method](userId);

        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('서로 다른 userId 동시 호출은 합쳐지지 않는다 (key 분리)', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-home-3');

        const d1 = deferredOkResponse({ success: true, data: { value: 'a' } });
        const d2 = deferredOkResponse({ success: true, data: { value: 'b' } });
        fetchSpy
          .mockImplementationOnce(() => d1.promise)
          .mockImplementationOnce(() => d2.promise);

        const p1 = api[method]('user-A');
        const p2 = api[method]('user-B');

        await Promise.resolve();
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        d1.resolve();
        d2.resolve();
        await Promise.all([p1, p2]);
      });

      it('첫 호출이 네트워크 실패로 끝나도 슬롯이 비워져 다음 호출이 새 fetch 를 발사한다', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-home-4');

        // 첫 호출은 fetch 자체가 reject — `request` 가 try/catch 로 실패
        // 응답을 resolve 로 돌려주지만, in-flight Promise 는 어쨌든 settle
        // 되므로 finally 가 슬롯을 비워야 한다.
        fetchSpy.mockImplementationOnce(() => Promise.reject(new Error('boom')));
        const userId = 'u-home-error';
        const r1 = await api[method](userId);
        expect(r1.success).toBe(false);

        fetchSpy.mockImplementationOnce(() =>
          okOnceJson({ success: true, data: { value: 'after' } }),
        );
        const r2 = await api[method](userId);
        expect(r2.success).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
    });
  }
});
