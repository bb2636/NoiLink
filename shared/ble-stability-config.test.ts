import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BLE_STABILITY_MS_THRESHOLD,
  DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
  makeBleStabilityResolverFromRemoteConfig,
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

describe('makeBleStabilityResolverFromRemoteConfig (Task #48)', () => {
  afterEach(() => {
    setBleStabilityOverrideResolver(null);
  });

  it('비어 있거나 null/undefined 인 원격 응답은 null 을 반환해 기본값이 유지된다', () => {
    expect(makeBleStabilityResolverFromRemoteConfig(null)).toBeNull();
    expect(makeBleStabilityResolverFromRemoteConfig(undefined)).toBeNull();
    expect(makeBleStabilityResolverFromRemoteConfig({})).toBeNull();
    expect(makeBleStabilityResolverFromRemoteConfig({ rules: [] })).toBeNull();

    // 회귀 보장: null 을 그대로 setBleStabilityOverrideResolver 에 등록해도
    // resolveBleStabilityThresholds() 가 기본값을 돌려줘야 한다.
    setBleStabilityOverrideResolver(makeBleStabilityResolverFromRemoteConfig(null));
    expect(resolveBleStabilityThresholds({ userId: 'u-1', deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('잘못된 모양(임계 누락/타입 오류) 만 들어 있으면 null 을 반환한다', () => {
    expect(
      makeBleStabilityResolverFromRemoteConfig({
        rules: [
          { thresholds: {} as never },
          { thresholds: { windowThreshold: 'big' as unknown as number } } as never,
          null as unknown as never,
          undefined as unknown as never,
        ],
      }),
    ).toBeNull();
  });

  it('default 만 있어도 catch-all 오버라이드로 동작한다', () => {
    const resolver = makeBleStabilityResolverFromRemoteConfig({
      default: { msThreshold: 30_000 },
    });
    setBleStabilityOverrideResolver(resolver);
    expect(resolveBleStabilityThresholds({ userId: 'u-x' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: 30_000,
    });
  });

  it('규칙은 위에서부터 첫 매칭이 채택되고, deviceModel/userId 모두 일치해야 한다', () => {
    const resolver = makeBleStabilityResolverFromRemoteConfig({
      rules: [
        {
          match: { userId: 'u-power', deviceModel: 'NoiPod-A1' },
          thresholds: { windowThreshold: 10, msThreshold: 60_000 },
        },
        {
          match: { deviceModel: 'NoiPod-A1' },
          thresholds: { msThreshold: 25_000 },
        },
      ],
      default: { windowThreshold: 4 },
    });
    setBleStabilityOverrideResolver(resolver);

    // 두 필드 모두 일치 → 첫 규칙이 이긴다.
    expect(
      resolveBleStabilityThresholds({ userId: 'u-power', deviceModel: 'NoiPod-A1' }),
    ).toEqual({ windowThreshold: 10, msThreshold: 60_000 });

    // userId 가 다르면 첫 규칙은 건너뛰고 두 번째 규칙(model 만 매칭)이 적용된다.
    // 두 번째 규칙은 windowThreshold 를 안 주므로 default 가 아닌 시스템 기본값이
    // 사용된다(매칭된 규칙의 thresholds 가 우선이며, default 는 무매칭일 때만 쓰임).
    expect(
      resolveBleStabilityThresholds({ userId: 'u-other', deviceModel: 'NoiPod-A1' }),
    ).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: 25_000,
    });

    // 어떤 규칙도 매칭되지 않으면 default 가 적용된다.
    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-Z9' })).toEqual({
      windowThreshold: 4,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });

  it('match 가 비어 있는 규칙은 catch-all 로 동작해 default 보다 우선한다', () => {
    const resolver = makeBleStabilityResolverFromRemoteConfig({
      rules: [
        { match: {}, thresholds: { windowThreshold: 7 } },
      ],
      default: { windowThreshold: 99 },
    });
    setBleStabilityOverrideResolver(resolver);
    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-Z9' }).windowThreshold).toBe(7);
  });

  it('잘못된 임계값(NaN/음수/0)은 resolveBleStabilityThresholds 단계에서 기본값으로 보정된다', () => {
    const resolver = makeBleStabilityResolverFromRemoteConfig({
      rules: [
        {
          match: { deviceModel: 'NoiPod-A1' },
          thresholds: { windowThreshold: -1, msThreshold: Number.NaN },
        },
      ],
    });
    setBleStabilityOverrideResolver(resolver);
    expect(resolveBleStabilityThresholds({ deviceModel: 'NoiPod-A1' })).toEqual({
      windowThreshold: DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
      msThreshold: DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    });
  });
});
