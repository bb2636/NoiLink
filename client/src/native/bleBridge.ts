import {
  NATIVE_BRIDGE_VERSION,
  type BleScanFilterPayload,
  type ColorCode,
  type ControlCmd,
  type NoiPodCharacteristicKey,
  type SessionPhase,
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

/**
 * LED 점등 프레임 송신. 네이티브 미연결(웹/Expo Go)이면 자동 no-op.
 *
 * `mode`로 BLE write 신뢰도를 지정할 수 있다. OFF 프레임처럼 손실되면
 * 시각적 잔상이 남는 프레임은 'withResponse'(ack 보장)를 권장한다.
 * 일반 점등 프레임은 기본 'auto'로 두면 된다(저지연 우선).
 */
export function bleWriteLed(payload: {
  tickId: number;
  pod: number;
  colorCode: ColorCode;
  onMs: number;
  flags?: number;
  mode?: 'auto' | 'withResponse' | 'withoutResponse';
}): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.writeLed',
    payload,
  });
}

/** 세션 시작 메타 (BPM/Level/페이즈/길이) — 트레이닝 시작 시 1회 */
export function bleWriteSession(payload: {
  bpm: number;
  level: number;
  phase: SessionPhase;
  durationSec: number;
  flags?: number;
}): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.writeSession',
    payload,
  });
}

/** START / STOP / PAUSE 컨트롤 */
export function bleWriteControl(cmd: ControlCmd): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.writeControl',
    payload: { cmd },
  });
}

/** GATT 서비스/캐릭터리스틱 자동 탐색 (재연결 없이 강제 재탐색) */
export function bleDiscoverGatt(): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.discoverGatt',
  });
}
