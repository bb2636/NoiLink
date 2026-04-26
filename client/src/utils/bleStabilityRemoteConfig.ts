/**
 * BLE 단절 안내 임계값 원격 설정 부트스트랩 (Task #48 / 캐시 보강 Task #69 /
 * 사용자 컨텍스트 재조회 Task #70 / 장기 세션 자동 갱신 Task #86)
 *
 * 앱 시작 시 `GET /api/config/ble-stability` 를 호출해 받은 응답을
 * `makeBleStabilityResolverFromRemoteConfig()` 로 변환한 뒤
 * `setBleStabilityOverrideResolver()` 로 등록한다.
 *
 * 안전성 보장 (정책):
 *  - 네트워크 실패/HTTP 에러/JSON 파싱 실패 → 콘솔에 경고만 남기고 등록을 건너뛴다.
 *  - 응답이 비어 있거나(`{ rules: [] }`) 모양이 잘못되면 어댑터가 `null` 을
 *    돌려주므로 그대로 `setBleStabilityOverrideResolver(null)` 가 호출되어
 *    기본값(`DEFAULT_BLE_STABILITY_*`) 이 유지된다.
 *  - 즉, 서버가 죽어 있어도 클라이언트 동작에 영향이 없다.
 *
 * 오프라인 캐시 (Task #69):
 *  - 성공 응답은 `localStorage` 에 envelope `{ version, config }` 로 저장된다.
 *  - 다음 실행에서 네트워크가 죽어 있으면(예: 지하철·기내) 캐시를 읽어 마지막으로
 *    검증된 설정을 그대로 적용한다 — 운영자가 푸시한 모델별 튜닝이 끊기지 않는다.
 *  - envelope 의 `version` 이 `BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION` 과
 *    다르거나 JSON 이 깨져 있으면 캐시를 안전하게 폐기한다.
 *
 * 장기 세션 자동 갱신 (Task #86):
 *  - 한 번 로그인한 뒤 앱을 며칠씩 띄워 두는 사용자도 운영자가 푸시한 새 임계값을
 *    "다음 로그인" 까지 기다리지 않고 받을 수 있도록, 포그라운드 복귀
 *    (`visibilitychange`/`focus`) 와 일정 주기마다 한 번 더 호출한다.
 *  - 같은 트리거가 폭주하지 않도록 `lastRefreshAt` 으로 throttle 한다 — 직전
 *    호출(부트스트랩, 로그인 시 재호출 모두 포함) 로부터 `minIntervalMs` 안쪽이면
 *    실제 fetch 를 건너뛴다.
 */
import {
  BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION,
  makeBleStabilityResolverFromRemoteConfig,
  setBleStabilityOverrideResolver,
  type BleStabilityRemoteConfig,
} from '@noilink/shared';

const ENDPOINT = '/api/config/ble-stability';

/**
 * 캐시 envelope 가 저장되는 localStorage 키.
 * 키 자체는 안정적으로 두고, 스키마 버전은 envelope 안의 `version` 필드로 검증한다.
 * (키에 버전 suffix 를 붙이면 옛 키가 영원히 남아 quota 를 잡아먹을 수 있다.)
 */
export const BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY =
  'noilink.bleStability.remoteConfig';

/**
 * 자동 갱신 throttle 및 주기의 기본값(30분).
 * - 운영 중 임계값 변경이 사용자에게 도달하기까지의 P95 지연이 30분 이내가 되도록
 *   잡았다. 더 짧으면 불필요한 트래픽이, 더 길면 운영자가 임계값을 바꿔도 기존
 *   세션이 옛 값을 계속 쓰는 시간이 길어진다.
 */
export const DEFAULT_BLE_STABILITY_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

interface RemoteConfigEnvelope {
  success?: boolean;
  data?: BleStabilityRemoteConfig | null;
}

interface CachedConfigEnvelope {
  version: number;
  config: BleStabilityRemoteConfig | null;
}

