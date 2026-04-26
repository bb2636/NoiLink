/**
 * 남은 GET 조회 API 들의 in-flight Promise 공유 가드 회귀 테스트 (Task #149).
 *
 * 대상 (Task #146/#147/#148 에서 빠져 있던 GET 조회들):
 *  - `getUser(userId)`
 *  - `getUserStats(userId)`
 *  - `getUserScores(userId)`
 *  - `getGameScores(gameId, limit?)`
 *  - `getGames()`
 *  - `getGame(gameId)`
 *  - `getTerms(type?)`
 *  - `getTermByType(type)`
 *  - `getAdminTerms()`
 *  - `getAdminUsers(params?)`
 *  - `getAdminBanners()`
 *  - `getBanners()`
 *  - `getAdminSessions(params?)`
 *  - `getAdminInquiries()`
 *  - `getAdminRecoveryStats(params?)`
 *  - `getUserInquiries()` (userId 는 localStorage 에서 읽음)
 *
 * 보호 정책 (Task #143/#146/#147/#148 와 동일):
 *  - 같은 키(메서드 + endpoint, 파라미터 query 까지 포함) 로 동시에 두 번
 *    호출되어도 실제 fetch 는 1회만 흐르고, 두 호출자는 같은 응답 객체를
 *    받는다 (라우팅 전환, 포커스 복귀, Strict Mode 이중 마운트 등 거의
 *    동시에 같은 조회를 부르는 경합 보호).
 *  - 호출이 settle 되면 다음 호출은 새 fetch 를 발사할 수 있어야 한다
 *    (가드가 다음 호출을 영구히 막아 stale 응답을 돌려주면 안 된다).
 *  - 첫 호출이 네트워크 실패로 끝나도 슬롯이 비워져 다음 호출이 새 fetch
 *    를 발사할 수 있어야 한다 (error caching 회귀 방지).
 *  - 키는 endpoint(파라미터 query 포함) 단위라 파라미터가 다르면 합쳐지지
 *    않는다 — 다른 사용자/다른 게임/다른 페이지 조회가 같이 묶여 잘못된
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
 * 각 케이스: 메서드 라벨과 두 가지 호출 형태(같은 키 / 다른 키) 를 함께 둔다.
 *  - sameKeyCall: 동일한 인자로 두 번 호출 → 합쳐져야 함.
 *  - splitKeyCalls: 서로 다른 파라미터로 두 호출 → 분리되어야 함.
 *  - pathFragment: fetch URL 에 들어가야 할 검증 조각.
 *  - setup: 호출 전에 필요한 환경 준비 (예: localStorage 의 USER_ID).
 *
 * splitKeyCalls 가 null 이면 자연스러운 다른 키가 없는 메서드(예: 인자
 * 없는 `getGames`, `getAdminBanners`, `getBanners`, `getAdminTerms`,
 * `getAdminInquiries`, 인자 없이 호출하는 형태) 라 split 검증을 건너뛴다.
 */
type Case = {
  label: string;
  pathFragment: string;
  sameKeyCall: () => Promise<unknown>;
  splitKeyCalls: [() => Promise<unknown>, () => Promise<unknown>] | null;
  setup?: () => void;
};

