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
 *
 * 가드 정책 (2026-04, Task #30):
 *  - `isWebToNativeMessage` / `isNativeToWebMessage` 는 envelope (v/type/id) 뿐
 *    아니라 `type` 별 payload 모양도 검사한다. 잘못된 모양(예: `ble.connect`에
 *    `deviceId` 누락, 알 수 없는 type) 은 가드 단계에서 거부된다.
 *  - 어떤 type/필드가 잘못됐는지 알아야 할 때는 `validateWebToNativeMessage` /
 *    `validateNativeToWebMessage` 를 사용해 구조화된 에러를 받는다.
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

// -----------------------------------------------------------------------------
// 구조화된 검증 결과
// -----------------------------------------------------------------------------

/**
 * 가드/검증기가 메시지를 거부한 사유.
 *
 * - `not-object`: 입력이 객체가 아님 (null/배열/스칼라).
 * - `envelope-version`: `v` 가 `NATIVE_BRIDGE_VERSION` 과 다름.
 * - `envelope-type`: `type` 필드가 문자열이 아님(누락 포함).
 * - `envelope-id`: web→native 의 `id` 가 문자열이 아님(누락 포함).
 * - `unknown-type`: 알려진 type 분기에 해당하지 않음.
 * - `payload-missing`: 필수 payload 가 누락됨.
 * - `payload-shape`: payload 가 객체가 아님.
 * - `field-missing`: 필수 필드 누락.
 * - `field-type`: 필드 타입이 다름.
 * - `field-enum`: enum 값이 허용 집합 밖.
 */
export type BridgeValidationErrorReason =
  | 'not-object'
  | 'envelope-version'
  | 'envelope-type'
  | 'envelope-id'
  | 'unknown-type'
  | 'payload-missing'
  | 'payload-shape'
  | 'field-missing'
  | 'field-type'
  | 'field-enum';

export type BridgeValidationError = {
  /** Bridge 메시지의 type (envelope 검증 실패 등으로 미상이면 생략). */
  type?: string;
  /** 위반된 필드의 dotted path (예: `payload.deviceId`). */
  field?: string;
  /** 머신 친화적 분류 코드. */
  reason: BridgeValidationErrorReason;
  /** 사람이 읽을 수 있는 설명. 로그/에러 메시지에 그대로 사용 가능. */
  message: string;
};

export type BridgeValidationResult<T> =
  | { ok: true; message: T }
  | { ok: false; error: BridgeValidationError };

// -----------------------------------------------------------------------------
// 검증 헬퍼 (모듈 private)
// -----------------------------------------------------------------------------

const NOIPOD_KEY_VALUES = ['notify', 'write'] as const;
const WRITE_MODE_VALUES = ['auto', 'withResponse', 'withoutResponse'] as const;
const COLOR_CODE_VALUES = [0, 1, 2, 3, 4, 5, 0xff] as const;
const SESSION_PHASE_VALUES = [0, 1] as const;
const CONTROL_CMD_VALUES = [0, 1, 2] as const;
const BLE_DISCONNECT_REASON_VALUES = ['user', 'unexpected', 'retry-failed'] as const;
const BLE_ERROR_CODE_VALUES = [
  'PERMISSION_DENIED',
  'BLUETOOTH_OFF',
  'BLUETOOTH_TIMEOUT',
  'SCAN_ERROR',
  'CONNECT_FAIL',
  'CONNECT_TIMEOUT',
  'NOT_CONNECTED',
  'WRITE_FAIL',
  'NOTIFY_FAIL',
  'UNKNOWN_CHARACTERISTIC',
  'RECONNECT_FAILED',
  'HANDLER_ERROR',
] as const;
const BLE_ERROR_ACTION_VALUES = [
  'ensureReady',
  'scan',
  'connect',
  'reconnect',
  'disconnect',
  'subscribe',
  'unsubscribe',
  'write',
] as const;
const PUSH_STATUS_VALUES = ['unconfigured', 'granted', 'denied', 'unavailable'] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function makeError(
  type: string | undefined,
  reason: BridgeValidationErrorReason,
  field: string | undefined,
  message: string,
): BridgeValidationError {
  const e: BridgeValidationError = { reason, message };
  if (type !== undefined) e.type = type;
  if (field !== undefined) e.field = field;
  return e;
}

function reqString(
  p: Record<string, unknown>,
  key: string,
  type: string,
  prefix = 'payload',
): BridgeValidationError | null {
  const v = p[key];
  const field = `${prefix}.${key}`;
  if (v === undefined) return makeError(type, 'field-missing', field, `${type}: ${field} is required (string)`);
  if (typeof v !== 'string')
    return makeError(type, 'field-type', field, `${type}: ${field} must be string (got ${typeof v})`);
  return null;
}

function optString(
  p: Record<string, unknown>,
  key: string,
  type: string,
  prefix = 'payload',
): BridgeValidationError | null {
  const v = p[key];
  if (v === undefined) return null;
  if (typeof v !== 'string')
    return makeError(type, 'field-type', `${prefix}.${key}`, `${type}: ${prefix}.${key} must be string when provided`);
  return null;
}

function reqNullableString(
  p: Record<string, unknown>,
  key: string,
  type: string,
  prefix = 'payload',
): BridgeValidationError | null {
  if (!(key in p)) return makeError(type, 'field-missing', `${prefix}.${key}`, `${type}: ${prefix}.${key} is required (string|null)`);
  const v = p[key];
  if (v !== null && typeof v !== 'string')
    return makeError(type, 'field-type', `${prefix}.${key}`, `${type}: ${prefix}.${key} must be string|null`);
  return null;
}

function reqNumber(
  p: Record<string, unknown>,
  key: string,
  type: string,
  prefix = 'payload',
): BridgeValidationError | null {
  const v = p[key];
  const field = `${prefix}.${key}`;
  if (v === undefined) return makeError(type, 'field-missing', field, `${type}: ${field} is required (number)`);
  if (!isFiniteNumber(v))
    return makeError(type, 'field-type', field, `${type}: ${field} must be a finite number`);
  return null;
}

function optNumber(
  p: Record<string, unknown>,
  key: string,
  type: string,
  prefix = 'payload',
): BridgeValidationError | null {
  const v = p[key];
  if (v === undefined) return null;
  if (!isFiniteNumber(v))
    return makeError(type, 'field-type', `${prefix}.${key}`, `${type}: ${prefix}.${key} must be a finite number when provided`);
  return null;
}

function reqBoolean(
  p: Record<string, unknown>,
  key: string,
  type: string,
  prefix = 'payload',
): BridgeValidationError | null {
  const v = p[key];
  const field = `${prefix}.${key}`;
  if (v === undefined) return makeError(type, 'field-missing', field, `${type}: ${field} is required (boolean)`);
  if (typeof v !== 'boolean') return makeError(type, 'field-type', field, `${type}: ${field} must be boolean`);
  return null;
}

function reqEnum<T>(
  p: Record<string, unknown>,
  key: string,
  type: string,
  allowed: readonly T[],
  prefix = 'payload',
): BridgeValidationError | null {
  const v = p[key];
  const field = `${prefix}.${key}`;
  if (v === undefined) return makeError(type, 'field-missing', field, `${type}: ${field} is required`);
  if (!(allowed as readonly unknown[]).includes(v))
    return makeError(
      type,
      'field-enum',
      field,
      `${type}: ${field} must be one of [${allowed.map((x) => String(x)).join(', ')}] (got ${String(v)})`,
    );
  return null;
}

function optEnum<T>(
  p: Record<string, unknown>,
  key: string,
  type: string,
  allowed: readonly T[],
  prefix = 'payload',
): BridgeValidationError | null {
  const v = p[key];
  if (v === undefined) return null;
  if (!(allowed as readonly unknown[]).includes(v))
    return makeError(
      type,
      'field-enum',
      `${prefix}.${key}`,
      `${type}: ${prefix}.${key} must be one of [${allowed.map((x) => String(x)).join(', ')}] (got ${String(v)})`,
    );
  return null;
}

/** payload 가 필수인 type 의 1차 검사. payload 가 객체임을 보장하고 반환한다. */
function requirePayloadObject(
  payload: unknown,
  type: string,
):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: BridgeValidationError } {
  if (payload === undefined)
    return { ok: false, error: makeError(type, 'payload-missing', 'payload', `${type}: payload is required`) };
  if (!isPlainObject(payload))
    return { ok: false, error: makeError(type, 'payload-shape', 'payload', `${type}: payload must be a plain object`) };
  return { ok: true, payload };
}

