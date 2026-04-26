/**
 * 부트스트랩 어댑터 회귀 테스트 (Task #48)
 *
 * 보호 정책:
 *  1. 응답이 비어 있거나(`{ rules: [] }`) 누락이면 오버라이드가 등록되지 않아
 *     `resolveBleStabilityThresholds()` 가 시스템 기본값을 그대로 돌려준다.
 *     → 원격 설정이 죽어도 클라이언트 동작이 변하지 않는다는 회귀 보장.
 *  2. 네트워크/HTTP/JSON 에러 시에도 같은 보장 — 콘솔 경고만 남기고 진행한다.
 *  3. 정상 응답이 오면 규칙대로 임계값이 바뀐다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BLE_STABILITY_MS_THRESHOLD,
  DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
  resolveBleStabilityThresholds,
  setBleStabilityOverrideResolver,
} from '@noilink/shared';
import { loadBleStabilityRemoteConfig } from '../bleStabilityRemoteConfig';

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('loadBleStabilityRemoteConfig', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    setBleStabilityOverrideResolver(null);
    warnSpy.mockRestore();
  });

  it('빈 응답이면 오버라이드를 등록하지 않아 기본 임계값이 그대로 쓰인다', async () => {
    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });
    await loadBleStabilityRemoteConfig({ fetcher });
    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('data 가 누락된 응답도 안전하게 무시되어 기본값이 유지된다', async () => {
    const fetcher = makeFetchOk({ success: true });
    await loadBleStabilityRemoteConfig({ fetcher });
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
    await loadBleStabilityRemoteConfig({ fetcher });

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
    await loadBleStabilityRemoteConfig({ fetcher });
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
    await loadBleStabilityRemoteConfig({ fetcher });
    expect(resolveBleStabilityThresholds()).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('이전 부트스트랩의 오버라이드가 남아 있어도 빈 응답이면 깨끗이 비운다', async () => {
    // 이전 부트스트랩이 등록한 것처럼 흉내낸다.
    setBleStabilityOverrideResolver(() => ({ windowThreshold: 99 }));
    expect(resolveBleStabilityThresholds().windowThreshold).toBe(99);

    const fetcher = makeFetchOk({ success: true, data: { rules: [] } });
    await loadBleStabilityRemoteConfig({ fetcher });

    // 빈 설정 → 어댑터가 null 을 돌려주고, 어댑터는 setOverrideResolver(null) 을 호출한다.
    expect(resolveBleStabilityThresholds().windowThreshold).toBe(
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    );
  });
});
