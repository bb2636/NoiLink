import { NATIVE_BRIDGE_VERSION, type BleScanFilterPayload, type WebToNativeMessage } from '@noilink/shared';
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

export function bleSubscribeCharacteristic(
  subscriptionId: string,
  serviceUUID: string,
  characteristicUUID: string
): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.subscribeCharacteristic',
    payload: { subscriptionId, serviceUUID, characteristicUUID },
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

export function bleWriteCharacteristic(
  serviceUUID: string,
  characteristicUUID: string,
  base64Value: string
): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.writeCharacteristic',
    payload: { serviceUUID, characteristicUUID, base64Value },
  });
}
