import { validateNativeToWebMessage, type NativeToWebMessage } from '@noilink/shared';
import { STORAGE_KEYS } from '../utils/constants';
import { setBleConnectedDeviceName } from './bleFirmwareReady';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void };
    __NOILINK_NATIVE_RECEIVE__?: (msg: unknown) => void;
    __NOILINK_NATIVEBridge_ON_MESSAGE__?: (msg: unknown) => void;
    __NOILINK_NATIVE_MESSAGE_QUEUE__?: unknown[];
  }
}

function applySessionToWebStorage(payload: {
  token: string | null;
  userId: string | null;
  displayName: string | null;
}): void {
  if (payload.token) localStorage.setItem(STORAGE_KEYS.TOKEN, payload.token);
  else localStorage.removeItem(STORAGE_KEYS.TOKEN);

  if (payload.userId) localStorage.setItem(STORAGE_KEYS.USER_ID, payload.userId);
  else localStorage.removeItem(STORAGE_KEYS.USER_ID);

  if (payload.displayName) localStorage.setItem(STORAGE_KEYS.USERNAME, payload.displayName);
  else localStorage.removeItem(STORAGE_KEYS.USERNAME);
}

function dispatchNativeMessage(msg: NativeToWebMessage): void {
  switch (msg.type) {
    case 'session.update':
      applySessionToWebStorage(msg.payload);
      window.dispatchEvent(new CustomEvent('noilink-native-session', { detail: msg.payload }));
      break;
    case 'native.ack':
      window.dispatchEvent(new CustomEvent('noilink-native-ack', { detail: msg.payload }));
      break;
    case 'ble.connection':
      // 연결 시점에 디바이스 이름으로 펌웨어 탑재 여부를 판단해 둔다.
      // (광고명 'NoiPod-XXXX' 면 정식 펌웨어, 그 외(예: 'NINA-B1-XXXXXX')는
      //  시연 모드 — bleBridge 가 BLE write 를 자동 no-op 하고
      //  TrainingSessionPlay 가 BLE 단절 abort 를 무시하도록 한다.)
      if (msg.payload.connected != null) {
        setBleConnectedDeviceName(msg.payload.connected.name);
      }
      window.dispatchEvent(new CustomEvent('noilink-native-bridge', { detail: msg }));
      break;
    case 'ble.discovery':
    case 'ble.scanState':
    case 'ble.reconnect':
    case 'ble.notify':
    case 'ble.touch':
    case 'ble.gatt':
    case 'ble.error':
    case 'push.state':
      window.dispatchEvent(new CustomEvent('noilink-native-bridge', { detail: msg }));
      break;
    case 'network.online':
      // 네이티브 셸이 OS 단의 네트워크 복구를 알릴 때, 결과 전송 큐가 즉시 drain 되도록
      // 별도 이벤트로 브로드캐스트한다. 수신 측(useDrainPendingTrainingRuns)은
      // 브라우저 `online` 이벤트와 동일한 throttle/in-flight 가드를 통과시켜
      // MAX_TOTAL_ATTEMPTS 폭주와 outcome 중복 안내를 막는다.
      //
      // payload 가 있으면 진단 카운터(immediate vs deferred 발사 비율)를 운영 로그에
      // 한 줄 남긴다. detail 로도 그대로 흘려보내, 향후 hook 측이 trigger 별 카운터를
      // 같이 기록하고 싶을 때 활용 지점을 마련한다 (현재 hook 은 detail 을 무시).
      window.dispatchEvent(
        new CustomEvent('noilink-native-network-online', { detail: msg.payload ?? null }),
      );
      logNetworkOnlineDiagnostics(msg.payload);
      break;
    default:
      break;
  }
}

/**
 * 네이티브 네트워크 복구 브리지의 진단 카운터를 운영 로그에 한 줄 남긴다.
 *
 * 목적:
 *  - throttle 윈도우 만료 직후 deferred emit (hole-closer) 이 실제로 얼마나
 *    자주 살리는지 운영 데이터로 추적해, throttle 파라미터(`minIntervalMs`,
 *    웹 측 `MIN_DRAIN_INTERVAL_MS`) 조정 근거를 만든다.
 *  - 운영자는 며칠치 로그에서 `path=immediate` vs `path=deferred` 발사 수의
 *    비율, 그리고 `cancelled` 누적값을 한눈에 본다.
 *
 * 옛 native 셸이거나 broadcast payload 가 비어 있는 경우에는 카운터가 없으므로
 * 진단 줄을 남기지 않는다 (잡음 줄이기). drain 트리거 자체는 그대로 발화된다.
 */
function logNetworkOnlineDiagnostics(payload: { path?: string; immediateFires?: number; deferredFires?: number; deferredCancels?: number } | undefined): void {
  if (!payload || (payload.path !== 'immediate' && payload.path !== 'deferred')) return;
  const immediate = typeof payload.immediateFires === 'number' ? payload.immediateFires : 0;
  const deferred = typeof payload.deferredFires === 'number' ? payload.deferredFires : 0;
  const cancelled = typeof payload.deferredCancels === 'number' ? payload.deferredCancels : 0;
  // eslint-disable-next-line no-console
  console.info(
    `[network-online] path=${payload.path} immediate=${immediate} deferred=${deferred} cancelled=${cancelled}`,
  );
}

function onIncomingFromNative(raw: unknown): void {
  const result = validateNativeToWebMessage(raw);
  if (!result.ok) {
    console.warn('[NoiLink bridge] reject', result.error, raw);
    return;
  }
  dispatchNativeMessage(result.message);
}

/**
 * WebView 부트스트랩과 동일한 수신 큐를 사용합니다. main.tsx에서 가장 먼저 호출하세요.
 */
export function initNativeBridge(): void {
  window.__NOILINK_NATIVEBridge_ON_MESSAGE__ = onIncomingFromNative;

  const queued = window.__NOILINK_NATIVE_MESSAGE_QUEUE__;
  if (Array.isArray(queued) && queued.length > 0) {
    for (const item of queued) {
      onIncomingFromNative(item);
    }
    window.__NOILINK_NATIVE_MESSAGE_QUEUE__ = [];
  }
}

export function isNoiLinkNativeShell(): boolean {
  return typeof window !== 'undefined' && typeof window.ReactNativeWebView?.postMessage === 'function';
}
