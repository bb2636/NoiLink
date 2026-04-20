/**
 * Web (Vite client) ↔ React Native shell message contract.
 * All messages carry `v`. Request/response pairs use `id` (UUID) on web→native
 * and the same `id` on `native.ack` or error-bearing replies.
 *
 * v2 변경점 (2026-04):
 *  - subscribe/write가 raw UUID 대신 `key: NoiPodCharacteristicKey` 사용 (UUID 추상화)
 *  - `ble.error.code`가 구조화된 `BleErrorCode` enum
 *  - `ble.connection.reason`으로 종료 사유 구분
 *  - `ble.reconnect` 신규 (재연결 시도 진행 알림)
 */

import type { BleDisconnectReason, BleErrorAction, BleErrorCode, NoiPodCharacteristicKey } from './ble-constants.js';

export const NATIVE_BRIDGE_VERSION = 2 as const;

export type BridgeVersion = typeof NATIVE_BRIDGE_VERSION;

/** Discovered BLE device snapshot (no native handles). */
export type BleDiscoverySnapshot = {
  id: string;
  name: string | null;
  rssi: number | null;
  lastSeenAt: number;
};

export type BleScanFilterPayload = {
  namePrefix?: string;
  nameContains?: string;
  serviceUUIDs?: string[];
};

// -----------------------------------------------------------------------------
// Web → Native
// -----------------------------------------------------------------------------

export type WebToNativeMessage =
  | {
      v: BridgeVersion;
      id: string;
      type: 'auth.requestSession';
      payload?: Record<string, never>;
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'auth.persistSession';
      payload: { token: string; userId: string; displayName?: string };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'auth.clearSession';
      payload?: Record<string, never>;
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.ensureReady';
      payload?: Record<string, never>;
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.startScan';
      payload?: { filter?: BleScanFilterPayload; timeoutMs?: number };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.stopScan';
      payload?: Record<string, never>;
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.connect';
      payload: { deviceId: string };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.disconnect';
      payload?: { deviceId?: string };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.subscribeCharacteristic';
      payload: {
        subscriptionId: string;
        /** Semantic key — 네이티브가 NoiPod UUID로 매핑 */
        key: NoiPodCharacteristicKey;
      };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.unsubscribeCharacteristic';
      payload: { subscriptionId: string };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.writeCharacteristic';
      payload: {
        /** Semantic key — 네이티브가 NoiPod UUID로 매핑 */
        key: NoiPodCharacteristicKey;
        /** Base64 GATT payload (same convention as react-native-ble-plx). */
        base64Value: string;
      };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'push.requestPermission';
      payload?: Record<string, never>;
    };

// -----------------------------------------------------------------------------
// Native → Web
// -----------------------------------------------------------------------------

export type NativeToWebMessage =
  | {
      v: BridgeVersion;
      type: 'session.update';
      payload: {
        token: string | null;
        userId: string | null;
        displayName: string | null;
      };
    }
  | {
      v: BridgeVersion;
      type: 'native.ack';
      payload: { id: string; ok: boolean; error?: string };
    }
  | {
      v: BridgeVersion;
      type: 'ble.discovery';
      payload: { device: BleDiscoverySnapshot };
    }
  | {
      v: BridgeVersion;
      type: 'ble.scanState';
      payload: { scanning: boolean };
    }
  | {
      v: BridgeVersion;
      type: 'ble.connection';
      payload: {
        connected: BleDiscoverySnapshot | null;
        /** null로 전환된 경우의 종료 사유 */
        reason?: BleDisconnectReason;
      };
    }
  | {
      v: BridgeVersion;
      type: 'ble.reconnect';
      payload: {
        deviceId: string;
        attempt: number;
        maxAttempts: number;
        /** 다음 시도까지 대기 시간 (ms). 마지막 시도면 생략 */
        nextDelayMs?: number;
      };
    }
  | {
      v: BridgeVersion;
      type: 'ble.notify';
      payload: {
        subscriptionId: string;
        key: NoiPodCharacteristicKey;
        base64Value: string;
      };
    }
  | {
      v: BridgeVersion;
      type: 'ble.error';
      payload: {
        id?: string;
        code: BleErrorCode;
        message: string;
        deviceId?: string;
        action?: BleErrorAction;
      };
    }
  | {
      v: BridgeVersion;
      type: 'push.state';
      payload: { status: 'unconfigured' | 'granted' | 'denied' | 'unavailable'; detail?: string };
    };

export function isWebToNativeMessage(raw: unknown): raw is WebToNativeMessage {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return o.v === NATIVE_BRIDGE_VERSION && typeof o.type === 'string' && typeof o.id === 'string';
}

export function isNativeToWebMessage(raw: unknown): raw is NativeToWebMessage {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  return o.v === NATIVE_BRIDGE_VERSION && typeof o.type === 'string';
}
