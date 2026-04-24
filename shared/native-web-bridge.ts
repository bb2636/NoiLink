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
 *  - `ble.reconnect.now` 신규 (사용자가 자동 백오프 카운트다운을 건너뛰고
 *    네이티브에 즉시 재연결을 요청; 진행 중인 sleep을 깨워 다음 attempt를 즉시 발사)
 */

import type { BleDisconnectReason, BleErrorAction, BleErrorCode, NoiPodCharacteristicKey } from './ble-constants.js';
import type { ChannelCode, ColorCode, ControlCmd, SessionPhase, TouchEvent } from './ble-protocol.js';

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
        /** 'auto' (기본): noResponse 시도 후 실패시 withResponse. */
        mode?: 'auto' | 'withResponse' | 'withoutResponse';
      };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.writeLed';
      payload: {
        tickId: number;
        pod: number;
        colorCode: ColorCode;
        onMs: number;
        flags?: number;
        /**
         * BLE write 신뢰도 모드. OFF 프레임처럼 손실되면 시각적으로
         * 잔상이 남는 프레임은 'withResponse'를 권장한다. 기본 'auto'.
         */
        mode?: 'auto' | 'withResponse' | 'withoutResponse';
      };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.writeSession';
      payload: {
        bpm: number;
        level: number;
        phase: SessionPhase;
        durationSec: number;
        flags?: number;
      };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.writeControl';
      payload: { cmd: ControlCmd };
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'ble.discoverGatt';
      payload?: Record<string, never>;
    }
  | {
      v: BridgeVersion;
      id: string;
      /**
       * 사용자가 자동 재연결 백오프 카운트다운을 건너뛰고 즉시 재시도를 요청.
       * - 네이티브가 이미 sleep(다음 attempt 대기) 중이면 sleep을 깨워 즉시 다음 attempt를 발사.
       * - 재연결 루프가 진행 중이 아니지만 connectionMeta.shouldReconnect=true 이면 새 루프 시작.
       * - 이미 connectToDevice 가 진행 중이거나(=마지막 시도/대기 0초) connect 상태이거나
       *   더 이상 자동 재연결 의도가 없으면 no-op (idempotent).
       */
      type: 'ble.reconnect.now';
      payload?: Record<string, never>;
    }
  | {
      v: BridgeVersion;
      id: string;
      type: 'push.requestPermission';
      payload?: Record<string, never>;
    };

/** 자동 GATT 선택 결과 */
export type GattAutoSelection = {
  service: string;
  txCharacteristic: string;
  rxCharacteristic: string;
} | null;

export type GattCharMeta = {
  uuid: string;
  isReadable: boolean;
  isWritableWithResponse: boolean;
  isWritableWithoutResponse: boolean;
  isNotifiable: boolean;
  isIndicatable: boolean;
};

export type GattServiceMeta = {
  uuid: string;
  chars: GattCharMeta[];
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
        /** notify 채널이 NoiPod TOUCH 프레임이면 네이티브가 미리 파싱해 함께 전달 */
        touch?: TouchEvent;
      };
    }
  | {
      v: BridgeVersion;
      type: 'ble.touch';
      payload: { touch: TouchEvent };
    }
  | {
      v: BridgeVersion;
      type: 'ble.gatt';
      payload: {
        services: GattServiceMeta[];
        selected: GattAutoSelection;
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
