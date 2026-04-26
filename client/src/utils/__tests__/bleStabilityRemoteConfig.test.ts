/**
 * 부트스트랩 어댑터 회귀 테스트 (Task #48 / 캐시 보강 Task #69 / 만료 Task #87)
 *
 * 보호 정책:
 *  1. 응답이 비어 있거나(`{ rules: [] }`) 누락이면 오버라이드가 등록되지 않아
 *     `resolveBleStabilityThresholds()` 가 시스템 기본값을 그대로 돌려준다.
 *     → 원격 설정이 죽어도 클라이언트 동작이 변하지 않는다는 회귀 보장.
 *  2. 네트워크/HTTP/JSON 에러 시에도 같은 보장 — 콘솔 경고만 남기고 진행한다.
 *  3. 정상 응답이 오면 규칙대로 임계값이 바뀐다.
 *  4. 성공 응답은 캐시되어, 다음 실행에서 네트워크가 죽어 있어도 마지막 임계값이 적용된다.
 *  5. 캐시가 손상되었거나 스키마 버전이 다르면 안전하게 폐기한다.
 *  6. 캐시 envelope 의 `savedAt` 이 최대 보관 기간을 넘기면 자동 폐기된다 (Task #87).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BLE_STABILITY_REMOTE_CONFIG_CACHE_MAX_AGE_MS,
  BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION,
  DEFAULT_BLE_STABILITY_MS_THRESHOLD,
  DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
  resolveBleStabilityThresholds,
  setBleStabilityOverrideResolver,
} from '@noilink/shared';
import {
  BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY,
  DEFAULT_BLE_STABILITY_REFRESH_INTERVAL_MS,
  __resetBleStabilityRefreshThrottleForTests,
  loadBleStabilityRemoteConfig,
  refreshBleStabilityRemoteConfigIfStale,
  setupBleStabilityRemoteConfigAutoRefresh,
} from '../bleStabilityRemoteConfig';

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

/** 테스트 격리를 위해 매번 새로운 in-memory Storage 를 만든다. */
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
}

