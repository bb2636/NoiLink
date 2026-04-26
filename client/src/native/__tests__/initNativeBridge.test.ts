/**
 * 회귀 잠금: 웹 수신기(`onIncomingFromNative`)가 잘못된 native→web
 * 메시지를 받았을 때의 정책.
 *
 * - `validateNativeToWebMessage` 자체의 진리표는 `shared/native-web-bridge.test.ts`
 *   에서 다루고, 여기서는 그 결과를 클라이언트가 어떻게 사용하는지를 잠근다.
 * - 잘못된 ble.notify(필수 필드 누락)는:
 *     1) 어떤 화면도 깨우면 안 되므로 `noilink-native-bridge` CustomEvent 가
 *        발사되지 않아야 한다 (BLE 훅이 잘못된 데이터로 살아나는 것 방지).
 *     2) 운영 디버깅을 위해 `console.warn` 으로 거부 사실은 남겨야 한다.
 *
 * 이 두 동작은 silent drop / loud crash 의 어느 쪽으로든 변경되면 사용자
 * 영향이 큰 회귀이므로 자동 테스트로 잠근다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NATIVE_BRIDGE_VERSION } from '@noilink/shared';
import { initNativeBridge } from '../initNativeBridge';

describe('onIncomingFromNative — 잘못된 ble.notify 회귀 잠금', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.__NOILINK_NATIVE_MESSAGE_QUEUE__ = [];
    delete (window as unknown as { __NOILINK_NATIVEBridge_ON_MESSAGE__?: unknown })
      .__NOILINK_NATIVEBridge_ON_MESSAGE__;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function getReceiver(): (msg: unknown) => void {
    initNativeBridge();
    const fn = window.__NOILINK_NATIVEBridge_ON_MESSAGE__;
    if (typeof fn !== 'function') throw new Error('receiver not registered');
    return fn;
  }

  it('subscriptionId 누락 ble.notify → noilink-native-bridge 가 발사되지 않고 console.warn 만 찍힌다', () => {
    const receiver = getReceiver();

    const dispatched: Event[] = [];
    const listener = (e: Event) => dispatched.push(e);
    window.addEventListener('noilink-native-bridge', listener);

    try {
      receiver({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.notify',
        payload: { key: 'notify', base64Value: 'AAAA' },
      });
    } finally {
      window.removeEventListener('noilink-native-bridge', listener);
    }

    expect(dispatched).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    const rejectCall = warnSpy.mock.calls.find((args) =>
      args.some((a) => typeof a === 'string' && a.includes('reject'))
    );
    expect(rejectCall).toBeDefined();
  });

  it('base64Value 가 숫자(잘못된 타입) → noilink-native-bridge 가 발사되지 않는다', () => {
    const receiver = getReceiver();
    const dispatched: Event[] = [];
    const listener = (e: Event) => dispatched.push(e);
    window.addEventListener('noilink-native-bridge', listener);

    try {
      receiver({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.notify',
        payload: { subscriptionId: 's-1', key: 'notify', base64Value: 42 },
      });
    } finally {
      window.removeEventListener('noilink-native-bridge', listener);
    }

    expect(dispatched).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('정상 ble.notify 는 noilink-native-bridge CustomEvent 로 정확히 1회 발사된다 (대조군)', () => {
    const receiver = getReceiver();
    const dispatched: CustomEvent[] = [];
    const listener = (e: Event) => dispatched.push(e as CustomEvent);
    window.addEventListener('noilink-native-bridge', listener);

    try {
      receiver({
        v: NATIVE_BRIDGE_VERSION,
        type: 'ble.notify',
        payload: { subscriptionId: 's-1', key: 'notify', base64Value: 'AAAA' },
      });
    } finally {
      window.removeEventListener('noilink-native-bridge', listener);
    }

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].detail).toMatchObject({
      type: 'ble.notify',
      payload: { subscriptionId: 's-1', key: 'notify', base64Value: 'AAAA' },
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