/** payload 가 선택적인 type 의 1차 검사. 존재하면 객체여야 함. */
function optionalPayloadShape(payload: unknown, type: string): BridgeValidationError | null {
  if (payload === undefined) return null;
  if (!isPlainObject(payload))
    return makeError(type, 'payload-shape', 'payload', `${type}: payload must be a plain object when provided`);
  return null;
}

function validateDiscoverySnapshot(
  d: unknown,
  type: string,
  prefix: string,
): BridgeValidationError | null {
  if (!isPlainObject(d))
    return makeError(type, 'field-type', prefix, `${type}: ${prefix} must be an object`);
  return (
    reqString(d, 'id', type, prefix) ??
    reqNullableString(d, 'name', type, prefix) ??
    (() => {
      if (!('rssi' in d)) return makeError(type, 'field-missing', `${prefix}.rssi`, `${type}: ${prefix}.rssi is required (number|null)`);
      const r = d.rssi;
      if (r !== null && !isFiniteNumber(r))
        return makeError(type, 'field-type', `${prefix}.rssi`, `${type}: ${prefix}.rssi must be number|null`);
      return null;
    })() ??
    reqNumber(d, 'lastSeenAt', type, prefix)
  );
}

function validateTouchEvent(t: unknown, type: string, prefix: string): BridgeValidationError | null {
  if (!isPlainObject(t))
    return makeError(type, 'field-type', prefix, `${type}: ${prefix} must be an object`);
  if (t.type !== 'TOUCH')
    return makeError(type, 'field-enum', `${prefix}.type`, `${type}: ${prefix}.type must be 'TOUCH'`);
  return (
    reqNumber(t, 'tickId', type, prefix) ??
    reqNumber(t, 'pod', type, prefix) ??
    reqNumber(t, 'channel', type, prefix) ??
    reqNumber(t, 'deltaMs', type, prefix) ??
    reqBoolean(t, 'deviceDeltaValid', type, prefix)
  );
}