const CASES: ReadonlyArray<Case> = [
  {
    label: 'getUser(userId)',
    pathFragment: '/users/u-shared',
    sameKeyCall: () => api.getUser('u-shared'),
    splitKeyCalls: [() => api.getUser('u-A'), () => api.getUser('u-B')],
  },
  {
    label: 'getUserStats(userId)',
    pathFragment: '/users/u-shared/stats',
    sameKeyCall: () => api.getUserStats('u-shared'),
    splitKeyCalls: [() => api.getUserStats('u-A'), () => api.getUserStats('u-B')],
  },
  {
    label: 'getUserScores(userId)',
    pathFragment: '/scores/user/u-shared',
    sameKeyCall: () => api.getUserScores('u-shared'),
    splitKeyCalls: [() => api.getUserScores('u-A'), () => api.getUserScores('u-B')],
  },
  {
    label: 'getGameScores(gameId, limit)',
    pathFragment: '/scores/game/g-shared',
    sameKeyCall: () => api.getGameScores('g-shared', 10),
    splitKeyCalls: [
      () => api.getGameScores('g-A', 10),
      () => api.getGameScores('g-B', 10),
    ],
  },
  {
    label: 'getGames()',
    pathFragment: '/training/games',
    sameKeyCall: () => api.getGames(),
    splitKeyCalls: null,
  },
  {
    label: 'getGame(gameId)',
    pathFragment: '/training/games/g-shared',
    sameKeyCall: () => api.getGame('g-shared'),
    splitKeyCalls: [() => api.getGame('g-A'), () => api.getGame('g-B')],
  },
  {
    label: 'getTerms(type)',
    pathFragment: '/terms',
    sameKeyCall: () => api.getTerms('SERVICE'),
    splitKeyCalls: [() => api.getTerms('SERVICE'), () => api.getTerms('PRIVACY')],
  },
  {
    label: 'getTermByType(type)',
    pathFragment: '/terms/service',
    sameKeyCall: () => api.getTermByType('SERVICE'),
    splitKeyCalls: [
      () => api.getTermByType('SERVICE'),
      () => api.getTermByType('PRIVACY'),
    ],
  },
  {
    label: 'getAdminTerms()',
    pathFragment: '/admin/terms',
    sameKeyCall: () => api.getAdminTerms(),
    splitKeyCalls: null,
  },
  {
    label: 'getAdminUsers(params)',
    pathFragment: '/admin/users',
    sameKeyCall: () => api.getAdminUsers({ page: 1, limit: 20 }),
    splitKeyCalls: [
      () => api.getAdminUsers({ page: 1, limit: 20 }),
      () => api.getAdminUsers({ page: 2, limit: 20 }),
    ],
  },
  {
    label: 'getAdminBanners()',
    pathFragment: '/admin/banners',
    sameKeyCall: () => api.getAdminBanners(),
    splitKeyCalls: null,
  },
  {
    label: 'getBanners()',
    pathFragment: '/home/banners',
    sameKeyCall: () => api.getBanners(),
    splitKeyCalls: null,
  },
  {
    label: 'getAdminSessions(params)',
    pathFragment: '/admin/sessions',
    sameKeyCall: () => api.getAdminSessions({ page: 1, limit: 20 }),
    splitKeyCalls: [
      () => api.getAdminSessions({ page: 1, limit: 20 }),
      () => api.getAdminSessions({ page: 2, limit: 20 }),
    ],
  },
  {
    label: 'getAdminInquiries()',
    pathFragment: '/admin/inquiries',
    sameKeyCall: () => api.getAdminInquiries(),
    splitKeyCalls: null,
  },
  {
    label: 'getAdminRecoveryStats(params)',
    pathFragment: '/admin/recovery-stats',
    sameKeyCall: () => api.getAdminRecoveryStats({ period: '7d' }),
    splitKeyCalls: [
      () => api.getAdminRecoveryStats({ period: '7d' }),
      () => api.getAdminRecoveryStats({ period: '30d' }),
    ],
  },
  {
    label: 'getUserInquiries()',
    pathFragment: '/users/inquiries/u-inq-shared',
    sameKeyCall: () => api.getUserInquiries(),
    splitKeyCalls: null,
    setup: () => {
      localStorage.setItem(STORAGE_KEYS.USER_ID, 'u-inq-shared');
    },
  },
];

describe('남은 조회 API: in-flight 가드 (Task #149)', () => {
  for (const c of CASES) {
    describe(`api.${c.label}`, () => {
      it('동시에 두 번 호출되어도 fetch 는 한 번만 흐르고 두 호출자는 같은 응답을 받는다', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-149-same');
        c.setup?.();

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
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-149-resettle');
        c.setup?.();

        fetchSpy.mockImplementation(() =>
          okOnceJson({ success: true, data: [] }),
        );

        await c.sameKeyCall();
        await c.sameKeyCall();

        expect(fetchSpy).toHaveBeenCalledTimes(2);
      });

      it('첫 호출이 네트워크 실패로 끝나도 슬롯이 비워져 다음 호출이 새 fetch 를 발사한다', async () => {
        localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-149-error');
        c.setup?.();

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

      // 인자 없는 메서드는 자연스러운 다른 키가 없으므로 split 검증을 건너뛴다.
      const split = c.splitKeyCalls;
      (split ? it : it.skip)(
        '서로 다른 파라미터의 동시 호출은 합쳐지지 않는다 (key 분리)',
        async () => {
          if (!split) return;
          const [splitA, splitB] = split;
          localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-149-split');
          c.setup?.();

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
