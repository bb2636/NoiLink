/**
 * 자주 호출되는 조회 API 들의 in-flight Promise 공유 가드 회귀 테스트 (Task #148).
 *
 * 대상:
 *  - `listOrganizations` (가입 화면 부트)
 *  - `getOrganizationInsightReport(organizationId)`
 *  - `getOrganizationSessionsForTrend(organizationId)`
 *  - `getRankings(type?, limit?, organizationId?)`
 *  - `getUserSessions(userId, options?)`
 *  - `getUserReports(userId, limit?)`
 *
 * 보호 정책 (Task #143/#146/#147 과 동일):
 *  - 같은 키(메서드 + endpoint, 파라미터 query 까지 포함) 로 동시에 두 번
 *    호출되어도 실제 fetch 는 1회만 흐르고, 두 호출자는 같은 응답 객체를
 *    받는다 (라우팅 전환, 포커스 복귀, Strict Mode 이중 마운트 등 거의
 *    동시에 같은 조회를 부르는 경합 보호).
 *  - 호출이 settle 되면 다음 호출은 새 fetch 를 발사할 수 있어야 한다
 *    (가드가 다음 호출을 영구히 막아 stale 응답을 돌려주면 안 된다).
 *  - 첫 호출이 네트워크 실패로 끝나도 슬롯이 비워져 다음 호출이 새 fetch
 *    를 발사할 수 있어야 한다 (error caching 회귀 방지).
 *  - 키는 endpoint(파라미터 query 포함) 단위라 파라미터가 다르면 합쳐지지
 *    않는다 — 다른 사용자/다른 기관/다른 옵션 조회가 같이 묶여 잘못된
 *    응답이 흐를 위험을 회귀로 잠근다.
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

/**
 * 각 케이스: 메서드 이름과 두 가지 호출 형태(같은 키 / 다른 키) 를 함께 둔다.
 *  - sameKeyCall: 동일한 인자로 두 번 호출 → 합쳐져야 함.
 *  - splitKeyCalls: 서로 다른 파라미터로 두 호출 → 분리되어야 함.
 *  - pathFragment: fetch URL 에 들어가야 할 검증 조각.
 */
type Case = {
  label: string;
  pathFragment: string;
  sameKeyCall: () => Promise<unknown>;
  // splitKeyCalls 가 null 이면 자연스러운 다른 키가 없는 메서드(예: 인자
  // 없는 `listOrganizations`)라 split 검증을 건너뛴다.
  splitKeyCalls: [() => Promise<unknown>, () => Promise<unknown>] | null;
};

const CASES: ReadonlyArray<Case> = [
  {
    label: 'listOrganizations()',
    pathFragment: '/users/organizations',
    sameKeyCall: () => api.listOrganizations(),
    splitKeyCalls: null,
  },
  {
    label: 'getOrganizationInsightReport(organizationId)',
    pathFragment: '/reports/organization/',
    sameKeyCall: () => api.getOrganizationInsightReport('org-shared'),
    splitKeyCalls: [
      () => api.getOrganizationInsightReport('org-A'),
      () => api.getOrganizationInsightReport('org-B'),
    ],
  },
  {
    label: 'getOrganizationSessionsForTrend(organizationId)',
    pathFragment: '/sessions/organization/',
    sameKeyCall: () => api.getOrganizationSessionsForTrend('org-shared'),
    splitKeyCalls: [
      () => api.getOrganizationSessionsForTrend('org-A'),
      () => api.getOrganizationSessionsForTrend('org-B'),
    ],
  },
  {
    label: 'getRankings(type, limit, organizationId)',
    pathFragment: '/rankings',
    sameKeyCall: () => api.getRankings('weekly', 10, 'org-shared'),
    splitKeyCalls: [
      () => api.getRankings('weekly', 10, 'org-A'),
      () => api.getRankings('weekly', 10, 'org-B'),
    ],
  },
  {
    label: 'getUserSessions(userId, options)',
    pathFragment: '/sessions/user/',
    sameKeyCall: () =>
      api.getUserSessions('u-shared', { limit: 5, mode: 'training' }),
    splitKeyCalls: [
      () => api.getUserSessions('u-A', { limit: 5 }),
      () => api.getUserSessions('u-B', { limit: 5 }),
    ],
  },
  {
    label: 'getUserReports(userId, limit)',
    pathFragment: '/reports/user/',
    sameKeyCall: () => api.getUserReports('u-shared', 5),
    splitKeyCalls: [
      () => api.getUserReports('u-A', 5),
      () => api.getUserReports('u-B', 5),
    ],
  },
];

describe('자주 호출되는 조회 API: in-flight 가드 (Task #148)', () => {
  for (const c of CASES) {
    describe(`api.${c.label}`, () => {
      it('동시에 두 번 호출되어도 fetch 는 한 번만 흐르고 두 호출자는 같은 응답을 받는다', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-148-same');

        const deferred = deferredOkResponse({ success: true, data: [] });
        fetchSpy.mockImplementationOnce(() => deferred.promise);

        const p1 = c.sameKeyCall();
        const p2 = c.sameKeyCall();

        await Promise.resolve();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(String(fetchSpy.mock.calls[0][0])).toContain(c.pathFragment);

        deferred.resolve();
        const [r1, r2] = await Promise.all([p1, p2]);

        // 같은 Promise 를 공유하므로 결과 객체도 동일 reference 여야 한다.
        expect(r1).toBe(r2);
      });

      it('settle 이후 재호출은 새 fetch 를 발사한다 (가드가 다음 호출을 막지 않음)', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-148-resettle');

        fetchSpy.mockImplementation(() =>
          okOnceJson({ success: true, data: [] }),
        );

        await c.sameKeyCall();
        await c.sameKeyCall();

        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('첫 호출이 네트워크 실패로 끝나도 슬롯이 비워져 다음 호출이 새 fetch 를 발사한다', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-148-error');

        // 첫 호출은 fetch 자체가 reject — `request` 가 try/catch 로 실패
        // 응답을 resolve 로 돌려주지만, in-flight Promise 는 어쨌든 settle
        // 되므로 finally 가 슬롯을 비워야 한다.
        fetchSpy.mockImplementationOnce(() => Promise.reject(new Error('boom')));
        const r1 = (await c.sameKeyCall()) as { success: boolean };
        expect(r1.success).toBe(false);

        fetchSpy.mockImplementationOnce(() =>
          okOnceJson({ success: true, data: [] }),
        );
        const r2 = (await c.sameKeyCall()) as { success: boolean };
        expect(r2.success).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      // 인자 없는 메서드(`listOrganizations`)는 자연스러운 다른 키가 없으므로
      // 이 케이스 스위트에서만 split 검증을 건너뛴다.
      const split = c.splitKeyCalls;
      (split ? it : it.skip)(
        '서로 다른 파라미터의 동시 호출은 합쳐지지 않는다 (key 분리)',
        async () => {
          if (!split) return;
          const [splitA, splitB] = split;
          localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-148-split');

          const d1 = deferredOkResponse({ success: true, data: [] });
          const d2 = deferredOkResponse({ success: true, data: [] });
          fetchSpy
            .mockImplementationOnce(() => d1.promise)
            .mockImplementationOnce(() => d2.promise);

          const p1 = splitA();
          const p2 = splitB();

          await Promise.resolve();
          expect(fetchSpy).toHaveBeenCalledTimes(2);

          d1.resolve();
          d2.resolve();
          await Promise.all([p1, p2]);
        },
      );
    });
  }
});