export interface LoadBleStabilityRemoteConfigOptions {
  fetcher?: typeof fetch;
  endpoint?: string;
  /**
   * 캐시 저장소. 명시적으로 `null` 을 넘기면 캐시를 사용하지 않는다.
   * 기본값은 환경의 `globalThis.localStorage` (없으면 캐시 비활성).
   */
  storage?: Storage | null;
  /**
   * 응답이 도착했을 때 호출되어 `true` 를 돌려주면 오버라이드 적용을 건너뛴다 (Task #70).
   * 예: 로그인 직후 트리거된 호출이 늦게 도착했는데 그 사이 사용자가 로그아웃했다면,
   * 직전 사용자 오버라이드가 익명 컨텍스트에 잘못 덮어써지는 것을 막는다.
   * 캐시 fallback (네트워크 실패 분기) 에는 영향을 주지 않는다 — 캐시 적용은
   * `applyCacheIfAny` 가 안전하게 해석한다.
   */
  isStale?: () => boolean;
  /**
   * throttle 시각 측정용 시계 주입 (테스트 전용). 실서비스에서는 `Date.now` 가 쓰인다.
   * `loadBleStabilityRemoteConfig` 는 호출 시점에 throttle 시계를 갱신해, 직접 호출
   * (예: 로그인 직후 재호출) 직후의 포그라운드 복귀가 즉시 또 한 번 fetch 하지
   * 않게 한다.
   */
  now?: () => number;
}

/**
 * 마지막으로 실제 fetch 가 시작된 시각(ms). throttle 비교의 기준점.
 * `loadBleStabilityRemoteConfig` 직접 호출 / `refreshBleStabilityRemoteConfigIfStale`
 * 모두 갱신해, 어느 경로로 트리거됐든 폭주가 합쳐진다.
 */
let lastRefreshAt = 0;

/**
 * 원격 설정을 한 번 받아 오버라이드를 등록한다.
 * - 성공 시: 응답을 캐시에 저장하고 오버라이드를 등록한다.
 * - 실패 시: 캐시가 있으면 그것으로 오버라이드를 등록하고, 없으면 조용히 기본값을 유지한다.
 * - `isStale` 가드 (Task #70): 응답 도착 시점에 컨텍스트가 바뀌었으면 적용을 건너뛴다.
 * - throttle 시계 갱신 (Task #86): 직접 호출도 throttle 기준점이 된다 — 로그인 직후
 *   포그라운드 복귀가 즉시 또 한 번 fetch 하는 것을 막는다.
 */
