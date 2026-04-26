/**
 * BLE 단절 안내 임계값 원격 설정 부트스트랩 (Task #48)
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
 */
import {
  makeBleStabilityResolverFromRemoteConfig,
  setBleStabilityOverrideResolver,
  type BleStabilityRemoteConfig,
} from '@noilink/shared';

const ENDPOINT = '/api/config/ble-stability';

interface RemoteConfigEnvelope {
  success?: boolean;
  data?: BleStabilityRemoteConfig | null;
}

/**
 * 원격 설정을 한 번 받아 오버라이드를 등록한다. 실패 시 조용히 무시한다.
 * 부트스트랩 코드가 await 하지 않아도 되도록 Promise<void> 를 돌려준다.
 */
export async function loadBleStabilityRemoteConfig(
  options: { fetcher?: typeof fetch; endpoint?: string } = {},
): Promise<void> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const endpoint = options.endpoint ?? ENDPOINT;
  if (typeof fetcher !== 'function') return;

  let payload: RemoteConfigEnvelope | null = null;
  try {
    const res = await fetcher(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[ble-stability] remote config fetch failed: HTTP ${res.status}`);
      return;
    }
    payload = (await res.json()) as RemoteConfigEnvelope;
  } catch (err) {
    console.warn(
      '[ble-stability] remote config fetch threw:',
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const config = payload?.data ?? null;
  const resolver = makeBleStabilityResolverFromRemoteConfig(config);
  // resolver 가 null 이어도 명시적으로 호출해 이전 부트스트랩에서 남은 오버라이드를
  // 깨끗이 비운다(핫 리로드/테스트 환경에서의 누수 방지).
  setBleStabilityOverrideResolver(resolver);
}
