/**
 * 회귀 잠금: 모바일 디스패처(`dispatchWebMessage`) 가 잘못된 web→native
 * 메시지를 받았을 때의 ack 형식.
 *
 * - `validateWebToNativeMessage` 자체의 진리표는 `shared/native-web-bridge.test.ts`
 *   에서 다루고, 여기서는 그 결과를 디스패처가 어떻게 사용하는지를 잠근다.
 * - 잘못된 ble.connect(예: deviceId 누락)는:
 *     1) BleManager 에 닿지 않고 즉시 거부되어야 한다 (unknown device 로 잘못된
 *        connect 시도가 일어나는 것을 방지).
 *     2) 호출자(웹) 가 실패 사유를 식별할 수 있도록 `native.ack` 의 `error`
 *        문자열에 `ble.connect`(어떤 type 에서 깨졌는지) / `field-missing`
 *        (왜 깨졌는지) / `payload.deviceId`(어떤 필드인지) 가 포함되어야 한다.
 *
 * 이 ack 포맷이 바뀌면 `BridgeRejectedToast` 같은 사용자 안내 코드가
 * 조용히 깨질 수 있으므로 자동으로 알려지도록 잠근다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// react-native / BLE / 저장소 모킹 — 디스패처는 검증 실패 시 이 모듈들에
// 닿지 않아야 한다는 사실을 함께 검증한다.
// ---------------------------------------------------------------------------
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

const bleSpies = vi.hoisted(() => ({
  setEventHandlers: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../../ble/BleManager', () => {
  class BleManagerError extends Error {
    code: string;
    action?: string;
    deviceId?: string;
    constructor(code: string, action: string, message: string) {
      super(message);
      this.code = code;
      this.action = action;
    }
  }
  return {
    BleManagerError,
    bleManager: {
      setEventHandlers: bleSpies.setEventHandlers,
      connect: bleSpies.connect,
      // 이하 메서드는 검증 실패 경로에서는 호출되지 않아야 함
      toDiscoverySnapshot: vi.fn(),
      getLastGattDiscovery: vi.fn(),
      getNativeConnectedDevice: vi.fn(() => null),
      resolveLocator: vi.fn(),
      writeCharacteristic: vi.fn(),
      subscribeToCharacteristic: vi.fn(),
      startDeviceScan: vi.fn(),
      stopScan: vi.fn(),
      ensureReady: vi.fn(),
      disconnect: vi.fn(),
      discoverGattAuto: vi.fn(),
      triggerImmediateReconnect: vi.fn(),
    },
  };
});

vi.mock('../../auth/storage', () => ({
  clearStoredAuth: vi.fn(),
  getStoredToken: vi.fn(),
  getStoredUserDisplay: vi.fn(),
  setStoredAuth: vi.fn(),
}));

type CapturedMessage = { v: number; type: string; payload: Record<string, unknown> };
const inject = vi.hoisted(() => ({
  posted: [] as CapturedMessage[],
}));

vi.mock('../injectToWeb', () => ({
  postNativeToWeb: vi.fn((msg: CapturedMessage) => {
    inject.posted.push(msg);
  }),
  registerWebViewInjector: vi.fn(),
}));

// 모킹 후에 import (호이스팅된 vi.mock 가 먼저 적용되도록)
import { NATIVE_BRIDGE_VERSION } from '@noilink/shared';
import { dispatchWebMessage } from '../NativeBridgeDispatcher';

describe('dispatchWebMessage — 잘못된 ble.connect 회귀 잠금', () => {
  beforeEach(() => {
    inject.posted.length = 0;
    bleSpies.connect.mockReset();
  });

  it('payload.deviceId 누락 → native.ack.error 에 ble.connect / field-missing / payload.deviceId 가 모두 포함된다', async () => {
    const raw = JSON.stringify({
      v: NATIVE_BRIDGE_VERSION,
      type: 'ble.connect',
      id: 'req-deviceless',
      payload: {},
    });

    await dispatchWebMessage(raw);

    const ack = inject.posted.find((m) => m.type === 'native.ack');
    expect(ack, 'native.ack 가 반드시 회신되어야 함').toBeDefined();
    const ackPayload = ack!.payload as { id: string; ok: boolean; error?: string };
    expect(ackPayload.id).toBe('req-deviceless');
    expect(ackPayload.ok).toBe(false);

    const err = String(ackPayload.error ?? '');
    expect(err).toContain('ble.connect');
    expect(err).toContain('field-missing');
    expect(err).toContain('payload.deviceId');

    // ble.error 도 같은 detail 로 나가서 운영 콘솔에서도 식별 가능해야 한다.
    const bleErr = inject.posted.find((m) => m.type === 'ble.error');
    expect(bleErr, 'ble.error 도 같이 회신되어야 함').toBeDefined();
    const bleErrPayload = bleErr!.payload as { code: string; message: string };
    expect(bleErrPayload.code).toBe('HANDLER_ERROR');
    expect(bleErrPayload.message).toContain('ble.connect');
    expect(bleErrPayload.message).toContain('payload.deviceId');

    // 검증 실패는 BleManager 까지 절대 도달하지 않아야 한다.
    expect(bleSpies.connect).not.toHaveBeenCalled();
  });

  it('payload 자체가 누락 → ack.error 에 ble.connect / payload-missing / payload 가 포함된다', async () => {
    const raw = JSON.stringify({
      v: NATIVE_BRIDGE_VERSION,
      type: 'ble.connect',
      id: 'req-no-payload',
    });

    await dispatchWebMessage(raw);

    const ack = inject.posted.find((m) => m.type === 'native.ack');
    expect(ack).toBeDefined();
    const ackPayload = ack!.payload as { id: string; ok: boolean; error?: string };
    expect(ackPayload.ok).toBe(false);
    const err = String(ackPayload.error ?? '');
    expect(err).toContain('ble.connect');
    expect(err).toContain('payload-missing');
    expect(err).toContain('payload');
    expect(bleSpies.connect).not.toHaveBeenCalled();
  });

  it('payload.deviceId 가 숫자(잘못된 타입) → ack.error 에 ble.connect / field-type / payload.deviceId 가 포함된다', async () => {
    const raw = JSON.stringify({
      v: NATIVE_BRIDGE_VERSION,
      type: 'ble.connect',
      id: 'req-num-id',
      payload: { deviceId: 42 },
    });

    await dispatchWebMessage(raw);

    const ack = inject.posted.find((m) => m.type === 'native.ack');
    expect(ack).toBeDefined();
    const ackPayload = ack!.payload as { id: string; ok: boolean; error?: string };
    expect(ackPayload.ok).toBe(false);
    const err = String(ackPayload.error ?? '');
    expect(err).toContain('ble.connect');
    expect(err).toContain('field-type');
    expect(err).toContain('payload.deviceId');
    expect(bleSpies.connect).not.toHaveBeenCalled();
  });
});