function validateGattCharMeta(
  c: unknown,
  type: string,
  prefix: string,
): BridgeValidationError | null {
  if (!isPlainObject(c))
    return makeError(type, 'field-type', prefix, `${type}: ${prefix} must be an object`);
  const flagKeys = [
    'isReadable',
    'isWritableWithResponse',
    'isWritableWithoutResponse',
    'isNotifiable',
    'isIndicatable',
  ] as const;
  let e = reqString(c, 'uuid', type, prefix);
  if (e) return e;
  for (const k of flagKeys) {
    e = reqBoolean(c, k, type, prefix);
    if (e) return e;
  }
  return null;
}

function validateGattServiceMeta(
  s: unknown,
  type: string,
  prefix: string,
): BridgeValidationError | null {
  if (!isPlainObject(s))
    return makeError(type, 'field-type', prefix, `${type}: ${prefix} must be an object`);
  const e = reqString(s, 'uuid', type, prefix);
  if (e) return e;
  if (!Array.isArray(s.chars))
    return makeError(type, 'field-type', `${prefix}.chars`, `${type}: ${prefix}.chars must be an array`);
  for (let i = 0; i < s.chars.length; i++) {
    const cErr = validateGattCharMeta(s.chars[i], type, `${prefix}.chars[${i}]`);
    if (cErr) return cErr;
  }
  return null;
}

