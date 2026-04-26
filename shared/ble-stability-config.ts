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

// ───────────────────────────────────────────────────────────
// 원격 설정 ↔ 오버라이드 훅 어댑터 (Task #48)
// ───────────────────────────────────────────────────────────
//
// `setBleStabilityOverrideResolver` 는 코드 안에서만 호출 가능한 훅이라
// 임계값을 바꾸려면 앱 재배포가 필요하다. 운영 중 모델/사용자별 A/B 테스트나
// 핫픽스를 위해, 서버 응답이나 feature flag 백엔드(예: Firebase Remote Config)
// 에서 읽어들인 원격 설정 → 오버라이드 훅으로 변환하는 순수 함수를 제공한다.
//
// 변환 규칙:
//   - 입력이 비어 있거나(`null`/`undefined`/빈 객체) 모양이 잘못되면 `null` 을
//     반환해 기본값이 그대로 쓰이도록 한다.
//   - `rules[]` 는 위에서부터 순서대로 평가하고, `match` 의 모든 필드가
//     컨텍스트와 일치하는 첫 규칙의 `thresholds` 가 채택된다.
//     `match` 가 비어 있거나 생략되면 항상 매칭된다(꼬리 fallback 으로 활용 가능).
//   - 매칭되는 규칙이 없으면 `default` 가 쓰인다.
//   - 잘못된 임계값(NaN/음수/0)은 `resolveBleStabilityThresholds` 단계에서
//     기본값으로 보정되므로 여기서는 형식만 검증한다.
//

/**
 * 한 개의 원격 규칙. `match` 의 모든 필드가 컨텍스트와 같으면 적용된다.
 * `match` 를 생략/비우면 catch-all (꼬리 fallback) 로 동작한다.
 */
export interface BleStabilityRemoteRule {
  match?: {
    deviceModel?: string | null;
    userId?: string | null;
  };
  thresholds: BleStabilityOverride;
}

/**
 * 원격 설정의 직렬화 가능한 모양.
 * Firebase Remote Config / 서버 응답 / 환경 변수 JSON 등 어디서 와도 무방하다.
 */
export interface BleStabilityRemoteConfig {
  /** 우선순위 순서대로 평가되는 규칙 목록. */
  rules?: BleStabilityRemoteRule[];
  /** 어떤 규칙도 매칭되지 않을 때 쓰이는 전역 오버라이드. */
  default?: BleStabilityOverride;
}

/**
 * 원격 설정 캐시(localStorage 등) 의 스키마 버전 (Task #69).
 *
 * `BleStabilityRemoteConfig` 의 모양이 바뀌면 이 상수를 올려서 이전 버전으로
 * 저장된 캐시를 자동으로 무효화한다. 클라이언트 부트스트랩은 캐시 envelope 의
 * `version` 이 이 값과 다르면 캐시를 폐기하고 기본값 폴백으로 돌아간다.
 */
export const BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION = 1;

/**
 * 원격 설정을 오버라이드 훅으로 변환한다.
 *
 * 비어 있거나 모양이 잘못되어 적용할 규칙이 하나도 없으면 `null` 을 반환한다.
 * 호출부는 반환값을 그대로 `setBleStabilityOverrideResolver` 에 넘기면 된다 —
 * `null` 을 넘기면 등록이 해제되어 기본값이 쓰인다.
 */
export function makeBleStabilityResolverFromRemoteConfig(
  config: BleStabilityRemoteConfig | null | undefined,
): BleStabilityOverrideResolver | null {
  if (!config || typeof config !== 'object') return null;

  const rawRules = Array.isArray(config.rules) ? config.rules : [];
  const rules: BleStabilityRemoteRule[] = [];
  for (const rule of rawRules) {
    if (!rule || typeof rule !== 'object') continue;
    const thresholds = sanitizeOverride(rule.thresholds);
    if (!thresholds) continue;
    const match = sanitizeMatch(rule.match);
    rules.push({ match, thresholds });
  }

  const fallback = sanitizeOverride(config.default);

  if (rules.length === 0 && !fallback) return null;

  return (ctx) => {
    for (const rule of rules) {
      if (matchesRule(rule.match, ctx)) {
        return rule.thresholds;
      }
    }
    return fallback ?? null;
  };
}

function sanitizeOverride(
  raw: BleStabilityOverride | null | undefined,
): BleStabilityOverride | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: BleStabilityOverride = {};
  if (typeof raw.windowThreshold === 'number') {
    out.windowThreshold = raw.windowThreshold;
  }
  if (typeof raw.msThreshold === 'number') {
    out.msThreshold = raw.msThreshold;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sanitizeMatch(
  raw: BleStabilityRemoteRule['match'] | undefined,
): BleStabilityRemoteRule['match'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const match: { deviceModel?: string; userId?: string } = {};
  if (typeof raw.deviceModel === 'string' && raw.deviceModel.length > 0) {
    match.deviceModel = raw.deviceModel;
  }
  if (typeof raw.userId === 'string' && raw.userId.length > 0) {
    match.userId = raw.userId;
  }
  return Object.keys(match).length > 0 ? match : undefined;
}

function matchesRule(
  match: BleStabilityRemoteRule['match'] | undefined,
  ctx: BleStabilityResolverContext,
): boolean {
  if (!match) return true; // catch-all
  if (match.deviceModel != null && match.deviceModel !== ctx.deviceModel) {
    return false;
  }
  if (match.userId != null && match.userId !== ctx.userId) {
    return false;
  }
  return true;
}
