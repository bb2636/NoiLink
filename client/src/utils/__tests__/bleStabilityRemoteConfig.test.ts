/**
 * 부트스트랩 어댑터 회귀 테스트 (Task #48 / 캐시 보강 Task #69)
 *
 * 보호 정책:
 *  1. 응답이 비어 있거나(`{ rules: [] }`) 누락이면 오버라이드가 등록되지 않아
 *     `resolveBleStabilityThresholds()` 가 시스템 기본값을 그대로 돌려준다.
 *     → 원격 설정이 죽어도 클라이언트 동작이 변하지 않는다는 회귀 보장.
 *  2. 네트워크/HTTP/JSON 에러 시에도 같은 보장 — 콘솔 경고만 남기고 진행한다.
 *  3. 정상 응답이 오면 규칙대로 임계값이 바뀐다.
 *  4. 성공 응답은 캐시되어, 다음 실행에서 네트워크가 죽어 있어도 마지막 임계값이 적용된다.
 *  5. 캐시가 손상되었거나 스키마 버전이 다르면 안전하게 폐기한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION,
  DEFAULT_BLE_STABILITY_MS_THRESHOLD,
  DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
  resolveBleStabilityThresholds,
  setBleStabilityOverrideResolver,
} from '@noilink/shared';
import {
  BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY,
  loadBleStabilityRemoteConfig,
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
  });
  afterEach(() => {
    setBleStabilityOverrideResolver(null);
    warnSpy.mockRestore();
    try {
      globalThis.localStorage?.removeItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY);
    } catch {
      /* ignore */
    }
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
    storage.setItem(
      BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY,
      JSON.stringify({
        version: BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION,
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
    await loadBleStabilityRemoteConfig({ fetcher: httpErrorFetcher, storage });

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
});
