import {
  NATIVE_BRIDGE_VERSION,
  isWebToNativeMessage,
  type BleScanFilterPayload,
  type WebToNativeMessage,
} from '@noilink/shared';
import { bleManager } from '../ble/BleManager';
import type { BleScanFilter } from '../ble/ble.types';
import { clearStoredAuth, getStoredToken, getStoredUserDisplay, setStoredAuth } from '../auth/storage';
import { postNativeToWeb } from './injectToWeb';

let activeScanStop: (() => void) | null = null;
const notifySubscriptions = new Map<string, { remove: () => void }>();

function ack(id: string, ok: boolean, error?: string): void {
  postNativeToWeb({
    v: NATIVE_BRIDGE_VERSION,
    type: 'native.ack',
    payload: { id, ok, error },
  });
}

function bleError(id: string | undefined, code: string, message: string): void {
  postNativeToWeb({
    v: NATIVE_BRIDGE_VERSION,
    type: 'ble.error',
    payload: { id, code, message },
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

export async function dispatchWebMessage(raw: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[NoiLink bridge] non-JSON message');
    return;
  }

  if (!isWebToNativeMessage(parsed)) {
    console.warn('[NoiLink bridge] unknown envelope', parsed);
    return;
  }

  const msg = parsed as WebToNativeMessage;
  if (msg.v !== NATIVE_BRIDGE_VERSION) return;

  try {
    await handleWebMessage(msg);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[NoiLink bridge] handler error', message);
    bleError(msg.id, 'handler', message);
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
      ack(msg.id, true);
      return;
    }

    case 'ble.disconnect': {
      await bleManager.disconnect(msg.payload?.deviceId);
      postNativeToWeb({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.connection',
        payload: { connected: null },
      });
      ack(msg.id, true);
      return;
    }

    case 'ble.subscribeCharacteristic': {
      const { subscriptionId, serviceUUID, characteristicUUID } = msg.payload;
      const existing = notifySubscriptions.get(subscriptionId);
      if (existing) existing.remove();
      const { remove } = bleManager.subscribeToCharacteristic(serviceUUID, characteristicUUID, (base64Value) => {
        postNativeToWeb({
          v: NATIVE_BRIDGE_VERSION,
          type: 'ble.notify',
          payload: { subscriptionId, serviceUUID, characteristicUUID, base64Value },
        });
      });
      notifySubscriptions.set(subscriptionId, { remove });
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
      const { serviceUUID, characteristicUUID, base64Value } = msg.payload;
      await bleManager.writeCharacteristic(serviceUUID, characteristicUUID, base64Value);
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