function validateGattAutoSelection(
  g: unknown,
  type: string,
  prefix: string,
): BridgeValidationError | null {
  if (g === null) return null;
  if (!isPlainObject(g))
    return makeError(type, 'field-type', prefix, `${type}: ${prefix} must be object|null`);
  return (
    reqString(g, 'service', type, prefix) ??
    reqString(g, 'txCharacteristic', type, prefix) ??
    reqString(g, 'rxCharacteristic', type, prefix)
  );
}

function validateScanFilter(
  f: unknown,
  type: string,
  prefix: string,
): BridgeValidationError | null {
  if (!isPlainObject(f))
    return makeError(type, 'field-type', prefix, `${type}: ${prefix} must be an object`);
  let e = optString(f, 'namePrefix', type, prefix);
  if (e) return e;
  e = optString(f, 'nameContains', type, prefix);
  if (e) return e;
  if (f.serviceUUIDs !== undefined) {
    if (!Array.isArray(f.serviceUUIDs))
      return makeError(
        type,
        'field-type',
        `${prefix}.serviceUUIDs`,
        `${type}: ${prefix}.serviceUUIDs must be an array of strings`,
      );
    for (let i = 0; i < f.serviceUUIDs.length; i++) {
      if (typeof f.serviceUUIDs[i] !== 'string')
        return makeError(
          type,
          'field-type',
          `${prefix}.serviceUUIDs[${i}]`,
          `${type}: ${prefix}.serviceUUIDs[${i}] must be string`,
        );
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Per-type payload 검증
// -----------------------------------------------------------------------------

function validateWebToNativePayload(type: string, payload: unknown): BridgeValidationError | null {
  switch (type) {
    case 'auth.requestSession':
    case 'auth.clearSession':
    case 'ble.ensureReady':
    case 'ble.stopScan':
    case 'ble.discoverGatt':
    case 'ble.reconnect.now':
    case 'push.requestPermission':
      return optionalPayloadShape(payload, type);

    case 'auth.persistSession': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      return reqString(p, 'token', type) ?? reqString(p, 'userId', type) ?? optString(p, 'displayName', type);
    }

    case 'ble.startScan': {
      if (payload === undefined) return null;
      if (!isPlainObject(payload))
        return makeError(type, 'payload-shape', 'payload', `${type}: payload must be an object when provided`);
      if (payload.filter !== undefined) {
        const fErr = validateScanFilter(payload.filter, type, 'payload.filter');
        if (fErr) return fErr;
      }
      return optNumber(payload, 'timeoutMs', type);
    }

    case 'ble.connect': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      return reqString(r.payload, 'deviceId', type);
    }

    case 'ble.disconnect': {
      if (payload === undefined) return null;
      if (!isPlainObject(payload))
        return makeError(type, 'payload-shape', 'payload', `${type}: payload must be an object when provided`);
      return optString(payload, 'deviceId', type);
    }

    case 'ble.subscribeCharacteristic': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      return reqString(r.payload, 'subscriptionId', type) ?? reqEnum(r.payload, 'key', type, NOIPOD_KEY_VALUES);
    }

    case 'ble.unsubscribeCharacteristic': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      return reqString(r.payload, 'subscriptionId', type);
    }

    case 'ble.writeCharacteristic': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      return (
        reqEnum(r.payload, 'key', type, NOIPOD_KEY_VALUES) ??
        reqString(r.payload, 'base64Value', type) ??
        optEnum(r.payload, 'mode', type, WRITE_MODE_VALUES)
      );
    }

    case 'ble.writeLed': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      return (
        reqNumber(p, 'tickId', type) ??
        reqNumber(p, 'pod', type) ??
        reqEnum(p, 'colorCode', type, COLOR_CODE_VALUES) ??
        reqNumber(p, 'onMs', type) ??
        optNumber(p, 'flags', type) ??
        optEnum(p, 'mode', type, WRITE_MODE_VALUES)
      );
    }

    case 'ble.writeSession': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      return (
        reqNumber(p, 'bpm', type) ??
        reqNumber(p, 'level', type) ??
        reqEnum(p, 'phase', type, SESSION_PHASE_VALUES) ??
        reqNumber(p, 'durationSec', type) ??
        optNumber(p, 'flags', type)
      );
    }

    case 'ble.writeControl': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      return reqEnum(r.payload, 'cmd', type, CONTROL_CMD_VALUES);
    }

    default:
      return makeError(type, 'unknown-type', undefined, `Unknown WebToNative type: ${type}`);
  }
}

