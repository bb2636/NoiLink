import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BLE_STABILITY_MS_THRESHOLD,
  DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
  resolveBleStabilityThresholds,
  setBleStabilityOverrideResolver,
} from './ble-stability-config.js';

describe('resolveBleStabilityThresholds', () => {
  afterEach(() => {
    setBleStabilityOverrideResolver(null);
  });

  it('오버라이드 훅이 없으면 기본값을 반환한다', () => {
    expect(resolveBleStabilityThresholds()).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('오버라이드가 부분만 돌려주면 나머지는 기본값으로 보강한다', () => {
    setBleStabilityOverrideResolver(() => ({ windowThreshold: 7 }));
    expect(resolveBleStabilityThresholds()).toEqual({
      windowThreshold: 7,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('컨텍스트(userId / deviceModel) 별로 다른 값을 돌려줄 수 있다', () => {
    setBleStabilityOverrideResolver(({ userId, deviceModel }) => {
      if (userId === 'u-power') return { windowThreshold: 10, msThreshold: 60_000 };
      if (deviceModel === 'NoiPod-A1') return { msThreshold: 25_000 };
      return null;
    });

    expect(resolveBleStabilityThresholds({ userId: 'u-power' })).toEqual({
      windowThreshold: 10,
      msThreshold: 60_000,
    });
    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: 25_000,
    });
    expect(resolveBleStabilityThresholds({ userId: 'u-other' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('잘못된 오버라이드 값(NaN/음수/0)은 무시하고 기본값을 사용한다', () => {
    setBleStabilityOverrideResolver(() => ({
      windowThreshold: -1,
      msThreshold: Number.NaN,
    }));
    expect(resolveBleStabilityThresholds()).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('null 을 넘기면 오버라이드가 해제된다', () => {
    setBleStabilityOverrideResolver(() => ({ windowThreshold: 99 }));
    expect(resolveBleStabilityThresholds().windowThreshold).toBe(99);
    setBleStabilityOverrideResolver(null);
    expect(resolveBleStabilityThresholds().windowThreshold).toBe(
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    );
  });
});
