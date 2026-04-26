import { validateNativeToWebMessage, type NativeToWebMessage } from '@noilink/shared';
import { STORAGE_KEYS } from '../utils/constants';

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
    case 'ble.discovery':
    case 'ble.scanState':
    case 'ble.connection':
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
      window.dispatchEvent(new CustomEvent('noilink-native-network-online'));
      break;
    default:
      break;
  }
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