describe('loadBleStabilityRemoteConfig', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // jsdom 의 공유 localStorage 가 다른 테스트로 새지 않도록 비운다.
    try {
      globalThis.localStorage?.removeItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY);
    } catch {
      /* ignore */
    }
    // 모듈 레벨 throttle 시계는 다른 테스트의 호출 흔적이 남지 않도록 매번 비운다.
    __resetBleStabilityRefreshThrottleForTests();
  });
  afterEach(() => {
    setBleStabilityOverrideResolver(null);
    warnSpy.mockRestore();
    try {
      globalThis.localStorage?.removeItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY);
    } catch {
      /* ignore */
    }
    __resetBleStabilityRefreshThrottleForTests();
  });

  it('빈 응답이면 오버라이드를 등록하지 않아 기본 임계값이 그대로 쓰인다', async () => {
    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });
    await loadBleStabilityRemoteConfig({ fetcher, storage: null });
    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('data 가 누락된 응답도 안전하게 무시되어 기본값이 유지된다', async () => {
    const fetcher = makeFetchOk({ success: true });
    await loadBleStabilityRemoteConfig({ fetcher, storage: null });
    expect(resolveBleStabilityThresholds({ userId: 'u-1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('정상 규칙이 오면 setBleStabilityOverrideResolver 가 등록되어 임계값이 바뀐다', async () => {
    const fetcher = makeFetchOk({
      success: true,
      data: {
        rules: [
          {
            match: { deviceModel: 'NoiPod-A1' },
            thresholds: { windowThreshold: 5, msThreshold: 20_000 },
          },
        ],
      },
    });
    await loadBleStabilityRemoteConfig({ fetcher, storage: null });

    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: 5,
      msThreshold: 20_000,
    });
    // 매칭되지 않는 컨텍스트는 기본값을 유지한다.
    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-Z9' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('HTTP 에러는 조용히 무시되어 기본값이 유지된다', async () => {
    const fetcher = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;
    await loadBleStabilityRemoteConfig({ fetcher, storage: null });
    expect(resolveBleStabilityThresholds()).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('네트워크 에러(throw)도 조용히 무시되어 기본값이 유지된다', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await loadBleStabilityRemoteConfig({ fetcher, storage: null });
    expect(resolveBleStabilityThresholds()).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('isStale() 가 true 면 응답을 받았어도 오버라이드를 적용하지 않는다 (Task #70 race 가드)', async () => {
    // 사전: 깨끗한 상태(오버라이드 없음).
    expect(resolveBleStabilityThresholds().windowThreshold).toBe(
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    );
    const fetcher = makeFetchOk({
      success: true,
      data: {
        rules: [
          { match: { userId: 'u-x' }, thresholds: { windowThreshold: 7 } },
        ],
      },
    });
    await loadBleStabilityRemoteConfig({ fetcher, isStale: () => true });
    // 응답 도착 시점에 컨텍스트가 바뀌었다는 신호 → 적용을 건너뛴다.
    expect(resolveBleStabilityThresholds({ userId: 'u-x' }).windowThreshold).toBe(
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    );
  });

  it('이전 부트스트랩의 오버라이드가 남아 있어도 빈 응답이면 깨끗이 비운다', async () => {
    // 이전 부트스트랩이 등록한 것처럼 흉내낸다.
    setBleStabilityOverrideResolver(() => ({ windowThreshold: 99 }));
    expect(resolveBleStabilityThresholds().windowThreshold).toBe(99);

    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });
    await loadBleStabilityRemoteConfig({ fetcher, storage: null });

    // 빈 설정 → 어댑터가 null 을 돌려주고, 어댑터는 setOverrideResolver(null) 을 호출한다.
    expect(resolveBleStabilityThresholds().windowThreshold).toBe(
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    );
  });

  // ───────────────────────────────────────────────────────────
  // Task #69: 오프라인 캐시
  // ───────────────────────────────────────────────────────────

  it('성공 응답은 캐시에 저장되고, 이후 네트워크 실패 시에도 임계값이 그대로 적용된다', async () => {
    const storage = makeMemoryStorage();
    const okFetcher = makeFetchOk({
      success: true,
      data: {
        rules: [
          {
            match: { deviceModel: 'NoiPod-A1' },
            thresholds: { windowThreshold: 5, msThreshold: 20_000 },
          },
        ],
      },
    });

    await loadBleStabilityRemoteConfig({ fetcher: okFetcher, storage });
    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: 5,
      msThreshold: 20_000,
    });

    // 다음 부트스트랩에서 네트워크가 죽어 있다고 가정.
    setBleStabilityOverrideResolver(null);
    const offlineFetcher = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await loadBleStabilityRemoteConfig({ fetcher: offlineFetcher, storage });

    // 캐시에서 복구되어 마지막 임계값이 그대로 적용된다.
    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: 5,
      msThreshold: 20_000,
    });
  });

  it('HTTP 에러일 때도 캐시가 있으면 그것을 적용한다', async () => {
    const storage = makeMemoryStorage();
    const baseTime = 1_700_000_000_000;
    storage.setItem(
      BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY,
      JSON.stringify({
        version: BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION,
        savedAt: baseTime,
        config: {
          rules: [
            {
              match: { userId: 'u-7' },
              thresholds: { windowThreshold: 4, msThreshold: 12_345 },
            },
          ],
        },
      }),
    );

    const httpErrorFetcher = vi.fn(async () =>
      new Response('boom', { status: 503 }),
    ) as unknown as typeof fetch;
    await loadBleStabilityRemoteConfig({
      fetcher: httpErrorFetcher,
      storage,
      // 캐시 직후 시각 — 만료되지 않은 신선한 캐시.
      now: () => baseTime + 60_000,
    });

    expect(resolveBleStabilityThresholds({ userId: 'u-7' })).toEqual({
      windowThreshold: 4,
      msThreshold: 12_345,
    });
  });

  it('캐시도 없고 네트워크도 죽으면 기본값으로 폴백한다', async () => {
    const storage = makeMemoryStorage();
    const offlineFetcher = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await loadBleStabilityRemoteConfig({ fetcher: offlineFetcher, storage });

    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('스키마 버전이 다른 캐시는 폐기되고 기본값이 유지된다', async () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY,
      JSON.stringify({
        version: BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION + 99,
        config: {
          rules: [
            {
              match: { deviceModel: 'NoiPod-A1' },
              thresholds: { windowThreshold: 99, msThreshold: 99_999 },
            },
          ],
        },
      }),
    );
    const offlineFetcher = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await loadBleStabilityRemoteConfig({ fetcher: offlineFetcher, storage });

    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
    // 손상된/구 버전 캐시는 폐기된다.
    expect(storage.getItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY)).toBeNull();
  });

  it('JSON 이 깨진 캐시는 안전하게 폐기되고 기본값이 유지된다', async () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY,
      '{"version": 1, "config": {oops not json',
    );
    const offlineFetcher = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await loadBleStabilityRemoteConfig({ fetcher: offlineFetcher, storage });

    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
    expect(storage.getItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY)).toBeNull();
  });

  it('새 성공 응답은 캐시를 갱신해, 다음 오프라인 실행에서는 새 값이 쓰인다', async () => {
    const storage = makeMemoryStorage();

    // 1) 처음에는 windowThreshold=5 가 캐시된다.
    await loadBleStabilityRemoteConfig({
      fetcher: makeFetchOk({
        success: true,
        data: {
          rules: [
            {
              match: { deviceModel: 'NoiPod-A1' },
              thresholds: { windowThreshold: 5, msThreshold: 20_000 },
            },
          ],
        },
      }),
      storage,
    });

    // 2) 다음 성공 응답이 windowThreshold=8 로 갱신.
    setBleStabilityOverrideResolver(null);
    await loadBleStabilityRemoteConfig({
      fetcher: makeFetchOk({
        success: true,
        data: {
          rules: [
            {
              match: { deviceModel: 'NoiPod-A1' },
              thresholds: { windowThreshold: 8, msThreshold: 30_000 },
            },
          ],
        },
      }),
      storage,
    });

    // 3) 그 뒤 네트워크가 죽으면 가장 최근(8) 이 적용되어야 한다.
    setBleStabilityOverrideResolver(null);
    await loadBleStabilityRemoteConfig({
      fetcher: vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      storage,
    });

    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: 8,
      msThreshold: 30_000,
    });
  });

  // ───────────────────────────────────────────────────────────
  // Task #87: 캐시 자동 만료
  // ───────────────────────────────────────────────────────────

  it('보관 기간 안의 신선한 캐시는 그대로 적용된다 (Task #87)', async () => {
    const storage = makeMemoryStorage();
    const baseTime = 1_700_000_000_000;

    // 1) baseTime 에 캐시를 저장.
    await loadBleStabilityRemoteConfig({
      fetcher: makeFetchOk({
        success: true,
        data: {
          rules: [
            {
              match: { deviceModel: 'NoiPod-A1' },
              thresholds: { windowThreshold: 5, msThreshold: 20_000 },
            },
          ],
        },
      }),
      storage,
      now: () => baseTime,
    });

    // 2) 보관 기간 직전(만료 1ms 전) 에 오프라인 부트스트랩 → 적용된다.
    setBleStabilityOverrideResolver(null);
    await loadBleStabilityRemoteConfig({
      fetcher: vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      storage,
      now: () => baseTime + BLE_STABILITY_REMOTE_CONFIG_CACHE_MAX_AGE_MS - 1,
    });

    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: 5,
      msThreshold: 20_000,
    });
    // 신선한 캐시는 폐기되지 않는다.
    expect(storage.getItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY)).not.toBeNull();
  });

  it('보관 기간을 넘긴 캐시는 무시되고 폐기되어 기본값으로 폴백한다 (Task #87)', async () => {
    const storage = makeMemoryStorage();
    const baseTime = 1_700_000_000_000;

    // 1) baseTime 에 캐시를 저장.
    await loadBleStabilityRemoteConfig({
      fetcher: makeFetchOk({
        success: true,
        data: {
          rules: [
            {
              match: { deviceModel: 'NoiPod-A1' },
              thresholds: { windowThreshold: 5, msThreshold: 20_000 },
            },
          ],
        },
      }),
      storage,
      now: () => baseTime,
    });
    expect(storage.getItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY)).not.toBeNull();

    // 2) 보관 기간을 1ms 넘긴 시점에 오프라인 부트스트랩 → 만료된 캐시는 무시.
    setBleStabilityOverrideResolver(null);
    await loadBleStabilityRemoteConfig({
      fetcher: vi.fn(async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      storage,
      now: () => baseTime + BLE_STABILITY_REMOTE_CONFIG_CACHE_MAX_AGE_MS + 1,
    });

    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
    // 만료된 캐시는 다음 실행을 위해 즉시 폐기된다 — 다시 읽기 시도가 일어나도
    // 같은 만료 분기를 또 통과시키지 않게 한다.
    expect(storage.getItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY)).toBeNull();
  });

  it('savedAt 이 누락된 과거 형식의 캐시는 만료된 것으로 간주되어 폐기된다 (Task #87)', async () => {
    const storage = makeMemoryStorage();
    storage.setItem(
      BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY,
      JSON.stringify({
        version: BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION,
        // savedAt 가 없음 — Task #87 이전에 저장된 envelope 모양.
        config: {
          rules: [
            {
              match: { deviceModel: 'NoiPod-A1' },
              thresholds: { windowThreshold: 9, msThreshold: 99_999 },
            },
          ],
        },
      }),
    );
    const offlineFetcher = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await loadBleStabilityRemoteConfig({ fetcher: offlineFetcher, storage });

    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
    expect(storage.getItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY)).toBeNull();
  });

  it('savedAt 이 미래 시각인 캐시는 안전을 위해 폐기된다 (Task #87)', async () => {
    // 디바이스 시계가 어긋난 채 저장되었다가 이후 정정된 경우 — 영원히 만료되지
    // 않는 envelope 이 살아남는 것을 막는다.
    const storage = makeMemoryStorage();
    const now = 1_700_000_000_000;
    storage.setItem(
      BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY,
      JSON.stringify({
        version: BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION,
        savedAt: now + 60 * 60 * 1000, // 1시간 미래
        config: {
          rules: [
            {
              match: { deviceModel: 'NoiPod-A1' },
              thresholds: { windowThreshold: 9, msThreshold: 99_999 },
            },
          ],
        },
      }),
    );
    const offlineFetcher = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    await loadBleStabilityRemoteConfig({
      fetcher: offlineFetcher,
      storage,
      now: () => now,
    });

    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
    expect(storage.getItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────
// Task #86: 장기 세션 자동 갱신 (throttle / 포그라운드 복귀 / 주기 타이머)
// ───────────────────────────────────────────────────────────

describe('refreshBleStabilityRemoteConfigIfStale (Task #86 throttle)', () => {
  beforeEach(() => {
    __resetBleStabilityRefreshThrottleForTests();
  });
  afterEach(() => {
    setBleStabilityOverrideResolver(null);
    __resetBleStabilityRefreshThrottleForTests();
  });

  it('첫 호출은 throttle 을 통과해 실제로 fetch 한다', async () => {
    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });
    let clock = 1_000_000;
    const ran = await refreshBleStabilityRemoteConfigIfStale({
      fetcher,
      storage: null,
      now: () => clock,
    });
    expect(ran).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('throttle 간격 안에서 여러 번 호출돼도 fetch 는 한 번으로 합쳐진다', async () => {
    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });
    let clock = 1_000_000;
    const opts = {
      fetcher,
      storage: null as Storage | null,
      now: () => clock,
      minIntervalMs: 60_000,
    };

    expect(await refreshBleStabilityRemoteConfigIfStale(opts)).toBe(true);
    clock += 1_000;
    expect(await refreshBleStabilityRemoteConfigIfStale(opts)).toBe(false);
    clock += 30_000;
    expect(await refreshBleStabilityRemoteConfigIfStale(opts)).toBe(false);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('throttle 간격이 지난 뒤에는 다시 fetch 한다', async () => {
    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });
    let clock = 1_000_000;
    const opts = {
      fetcher,
      storage: null as Storage | null,
      now: () => clock,
      minIntervalMs: 60_000,
    };

    expect(await refreshBleStabilityRemoteConfigIfStale(opts)).toBe(true);
    clock += 60_001;
    expect(await refreshBleStabilityRemoteConfigIfStale(opts)).toBe(true);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('직접 호출(loadBleStabilityRemoteConfig) 도 throttle 시계를 갱신한다', async () => {
    // 시나리오: 로그인 직후 useAuth 가 직접 호출 → 직후의 포그라운드 복귀가 또
    // 한 번 fetch 하면 안 된다.
    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });
    let clock = 5_000_000;
    await loadBleStabilityRemoteConfig({
      fetcher,
      storage: null,
      now: () => clock,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock += 5_000;
    const ran = await refreshBleStabilityRemoteConfigIfStale({
      fetcher,
      storage: null,
      now: () => clock,
      minIntervalMs: 60_000,
    });
    expect(ran).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('기본 throttle 간격은 30분으로 노출된다', () => {
    expect(DEFAULT_BLE_STABILITY_REFRESH_INTERVAL_MS).toBe(30 * 60 * 1000);
  });
});

describe('setupBleStabilityRemoteConfigAutoRefresh (Task #86)', () => {
  type Listener = (...args: unknown[]) => void;

  function makeFakeTarget() {
    const listeners = new Map<string, Set<Listener>>();
    return {
      target: {
        addEventListener: vi.fn((type: string, fn: Listener) => {
          if (!listeners.has(type)) listeners.set(type, new Set());
          listeners.get(type)!.add(fn);
        }),
        removeEventListener: vi.fn((type: string, fn: Listener) => {
          listeners.get(type)?.delete(fn);
        }),
      },
      dispatch(type: string) {
        for (const fn of listeners.get(type) ?? []) fn();
      },
      hasListener(type: string) {
        return (listeners.get(type)?.size ?? 0) > 0;
      },
    };
  }

  beforeEach(() => {
    __resetBleStabilityRefreshThrottleForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    setBleStabilityOverrideResolver(null);
    __resetBleStabilityRefreshThrottleForTests();
  });

  it('포그라운드 복귀(focus / visibilitychange) 때 한 번 더 받는다', async () => {
    const win = makeFakeTarget();
    const docListeners = makeFakeTarget();
    const doc = {
      ...docListeners.target,
      visibilityState: 'visible' as DocumentVisibilityState,
    };
    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });
    let clock = 10_000_000;

    const cleanup = setupBleStabilityRemoteConfigAutoRefresh({
      fetcher,
      storage: null,
      windowTarget: win.target,
      documentTarget: doc,
      now: () => clock,
      minIntervalMs: 60_000,
      intervalMs: 0, // 타이머는 이 테스트의 관심 밖.
    });

    // focus 이벤트 → 첫 fetch.
    win.dispatch('focus');
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 같은 throttle 창 안의 visibilitychange → 합쳐진다.
    clock += 30_000;
    docListeners.dispatch('visibilitychange');
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(1);

    // throttle 창을 넘기면 다시 받는다.
    clock += 31_000;
    docListeners.dispatch('visibilitychange');
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(2);

    cleanup();
    expect(win.hasListener('focus')).toBe(false);
    expect(docListeners.hasListener('visibilitychange')).toBe(false);
  });

  it('숨김 상태에서 visibilitychange 가 와도 fetch 하지 않는다', async () => {
    const docListeners = makeFakeTarget();
    const doc = {
      ...docListeners.target,
      visibilityState: 'hidden' as DocumentVisibilityState,
    };
    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });

    const cleanup = setupBleStabilityRemoteConfigAutoRefresh({
      fetcher,
      storage: null,
      windowTarget: null,
      documentTarget: doc,
      minIntervalMs: 60_000,
      intervalMs: 0,
    });

    docListeners.dispatch('visibilitychange');
    await vi.runAllTimersAsync();
    expect(fetcher).not.toHaveBeenCalled();

    cleanup();
  });

  it('주기 타이머도 throttle 안에서 합쳐지고, 창을 넘기면 다시 트리거한다', async () => {
    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });
    let clock = 0;

    const cleanup = setupBleStabilityRemoteConfigAutoRefresh({
      fetcher,
      storage: null,
      windowTarget: null,
      documentTarget: null,
      now: () => clock,
      minIntervalMs: 60_000,
      intervalMs: 10_000, // throttle 보다 짧은 주기로 폭주를 시뮬레이션.
    });

    // 60초 안에 6번 트리거되지만 throttle 로 1번만 fetch.
    for (let i = 0; i < 6; i++) {
      clock += 10_000;
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);

    // throttle 창을 넘기는 다음 tick.
    clock += 10_000;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetcher).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('cleanup 후에는 listener 와 타이머가 모두 해제된다', async () => {
    const win = makeFakeTarget();
    const docListeners = makeFakeTarget();
    const doc = {
      ...docListeners.target,
      visibilityState: 'visible' as DocumentVisibilityState,
    };
    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });

    const cleanup = setupBleStabilityRemoteConfigAutoRefresh({
      fetcher,
      storage: null,
      windowTarget: win.target,
      documentTarget: doc,
      minIntervalMs: 60_000,
      intervalMs: 30_000,
    });
    cleanup();

    // throttle 시계는 비워 두고, 이벤트/타이머가 살아 있다면 fetch 가 일어났을 것.
    __resetBleStabilityRefreshThrottleForTests();
    win.dispatch('focus');
    docListeners.dispatch('visibilitychange');
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetcher).not.toHaveBeenCalled();
  });
});
