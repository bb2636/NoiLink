import { isNativeToWebMessage, NATIVE_BRIDGE_VERSION, type NativeToWebMessage } from '@noilink/shared';
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
    case 'ble.error':
    case 'push.state':
      window.dispatchEvent(new CustomEvent('noilink-native-bridge', { detail: msg }));
      break;
    default:
      break;
  }
}

function onIncomingFromNative(raw: unknown): void {
  if (!isNativeToWebMessage(raw)) return;
  if (raw.v !== NATIVE_BRIDGE_VERSION) return;
  dispatchNativeMessage(raw);
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