function validateNativeToWebPayload(type: string, payload: unknown): BridgeValidationError | null {
  switch (type) {
    case 'session.update': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      return (
        reqNullableString(p, 'token', type) ??
        reqNullableString(p, 'userId', type) ??
        reqNullableString(p, 'displayName', type)
      );
    }

    case 'native.ack': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      return reqString(p, 'id', type) ?? reqBoolean(p, 'ok', type) ?? optString(p, 'error', type);
    }

    case 'ble.discovery': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      if (p.device === undefined)
        return makeError(type, 'field-missing', 'payload.device', `${type}: payload.device is required`);
      return validateDiscoverySnapshot(p.device, type, 'payload.device');
    }

    case 'ble.scanState': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      return reqBoolean(r.payload, 'scanning', type);
    }

    case 'ble.connection': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      if (!('connected' in p))
        return makeError(type, 'field-missing', 'payload.connected', `${type}: payload.connected is required (object|null)`);
      if (p.connected !== null) {
        const dErr = validateDiscoverySnapshot(p.connected, type, 'payload.connected');
        if (dErr) return dErr;
      }
      return optEnum(p, 'reason', type, BLE_DISCONNECT_REASON_VALUES);
    }

    case 'ble.reconnect': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      return (
        reqString(p, 'deviceId', type) ??
        reqNumber(p, 'attempt', type) ??
        reqNumber(p, 'maxAttempts', type) ??
        optNumber(p, 'nextDelayMs', type)
      );
    }

    case 'ble.notify': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      const e =
        reqString(p, 'subscriptionId', type) ??
        reqEnum(p, 'key', type, NOIPOD_KEY_VALUES) ??
        reqString(p, 'base64Value', type);
      if (e) return e;
      if (p.touch !== undefined) return validateTouchEvent(p.touch, type, 'payload.touch');
      return null;
    }

    case 'ble.touch': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      if (p.touch === undefined)
        return makeError(type, 'field-missing', 'payload.touch', `${type}: payload.touch is required`);
      return validateTouchEvent(p.touch, type, 'payload.touch');
    }

    case 'ble.gatt': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      if (!Array.isArray(p.services))
        return makeError(type, 'field-type', 'payload.services', `${type}: payload.services must be an array`);
      for (let i = 0; i < p.services.length; i++) {
        const sErr = validateGattServiceMeta(p.services[i], type, `payload.services[${i}]`);
        if (sErr) return sErr;
      }
      if (!('selected' in p))
        return makeError(type, 'field-missing', 'payload.selected', `${type}: payload.selected is required (object|null)`);
      return validateGattAutoSelection(p.selected, type, 'payload.selected');
    }

    case 'ble.error': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      const p = r.payload;
      return (
        reqEnum(p, 'code', type, BLE_ERROR_CODE_VALUES) ??
        reqString(p, 'message', type) ??
        optString(p, 'id', type) ??
        optString(p, 'deviceId', type) ??
        optEnum(p, 'action', type, BLE_ERROR_ACTION_VALUES)
      );
    }

    case 'push.state': {
      const r = requirePayloadObject(payload, type);
      if (!r.ok) return r.error;
      return reqEnum(r.payload, 'status', type, PUSH_STATUS_VALUES) ?? optString(r.payload, 'detail', type);
    }

    default:
      return makeError(type, 'unknown-type', undefined, `Unknown NativeToWeb type: ${type}`);
  }
}

