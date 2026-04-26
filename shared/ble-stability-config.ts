/**
 * BLE 단절 빈도 안내 토스트 임계값 — 디바이스/환경에 맞게 조정 가능 (Task #38, Task #44).
 *
 * 정책 배경:
 *  - Task #38 에서 도입한 안내 토스트는 한 세션의 회복 누적 횟수/시간이 임계를
 *    넘었을 때 한 번만 노출된다.
 *  - 임계 적정값은 디바이스 모델·펌웨어·운영 환경에 따라 다를 수 있어
 *    하드코딩 대신 단일 소스로 모은다.
 *  - 원격 설정 / 사용자 단위 A/B 테스트와 연결할 수 있도록 최소한의
 *    오버라이드 훅을 제공한다.
 *
 * 사용:
 *  ```ts
 *  // 호출부에서: 사용자/디바이스 컨텍스트로 임계값 조회
 *  const { windowThreshold, msThreshold } = resolveBleStabilityThresholds({ userId });
 *
 *  // 앱 부트스트랩에서(원격 설정 적용 후): 오버라이드 등록
 *  setBleStabilityOverrideResolver(({ deviceModel }) =>
 *    deviceModel === 'NoiPod-A1' ? { windowThreshold: 5, msThreshold: 20_000 } : null,
 *  );
 *  ```
 */

/** 한 세션 내 회복 구간이 이 횟수에 도달하면 안내 토스트를 1회 노출한다. */
export const DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD = 3;

/** 한 세션 내 회복 누적 시간이 이 ms 에 도달하면 안내 토스트를 1회 노출한다. */
export const DEFAULT_BLE_STABILITY_MS_THRESHOLD = 15_000;

export interface BleStabilityThresholds {
  /** 누적 회복 구간 횟수 임계 (≥ 일 때 안내). */
  windowThreshold: number;
  /** 누적 회복 시간(ms) 임계 (≥ 일 때 안내). */
  msThreshold: number;
}

/**
 * 오버라이드 판정에 쓰이는 컨텍스트.
 * 원격 설정/feature flag 와 연결할 때 필요한 최소 키만 노출한다.
 * 새로운 차원(앱 버전, 지역 등)이 필요해지면 선택 필드를 추가하면 된다.
 */
export interface BleStabilityResolverContext {
  /** 로그인한 사용자 식별자 (없으면 익명·게스트). */
  userId?: string | null;
  /** BLE 디바이스 모델명/펌웨어 식별자. */
  deviceModel?: string | null;
}

/**
 * 부분 오버라이드 — 일부 임계만 조정하고 나머지는 기본값을 유지하고 싶을 때.
 * `null`/`undefined` 를 돌려주면 기본값이 그대로 쓰인다.
 */
export type BleStabilityOverride = Partial<BleStabilityThresholds>;

export type BleStabilityOverrideResolver = (
  ctx: BleStabilityResolverContext,
) => BleStabilityOverride | null | undefined;

let overrideResolver: BleStabilityOverrideResolver | null = null;

/**
 * 오버라이드 훅 등록. `null` 을 넘기면 등록을 해제한다.
 * 앱 부트스트랩이나 원격 설정 적용 시점에서 한 번만 호출하는 것을 권장한다.
 */
export function setBleStabilityOverrideResolver(
  resolver: BleStabilityOverrideResolver | null,
): void {
  overrideResolver = resolver;
}

/** 등록된 오버라이드 훅을 반환한다 — 테스트/디버깅 보조. */
export function getBleStabilityOverrideResolver(): BleStabilityOverrideResolver | null {
  return overrideResolver;
}

/**
 * 컨텍스트에 맞는 임계값을 반환한다.
 * 오버라이드 훅이 없거나 일부 필드만 돌려주면 기본값으로 보강한다.
 * 잘못된 모양(NaN/음수)은 안전을 위해 무시하고 기본값을 사용한다.
 */
export function resolveBleStabilityThresholds(
  ctx: BleStabilityResolverContext = {},
): BleStabilityThresholds {
  const override = overrideResolver?.(ctx) ?? null;
  return {
    windowThreshold: pickPositive(
      override?.windowThreshold,
      DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
    ),
    msThreshold: pickPositive(
      override?.msThreshold,
      DEFAULT_BLE_STABILITY_MS_THRESHOLD,
    ),
  };
}

function pickPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}
