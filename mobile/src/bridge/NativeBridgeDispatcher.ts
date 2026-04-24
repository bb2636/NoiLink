import {
  CTRL_STOP,
  NATIVE_BRIDGE_VERSION,
  encodeControlFrame,
  encodeLedFrame,
  encodeSessionFrame,
  isWebToNativeMessage,
  tryParseTouchBase64,
  type BleErrorAction,
  type BleErrorCode,
  type BleScanFilterPayload,
  type NoiPodCharacteristicKey,
  type WebToNativeMessage,
} from '@noilink/shared';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { BleManagerError, bleManager } from '../ble/BleManager';
import type { BleScanFilter } from '../ble/ble.types';
import { clearStoredAuth, getStoredToken, getStoredUserDisplay, setStoredAuth } from '../auth/storage';
import { postNativeToWeb } from './injectToWeb';

let activeScanStop: (() => void) | null = null;
const notifySubscriptions = new Map<string, { remove: () => void; key: NoiPodCharacteristicKey }>();
let eventHandlersBound = false;
let appStateSubscription: NativeEventSubscription | null = null;
let lastAppState: AppStateStatus = AppState.currentState;

function ack(id: string, ok: boolean, error?: string): void {
  postNativeToWeb({
    v: NATIVE_BRIDGE_VERSION,
    type: 'native.ack',
    payload: { id, ok, error },
  });
}

function bleError(
  id: string | undefined,
  code: BleErrorCode,
  message: string,
  action?: BleErrorAction,
  deviceId?: string
): void {
  postNativeToWeb({
    v: NATIVE_BRIDGE_VERSION,
    type: 'ble.error',
    payload: { id, code, message, action, deviceId },
  });
}

function toBleFilter(f?: BleScanFilterPayload): BleScanFilter | undefined {
  if (!f) return undefined;
  return {
    namePrefix: f.namePrefix,
    nameContains: f.nameContains,
    serviceUUIDs: f.serviceUUIDs,
  };
}

function pushSessionUpdate(token: string | null, userId: string | null, displayName: string | null): void {
  postNativeToWeb({
    v: NATIVE_BRIDGE_VERSION,
    type: 'session.update',
    payload: { token, userId, displayName },
  });
}

function ensureBleEventHandlersBound(): void {
  if (eventHandlersBound) return;
  eventHandlersBound = true;
  bleManager.setEventHandlers({
    onConnectionLost: (deviceId) => {
      postNativeToWeb({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.connection',
        payload: { connected: null, reason: 'unexpected' },
      });
      // 알림용 첫 reconnect 이벤트는 BleManager.runReconnect 안에서 발사
      void deviceId;
    },
    onReconnectAttempt: (deviceId, attempt, maxAttempts, nextDelayMs) => {
      postNativeToWeb({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.reconnect',
        payload: { deviceId, attempt, maxAttempts, nextDelayMs },
      });
    },
    onReconnectSuccess: (device) => {
      postNativeToWeb({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.connection',
        payload: { connected: bleManager.toDiscoverySnapshot(device) },
      });
    },
    onReconnectFailed: (deviceId) => {
      // 장치 끊김 → 추적 중인 모든 구독 안전하게 해제 후 맵 초기화
      removeAllNotifySubscriptions();
      postNativeToWeb({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.connection',
        payload: { connected: null, reason: 'retry-failed' },
      });
      bleError(undefined, 'RECONNECT_FAILED', '재연결 실패', 'reconnect', deviceId);
    },
    onUserDisconnect: (_deviceId) => {
      removeAllNotifySubscriptions();
    },
  });
}