// -----------------------------------------------------------------------------
// Public 검증/가드
// -----------------------------------------------------------------------------

/**
 * Web→Native 메시지를 구조화된 결과로 검증한다.
 * envelope (`v`/`type`/`id`) 와 type 별 payload 모양을 모두 본다.
 * 실패 시 `error` 에 어떤 type/필드가 잘못됐는지 담아 돌려준다.
 */
export function validateWebToNativeMessage(raw: unknown): BridgeValidationResult<WebToNativeMessage> {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: makeError(undefined, 'not-object', undefined, 'Bridge message must be a plain object'),
    };
  }
  if (raw.v !== NATIVE_BRIDGE_VERSION) {
    return {
      ok: false,
      error: makeError(
        undefined,
        'envelope-version',
        'v',
        `envelope.v must be ${NATIVE_BRIDGE_VERSION} (got ${String(raw.v)})`,
      ),
    };
  }
  if (typeof raw.type !== 'string') {
    return {
      ok: false,
      error: makeError(undefined, 'envelope-type', 'type', 'envelope.type must be a string'),
    };
  }
  if (typeof raw.id !== 'string') {
    return {
      ok: false,
      error: makeError(raw.type, 'envelope-id', 'id', 'envelope.id must be a string for web→native messages'),
    };
  }
  const pErr = validateWebToNativePayload(raw.type, raw.payload);
  if (pErr) return { ok: false, error: pErr };
  return { ok: true, message: raw as unknown as WebToNativeMessage };
}

/**
 * Native→Web 메시지를 구조화된 결과로 검증한다.
 * Native→Web broadcast (예: `ble.discovery`) 는 envelope 의 `id` 필수가 아니므로
 * envelope 단계에서 `id` 를 검사하지 않는다 — 단, 각 type 별 payload 는 검사한다.
 */
export function validateNativeToWebMessage(raw: unknown): BridgeValidationResult<NativeToWebMessage> {
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: makeError(undefined, 'not-object', undefined, 'Bridge message must be a plain object'),
    };
  }
  if (raw.v !== NATIVE_BRIDGE_VERSION) {
    return {
      ok: false,
      error: makeError(
        undefined,
        'envelope-version',
        'v',
        `envelope.v must be ${NATIVE_BRIDGE_VERSION} (got ${String(raw.v)})`,
      ),
    };
  }
  if (typeof raw.type !== 'string') {
    return {
      ok: false,
      error: makeError(undefined, 'envelope-type', 'type', 'envelope.type must be a string'),
    };
  }
  const pErr = validateNativeToWebPayload(raw.type, raw.payload);
  if (pErr) return { ok: false, error: pErr };
  return { ok: true, message: raw as unknown as NativeToWebMessage };
}

/**
 * Boolean 가드 — `validateWebToNativeMessage` 의 결과를 boolean 으로 환원.
 * 호출측이 어떤 필드가 잘못됐는지 알아야 하면 `validateWebToNativeMessage` 사용.
 */
export function isWebToNativeMessage(raw: unknown): raw is WebToNativeMessage {
  return validateWebToNativeMessage(raw).ok;
}

/**
 * Boolean 가드 — `validateNativeToWebMessage` 의 결과를 boolean 으로 환원.
 * 호출측이 어떤 필드가 잘못됐는지 알아야 하면 `validateNativeToWebMessage` 사용.
 */
export function isNativeToWebMessage(raw: unknown): raw is NativeToWebMessage {
  return validateNativeToWebMessage(raw).ok;
}
