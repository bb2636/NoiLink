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
import { getBleFirmwareReady } from './bleFirmwareReady';

function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 펌웨어 미탑재 기기(예: u-blox NINA-B1 디폴트 펌웨어, 광고명 'NINA-B1-XXXXXX')에
 * BLE write 를 보내봐야 모듈 단에서 무시되며, 일부 펌웨어는 응답이 없어
 * withResponse write 가 timeout → ack(false) 토스트로 이어진다.
 *
 * 그래서 "정식 펌웨어 아님(=getBleFirmwareReady() === false)" 으로 확인된 경우에는
 * write 류 메시지만 silent no-op 처리한다. 스캔/연결/구독/재연결 같은 비-write
 * 메시지는 그대로 보내, 디바이스 페이지의 연결 흐름과 TOUCH notify(펌웨어가
 * 들어오면 자동으로 살아남) 는 영향이 없다.
 */
const BLE_WRITE_TYPES: ReadonlySet<WebToNativeMessage['type']> = new Set([
  'ble.writeLed',
  'ble.writeSession',
  'ble.writeControl',
  'ble.writeCharacteristic',
]);

function post(message: WebToNativeMessage): void {
  if (!isNoiLinkNativeShell()) return;
  if (BLE_WRITE_TYPES.has(message.type) && getBleFirmwareReady() === false) {
    return;
  }
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

/**
 * 자동 재연결의 백오프 카운트다운을 건너뛰고 즉시 다음 재시도를 트리거하도록 네이티브에 요청.
 *
 * 사용 시나리오: 단절 직후 사용자가 디바이스를 다시 켰거나 거리가 가까워졌을 때,
 * 1s/2s/4s 백오프가 끝나길 기다리지 않고 바로 재연결을 시도해 회복 속도를 높인다.
 *
 * 멱등성: 네이티브 측이 이미 connectToDevice 중이거나 재연결 의도가 없으면 no-op.
 * 네이티브 미연결(웹/Expo Go)이면 자동 no-op.
 */
export function bleReconnectNow(): void {
  post({ v: NATIVE_BRIDGE_VERSION, id: newRequestId(), type: 'ble.reconnect.now' });
}
