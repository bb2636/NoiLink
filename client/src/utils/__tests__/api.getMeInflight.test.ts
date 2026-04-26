/**
 * `api.getMe()` in-flight Promise 공유 가드 회귀 테스트 (Task #143).
 *
 * 보호 정책:
 *  - 같은 시점에 `getMe()` 가 동시에 두 번 호출되어도 실제 fetch 는 1회만
 *    흐르고, 두 호출자는 같은 응답 객체를 받는다.
 *  - 호출이 settle 되면 다음 호출은 새 fetch 를 발사할 수 있어야 한다
 *    (가드가 다음 호출을 영구히 막아 stale 응답을 돌려주면 안 된다).
 *  - 첫 호출이 실패해도 슬롯은 비워져, 다음 호출이 정상적으로 새 요청을
 *    발사할 수 있다(에러 캐싱 회귀 보호).
 *
 * 배경(Task #142 → Task #143):
 *  Task #142 가 부트 useEffect 의 중복 트리거를 잠갔지만, `getMe` 자체에는
 *  in-flight 가드가 없어 부트 호출이 진행 중인 와중에 `noilink-native-session`
 *  이벤트나 다른 화면의 재확인이 거의 동시에 들어오면 같은 사용자 정보 조회가
 *  여전히 2회 흘렀다. API 레이어에서 in-flight Promise 를 공유해 트리거 경로가
 *  늘어나도 서버 트래픽이 한 번으로 합쳐지도록 잠근다.
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

describe('api.getMe(): in-flight 가드 (Task #143)', () => {
  it('동시에 두 번 호출되어도 fetch 는 한 번만 흐르고 두 호출자는 같은 응답을 받는다', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-getme');

    const deferred = deferredOkResponse({
      success: true,
      data: { id: 'u-shared', username: 'shared' },
    });
    fetchSpy.mockImplementationOnce(() => deferred.promise);

    // 두 트리거가 거의 동시에 도착하는 상황(예: 부트 useEffect 와
    // noilink-native-session 핸들러)을 흉내낸다. 둘 다 await 하지 않고
    // 발사한 뒤 마이크로태스크를 한 번 흘려 in-flight 슬롯이 자리 잡았는지
    // 확인한다.
    const p1 = api.getMe();
    const p2 = api.getMe();

    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    deferred.resolve();
    const [r1, r2] = await Promise.all([p1, p2]);

    // 같은 Promise 를 공유하므로 결과 객체도 동일 reference 여야 한다.
    // (호출자 한쪽이 응답을 변형해도 다른 호출자가 영향을 받는 상황 자체는
    //  현재 코드에 없지만, 회귀 보호상 reference 동일을 잠가 둔다.)
    expect(r1).toBe(r2);
    expect(r1.success).toBe(true);
    expect(r1.data?.id).toBe('u-shared');
  });

  it('settle 이후 재호출은 새 fetch 를 발사한다 (가드가 다음 호출을 막지 않음)', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-getme-2');

    fetchSpy.mockImplementation(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: () => Promise.resolve({ success: true, data: { id: 'u' } }),
        } as unknown as Response),
    );

    await api.getMe();
    await api.getMe();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('첫 호출이 네트워크 실패로 끝나도 슬롯이 비워져 다음 호출이 새 fetch 를 발사한다', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-getme-3');

    // 첫 호출은 fetch 자체가 reject 되는 시나리오. `request` 는 try/catch 로
    // resolve 된 실패 응답을 돌려주지만, in-flight Promise 는 settle 되므로
    // finally 가 슬롯을 비워야 한다.
    fetchSpy.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const r1 = await api.getMe();
    expect(r1.success).toBe(false);

    // 두 번째 호출은 정상 응답.
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ success: true, data: { id: 'u-after' } }),
      } as unknown as Response),
    );
    const r2 = await api.getMe();
    expect(r2.success).toBe(true);
    expect(r2.data?.id).toBe('u-after');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