/**
 * 앱이 백그라운드/비활성으로 전환될 때 NoiPod에 CONTROL_STOP을 즉시 송신.
 *
 * 배경: 트레이닝 진행 중 사용자가 홈 버튼/앱 스위처로 화면을 가리면, WebView 안의
 * `document.visibilitychange`도 STOP을 시도하지만 iOS WKWebView의 JS 스레드가
 * 곧바로 정지되면 그 메시지가 네이티브에 도달하기 전에 끊길 수 있다. 본 핸들러는
 * RN AppState 전환을 네이티브 측에서 직접 잡아 한 번 더 STOP을 송신하는 안전망이다.
 *
 * - 디바이스 미연결 상태면 자동 no-op (writeCharacteristic이 NOT_CONNECTED를 던지므로
 *   try/catch로 무시).
 * - STOP은 idempotent이므로 세션이 없는 상태에 도달해도 펌웨어가 안전하게 무시한다.
 */
async function sendControlStopBestEffort(reason: string): Promise<void> {
  const dev = bleManager.getNativeConnectedDevice();
  if (!dev) return;
  try {
    const writeChar = bleManager.resolveLocator('write');
    const frame = encodeControlFrame(CTRL_STOP);
    await bleManager.writeCharacteristic(
      writeChar.serviceUUID,
      writeChar.characteristicUUID,
      frame,
      'auto'
    );
    console.log('[NoiLink bridge] AppState STOP sent', reason);
  } catch (e) {
    console.warn(
      '[NoiLink bridge] AppState STOP failed',
      reason,
      e instanceof Error ? e.message : String(e)
    );
  }
}

/**
 * 앱이 백그라운드로 들어가는 순간을 감지해 즉시 STOP을 보낸다.
 * 한 번만 등록되며 (앱 라이프사이클 동안 살아 있음), 중복 등록은 무시한다.
 */
export function ensureAppLifecycleHandlerBound(): void {
  if (appStateSubscription) return;
  lastAppState = AppState.currentState;
  appStateSubscription = AppState.addEventListener('change', (next) => {
    const prev = lastAppState;
    lastAppState = next;
    // active → background/inactive 전환 시점에만 STOP을 보낸다.
    // (active ↔ active 같은 동일 상태 반복은 무시)
    if (prev === 'active' && (next === 'background' || next === 'inactive')) {
      void sendControlStopBestEffort(`appstate ${prev}->${next}`);
    }
  });
}

function removeAllNotifySubscriptions(): void {
  for (const [id, sub] of notifySubscriptions) {
    try {
      sub.remove();
    } catch (e) {
      console.warn('[NoiLink bridge] notify cleanup warn', id, e);
    }
  }
  notifySubscriptions.clear();
}

export async function dispatchWebMessage(raw: string): Promise<void> {
  ensureBleEventHandlersBound();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[NoiLink bridge] non-JSON message');
    return;
  }

  // 1차: 봉투에서 v/id만 빠르게 추출 (구버전 클라이언트도 명시적 응답 받기 위함)
  const envelope =
    parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  const envId = envelope && typeof envelope.id === 'string' ? (envelope.id as string) : undefined;
  const envV = envelope ? envelope.v : undefined;

  if (envV !== NATIVE_BRIDGE_VERSION) {
    const message = `Bridge version mismatch (got ${String(envV)}, expected ${NATIVE_BRIDGE_VERSION})`;
    console.warn('[NoiLink bridge]', message);
    bleError(envId, 'HANDLER_ERROR', message);
    if (envId) ack(envId, false, 'version-mismatch');
    return;
  }

  // 2차: 정상 v2 envelope 구조 검증
  if (!isWebToNativeMessage(parsed)) {
    console.warn('[NoiLink bridge] unknown envelope', parsed);
    bleError(envId, 'HANDLER_ERROR', 'Invalid message envelope');
    if (envId) ack(envId, false, 'invalid-envelope');
    return;
  }

  const msg = parsed as WebToNativeMessage;

  try {
    await handleWebMessage(msg);
  } catch (e) {
    if (e instanceof BleManagerError) {
      console.error('[NoiLink bridge] BleManagerError', e.code, e.message);
      bleError(msg.id, e.code, e.message, e.action, e.deviceId);
      ack(msg.id, false, e.message);
      return;
    }
    const message = e instanceof Error ? e.message : String(e);
    console.error('[NoiLink bridge] handler error', message);
    bleError(msg.id, 'HANDLER_ERROR', message);
    ack(msg.id, false, message);
  }
}

