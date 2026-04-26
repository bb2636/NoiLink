/**
 * 기관 회원 목록 조회 API 의 in-flight Promise 공유 가드 회귀 테스트 (Task #147).
 *
 * 보호 정책:
 *  - 같은 endpoint 로 `getOrganizationMembers` / `getPendingOrganizationMembers`
 *    가 동시에 두 번 호출되어도 실제 fetch 는 1회만 흐르고, 두 호출자는 같은
 *    응답 객체를 받는다. (Home.tsx 가 조직 정보를 부르는 동안 사용자가
 *    MemberSelectModal 을 여는 경우, OrganizationMembers.tsx 가 멤버/대기
 *    멤버 목록을 `Promise.all` 로 묶어 부르는 경우 등 거의 동시에 같은
 *    조회를 부르는 경합 보호.)
 *  - 호출이 settle 되면 다음 호출은 새 fetch 를 발사할 수 있어야 한다
 *    (가드가 다음 호출을 영구히 막아 stale 응답을 돌려주면 안 된다).
 *  - 첫 호출이 네트워크 실패로 끝나도 슬롯이 비워져 다음 호출이 새 fetch
 *    를 발사할 수 있어야 한다(error caching 회귀 방지).
 *
 * 배경(Task #146 → Task #147):
 *  Task #146 이 `coalesceInflight(key, factory)` 헬퍼를 만들고 홈 조회
 *  API 들에 적용했다. 같은 race 패턴이 기관 회원 목록 조회에서도
 *  일어나므로(`Home.tsx` ↔ `MemberSelectModal.tsx`,
 *  `OrganizationMembers.tsx` 의 `Promise.all` 묶음) 같은 가드를 통과시켜
 *  중복 fetch 를 잠근다.
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

type OrgMembersMethod = 'getOrganizationMembers' | 'getPendingOrganizationMembers';

const ORG_MEMBERS_METHODS: ReadonlyArray<{
  method: OrgMembersMethod;
  pathFragment: string;
}> = [
  { method: 'getOrganizationMembers', pathFragment: '/users/organization-members' },
  {
    method: 'getPendingOrganizationMembers',
    pathFragment: '/users/me/pending-organization-members',
  },
];

describe('기관 회원 목록 조회 API: in-flight 가드 (Task #147)', () => {
  for (const { method, pathFragment } of ORG_MEMBERS_METHODS) {
    describe(`api.${method}()`, () => {
      it('동시에 두 번 호출되어도 fetch 는 한 번만 흐르고 두 호출자는 같은 응답을 받는다', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-org-1');

        const deferred = deferredOkResponse({
          success: true,
          data: [{ id: 'm-1' }, { id: 'm-2' }],
        });
        fetchSpy.mockImplementationOnce(() => deferred.promise);

        const p1 = api[method]();
        const p2 = api[method]();

        await Promise.resolve();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(String(fetchSpy.mock.calls[0][0])).toContain(pathFragment);

        deferred.resolve();
        const [r1, r2] = await Promise.all([p1, p2]);

        // 같은 Promise 를 공유하므로 결과 객체도 동일 reference 여야 한다.
        expect(r1).toBe(r2);
        expect(r1.success).toBe(true);
      });

      it('settle 이후 재호출은 새 fetch 를 발사한다 (가드가 다음 호출을 막지 않음)', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-org-2');

        fetchSpy.mockImplementation(() =>
          okOnceJson({ success: true, data: [] }),
        );

        await api[method]();
        await api[method]();

        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('첫 호출이 네트워크 실패로 끝나도 슬롯이 비워져 다음 호출이 새 fetch 를 발사한다', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-org-3');

        // 첫 호출은 fetch 자체가 reject — `request` 가 try/catch 로 실패
        // 응답을 resolve 로 돌려주지만, in-flight Promise 는 어쨌든 settle
        // 되므로 finally 가 슬롯을 비워야 한다.
        fetchSpy.mockImplementationOnce(() => Promise.reject(new Error('boom')));
        const r1 = await api[method]();
        expect(r1.success).toBe(false);

        fetchSpy.mockImplementationOnce(() =>
          okOnceJson({ success: true, data: [{ id: 'm-after' }] }),
        );
        const r2 = await api[method]();
        expect(r2.success).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });
    });
  }
});
