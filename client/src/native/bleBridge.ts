import {
  NATIVE_BRIDGE_VERSION,
  type BleScanFilterPayload,
  type NoiPodCharacteristicKey,
  type WebToNativeMessage,
} from '@noilink/shared';
import { isNoiLinkNativeShell } from './initNativeBridge';

function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function post(message: WebToNativeMessage): void {
  if (!isNoiLinkNativeShell()) return;
  window.ReactNativeWebView!.postMessage(JSON.stringify(message));
}

export function bleEnsureReady(): void {
  post({ v: NATIVE_BRIDGE_VERSION, id: newRequestId(), type: 'ble.ensureReady' });
}

export function bleStartScan(options?: { filter?: BleScanFilterPayload; timeoutMs?: number }): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.startScan',
    payload: options,
  });
}

export function bleStopScan(): void {
  post({ v: NATIVE_BRIDGE_VERSION, id: newRequestId(), type: 'ble.stopScan' });
}

export function bleConnect(deviceId: string): void {
  post({ v: NATIVE_BRIDGE_VERSION, id: newRequestId(), type: 'ble.connect', payload: { deviceId } });
}

export function bleDisconnect(deviceId?: string): void {
  post({ v: NATIVE_BRIDGE_VERSION, id: newRequestId(), type: 'ble.disconnect', payload: { deviceId } });
}

/**
 * Notify 구독. UUID는 네이티브 셸이 NoiPod 상수에서 매핑합니다.
 */
export function bleSubscribeCharacteristic(
  subscriptionId: string,
  key: NoiPodCharacteristicKey
): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.subscribeCharacteristic',
    payload: { subscriptionId, key },
  });
}

export function bleUnsubscribeCharacteristic(subscriptionId: string): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.unsubscribeCharacteristic',
    payload: { subscriptionId },
  });
}

/**
 * Characteristic write. UUID는 네이티브 셸이 NoiPod 상수에서 매핑합니다.
 */
export function bleWriteCharacteristic(
  key: NoiPodCharacteristicKey,
  base64Value: string
): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.writeCharacteristic',
    payload: { key, base64Value },
  });
}