async function handleWebMessage(msg: WebToNativeMessage): Promise<void> {
  switch (msg.type) {
    case 'auth.requestSession': {
      const token = await getStoredToken();
      const { userId, name } = await getStoredUserDisplay();
      pushSessionUpdate(token, userId, name);
      ack(msg.id, true);
      return;
    }

    case 'auth.persistSession': {
      const { token, userId, displayName } = msg.payload;
      await setStoredAuth(token, userId, displayName);
      pushSessionUpdate(token, userId, displayName ?? null);
      ack(msg.id, true);
      return;
    }

    case 'auth.clearSession': {
      await clearStoredAuth();
      pushSessionUpdate(null, null, null);
      ack(msg.id, true);
      return;
    }

    case 'ble.ensureReady': {
      await bleManager.ensureReady();
      ack(msg.id, true);
      return;
    }

    case 'ble.startScan': {
      if (activeScanStop) {
        activeScanStop();
        activeScanStop = null;
      }
      const filter = toBleFilter(msg.payload?.filter);
      const timeoutMs = msg.payload?.timeoutMs;
      const { stop } = bleManager.startDeviceScan(
        filter,
        (device) => {
          const snap = bleManager.toDiscoverySnapshot(device);
          postNativeToWeb({
            v: NATIVE_BRIDGE_VERSION,
            type: 'ble.discovery',
            payload: { device: snap },
          });
        },
        timeoutMs != null ? { timeoutMs } : undefined
      );
      activeScanStop = stop;
      postNativeToWeb({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.scanState',
        payload: { scanning: true },
      });
      ack(msg.id, true);
      return;
    }

    case 'ble.stopScan': {
      if (activeScanStop) {
        activeScanStop();
        activeScanStop = null;
      }
      bleManager.stopScan();
      postNativeToWeb({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.scanState',
        payload: { scanning: false },
      });
      ack(msg.id, true);
      return;
    }

    case 'ble.connect': {
      const dev = await bleManager.connect(msg.payload.deviceId);
      const snap = bleManager.toDiscoverySnapshot(dev);
      postNativeToWeb({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.connection',
        payload: { connected: snap },
      });
      // connect() 안에서 자동 GATT 탐색을 한 번 수행했으므로 그 결과를 웹에도 알려준다.
      // selected가 있으면 그 UUID들이 이후 write/notify에 사용된다 (없으면 NoiPod 상수 fallback).
      const gatt = bleManager.getLastGattDiscovery();
      if (gatt) {
        postNativeToWeb({
          v: NATIVE_BRIDGE_VERSION,
          type: 'ble.gatt',
          payload: { services: gatt.services, selected: gatt.selected },
        });
      }
      ack(msg.id, true);
      return;
    }

    case 'ble.disconnect': {
      const beforeId = bleManager.getNativeConnectedDevice()?.id ?? null;
      await bleManager.disconnect(msg.payload?.deviceId);
      const afterId = bleManager.getNativeConnectedDevice()?.id ?? null;
      // 실제로 disconnect가 일어난 경우에만 구독을 정리 (deviceId mismatch로 skip된 경우 보존)
      if (beforeId && !afterId) {
        removeAllNotifySubscriptions();
        postNativeToWeb({
          v: NATIVE_BRIDGE_VERSION,
          type: 'ble.connection',
          payload: { connected: null, reason: 'user' },
        });
      }
      ack(msg.id, true);
      return;
    }

    case 'ble.subscribeCharacteristic': {
      const { subscriptionId, key } = msg.payload;
      let resolved;
      try {
        // 동적 매핑(연결 시 GATT 탐색으로 받은 UUID) 우선, 없으면 NoiPod 상수
        resolved = bleManager.resolveLocator(key);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        throw new BleManagerError('UNKNOWN_CHARACTERISTIC', 'subscribe', m);
      }
      const existing = notifySubscriptions.get(subscriptionId);
      if (existing) existing.remove();
      const { remove } = bleManager.subscribeToCharacteristic(
        resolved.serviceUUID,
        resolved.characteristicUUID,
        (base64Value) => {
          // notify 채널이 NoiPod TOUCH 프레임이면 미리 파싱해 함께 전달
          // (웹은 base64로 받아도 되고, 파싱된 touch만 써도 됨)
          let touch = undefined;
          if (key === 'notify') {
            const parsed = tryParseTouchBase64(base64Value);
            if (parsed) {
              touch = parsed;
              // 트레이닝 화면이 빠르게 받도록 별도 채널로도 push
              postNativeToWeb({
                v: NATIVE_BRIDGE_VERSION,
                type: 'ble.touch',
                payload: { touch: parsed },
              });
            }
          }
          postNativeToWeb({
            v: NATIVE_BRIDGE_VERSION,
            type: 'ble.notify',
            payload: { subscriptionId, key, base64Value, touch },
          });
        }
      );
      notifySubscriptions.set(subscriptionId, { remove, key });
      ack(msg.id, true);
      return;
    }

    case 'ble.unsubscribeCharacteristic': {
      const sub = notifySubscriptions.get(msg.payload.subscriptionId);
      if (sub) {
        sub.remove();
        notifySubscriptions.delete(msg.payload.subscriptionId);
      }
      ack(msg.id, true);
      return;
    }

    case 'ble.writeCharacteristic': {
      const { key, base64Value, mode } = msg.payload;
      let resolved;
      try {
        resolved = bleManager.resolveLocator(key);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        throw new BleManagerError('UNKNOWN_CHARACTERISTIC', 'write', m);
      }
      await bleManager.writeCharacteristic(
        resolved.serviceUUID,
        resolved.characteristicUUID,
        base64Value,
        mode ?? 'auto'
      );
      ack(msg.id, true);
      return;
    }

    case 'ble.writeLed': {
      const writeChar = bleManager.resolveLocator('write');
      const frame = encodeLedFrame(msg.payload);
      await bleManager.writeCharacteristic(
        writeChar.serviceUUID,
        writeChar.characteristicUUID,
        frame,
        msg.payload.mode ?? 'auto'
      );
      ack(msg.id, true);
      return;
    }

    case 'ble.writeSession': {
      const writeChar = bleManager.resolveLocator('write');
      const frame = encodeSessionFrame(msg.payload);
      await bleManager.writeCharacteristic(
        writeChar.serviceUUID,
        writeChar.characteristicUUID,
        frame,
        'auto'
      );
      ack(msg.id, true);
      return;
    }

    case 'ble.writeControl': {
      const writeChar = bleManager.resolveLocator('write');
      const frame = encodeControlFrame(msg.payload.cmd);
      await bleManager.writeCharacteristic(
        writeChar.serviceUUID,
        writeChar.characteristicUUID,
        frame,
        'auto'
      );
      ack(msg.id, true);
      return;
    }

    case 'ble.discoverGatt': {
      const result = await bleManager.discoverGattAuto();
      postNativeToWeb({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.gatt',
        payload: { services: result.services, selected: result.selected },
      });
      ack(msg.id, true);
      return;
    }

    case 'push.requestPermission': {
      postNativeToWeb({
        v: NATIVE_BRIDGE_VERSION,
        type: 'push.state',
        payload: { status: 'unconfigured', detail: 'expo-notifications not wired yet' },
      });
      ack(msg.id, true);
      return;
    }

    default: {
      const _exhaustive: never = msg;
      console.warn('[NoiLink bridge] unhandled web message', _exhaustive);
    }
  }
}