export async function loadBleStabilityRemoteConfig(
  options: LoadBleStabilityRemoteConfigOptions = {},
): Promise<void> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const endpoint = options.endpoint ?? ENDPOINT;
  const storage =
    options.storage === undefined ? getDefaultStorage() : options.storage;
  const now = options.now ?? Date.now;

  // throttle 기준점은 fetch 시도 시각으로 잡는다 — 응답이 늦게 와도 그 사이에
  // 다른 트리거가 또 한 번 fetch 하지 않도록.
  lastRefreshAt = now();

  if (typeof fetcher !== 'function') {
    // fetch 가 없는 환경(SSR/노드 일부)이라도 캐시는 적용해 준다.
    applyCacheIfAny(storage);
    return;
  }

  let payload: RemoteConfigEnvelope | null = null;
  try {
    const res = await fetcher(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[ble-stability] remote config fetch failed: HTTP ${res.status}`);
      applyCacheIfAny(storage);
      return;
    }
    payload = (await res.json()) as RemoteConfigEnvelope;
  } catch (err) {
    console.warn(
      '[ble-stability] remote config fetch threw:',
      err instanceof Error ? err.message : err,
    );
    applyCacheIfAny(storage);
    return;
  }

  // 응답 도착 후 컨텍스트가 바뀌었으면 적용을 건너뛴다 — 직전 epoch 의
  // 결과로 새 epoch 의 오버라이드가 덮이는 race 를 방지.
  if (options.isStale?.()) return;

  const config = payload?.data ?? null;
  // 성공 응답은 비어 있더라도 캐시에 반영한다 — 운영자가 의도적으로 규칙을
  // 비웠다면, 다음 오프라인 실행에서도 그 의도가 유지되어야 한다.
  writeCachedConfig(storage, config);

  const resolver = makeBleStabilityResolverFromRemoteConfig(config);
  // resolver 가 null 이어도 명시적으로 호출해 이전 부트스트랩에서 남은 오버라이드를
  // 깨끗이 비운다(핫 리로드/테스트 환경에서의 누수 방지).
  setBleStabilityOverrideResolver(resolver);
}

export interface RefreshBleStabilityRemoteConfigOptions
  extends LoadBleStabilityRemoteConfigOptions {
  /**
   * 직전 호출과의 최소 간격(ms). 이 간격 안쪽이면 실제 fetch 를 건너뛴다.
   * 기본값은 `DEFAULT_BLE_STABILITY_REFRESH_INTERVAL_MS` (30분).
   */
  minIntervalMs?: number;
}

/**
 * throttle 을 거쳐 원격 설정을 한 번 더 받는다 (Task #86).
 * 직전 호출(부트스트랩 / 로그인 / 이전 자동 갱신 모두 포함) 로부터 `minIntervalMs`
 * 가 지나지 않았다면 fetch 를 건너뛰고 `false` 를 돌려준다. 실제로 fetch 하면 `true`.
 *
 * 포그라운드 복귀(`visibilitychange`/`focus`) 와 주기 타이머가 같이 트리거되어도
 * 한 번으로 합쳐진다 — 폭주를 막는 핵심 가드.
 */
export async function refreshBleStabilityRemoteConfigIfStale(
  options: RefreshBleStabilityRemoteConfigOptions = {},
): Promise<boolean> {
  const minIntervalMs =
    options.minIntervalMs ?? DEFAULT_BLE_STABILITY_REFRESH_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const t = now();
  if (lastRefreshAt > 0 && t - lastRefreshAt < minIntervalMs) {
    return false;
  }
  await loadBleStabilityRemoteConfig(options);
  return true;
}

export interface SetupBleStabilityRemoteConfigAutoRefreshOptions
  extends RefreshBleStabilityRemoteConfigOptions {
  /**
   * 주기 타이머 간격(ms). 기본값은 `minIntervalMs` 와 같다 — throttle 와 같은
   * 간격이면 "주기마다 한 번 갱신" 의 의미가 깔끔하게 보장된다.
   */
  intervalMs?: number;
  /**
   * `focus` 이벤트를 받을 대상. 테스트에서는 mock 을 주입한다. 기본값은 `window`.
   * 명시적으로 `null` 을 넘기면 listener 를 달지 않는다.
   */
  windowTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  /**
   * `visibilitychange` 이벤트를 받을 document. 테스트에서는 mock 을 주입한다.
   * 명시적으로 `null` 을 넘기면 listener 를 달지 않는다. 기본값은 `document`.
   */
  documentTarget?: Pick<
    Document,
    'addEventListener' | 'removeEventListener' | 'visibilityState'
  > | null;
}

/**
 * 포그라운드 복귀 이벤트와 주기 타이머에 자동 갱신을 연결한다 (Task #86).
 * 반환된 cleanup 함수를 호출하면 listener 와 타이머가 모두 해제된다 — 테스트와
 * 핫 리로드 환경에서 누수를 막기 위함.
 */
export function setupBleStabilityRemoteConfigAutoRefresh(
  options: SetupBleStabilityRemoteConfigAutoRefreshOptions = {},
): () => void {
  const minIntervalMs =
    options.minIntervalMs ?? DEFAULT_BLE_STABILITY_REFRESH_INTERVAL_MS;
  const intervalMs = options.intervalMs ?? minIntervalMs;

  const win =
    options.windowTarget === undefined
      ? typeof window !== 'undefined'
        ? window
        : null
      : options.windowTarget;
  const doc =
    options.documentTarget === undefined
      ? typeof document !== 'undefined'
        ? document
        : null
      : options.documentTarget;

  const refreshOptions: RefreshBleStabilityRemoteConfigOptions = {
    fetcher: options.fetcher,
    endpoint: options.endpoint,
    storage: options.storage,
    isStale: options.isStale,
    now: options.now,
    minIntervalMs,
  };

  const trigger = () => {
    void refreshBleStabilityRemoteConfigIfStale(refreshOptions);
  };

  const onVisibility = () => {
    // 화면이 보이게 됐을 때만 트리거한다 — 백그라운드로 가는 전환에서는 의미가 없다.
    if (doc && doc.visibilityState !== 'hidden') {
      trigger();
    }
  };
  const onFocus = () => {
    trigger();
  };

  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('focus', onFocus);

  // setInterval 을 보호용으로 함께 둔다 — visibilitychange/focus 가 올라오지 않는
  // 환경(예: PWA 의 일부 백그라운드 상태) 에서도 throttle 안의 갱신은 보장된다.
  const intervalId: ReturnType<typeof setInterval> | null =
    intervalMs > 0 ? setInterval(trigger, intervalMs) : null;

  return () => {
    doc?.removeEventListener('visibilitychange', onVisibility);
    win?.removeEventListener('focus', onFocus);
    if (intervalId !== null) clearInterval(intervalId);
  };
}

/**
 * throttle 시계 초기화 (테스트 전용).
 * 실서비스에서는 호출하지 않는다 — 직전 호출 흔적을 잃으면 포그라운드 복귀가
 * 즉시 다시 fetch 한다.
 */
export function __resetBleStabilityRefreshThrottleForTests(): void {
  lastRefreshAt = 0;
}

/**
 * 캐시에 유효한 설정이 있으면 오버라이드로 등록한다.
 * 호출 후에 따로 `setBleStabilityOverrideResolver(null)` 을 부르지 않는 이유:
 * 캐시도 없는 상태에서 기본값을 깨끗이 유지하는 것이 옳고, 이미 떠 있는
 * 오버라이드를 덮어쓰는 책임은 "성공 응답이 들어왔을 때"만 진다.
 */
function applyCacheIfAny(storage: Storage | null): void {
  const cached = readCachedConfig(storage);
  if (!cached) return;
  const resolver = makeBleStabilityResolverFromRemoteConfig(cached);
  if (resolver) {
    setBleStabilityOverrideResolver(resolver);
  }
}

function getDefaultStorage(): Storage | null {
  try {
    const candidate = (globalThis as { localStorage?: Storage }).localStorage;
    return candidate ?? null;
  } catch {
    // 일부 환경(예: 쿠키 차단된 iframe)에서는 접근 자체가 throw 한다.
    return null;
  }
}

function readCachedConfig(
  storage: Storage | null,
): BleStabilityRemoteConfig | null {
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    discardCachedConfig(storage);
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    discardCachedConfig(storage);
    return null;
  }
  const envelope = parsed as Partial<CachedConfigEnvelope>;
  if (envelope.version !== BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION) {
    // 스키마가 바뀌었거나 다른 앱/도구가 같은 키를 썼다 — 안전하게 버린다.
    discardCachedConfig(storage);
    return null;
  }
  const config = envelope.config;
  if (config === null || config === undefined) return null;
  if (typeof config !== 'object') {
    discardCachedConfig(storage);
    return null;
  }
  return config as BleStabilityRemoteConfig;
}

function writeCachedConfig(
  storage: Storage | null,
  config: BleStabilityRemoteConfig | null,
): void {
  if (!storage) return;
  const envelope: CachedConfigEnvelope = {
    version: BLE_STABILITY_REMOTE_CONFIG_SCHEMA_VERSION,
    config,
  };
  try {
    storage.setItem(
      BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY,
      JSON.stringify(envelope),
    );
  } catch {
    // quota 초과/시크릿 모드 등 — 치명적이지 않으므로 무시.
  }
}

function discardCachedConfig(storage: Storage): void {
  try {
    storage.removeItem(BLE_STABILITY_REMOTE_CONFIG_CACHE_KEY);
  } catch {
    // 무시.
  }
}
