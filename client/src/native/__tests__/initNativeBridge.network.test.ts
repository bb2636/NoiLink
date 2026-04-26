/**
 * 네이티브 → 웹 메시지 디스패처 회귀 테스트.
 *
 * 보호 항목:
 *  - 유효한 `network.online` 메시지가 도착하면 `noilink-native-network-online`
 *    window 이벤트로 브로드캐스트된다 (큐 drain 트리거의 진입점).
 *  - 잘못된 envelope(다른 v, 객체가 아닌 값 등)은 조용히 무시된다.
 *  - 다른 type(`session.update`)은 다른 채널로만 발화되어 trigger 가
 *    오인되지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_BRIDGE_VERSION } from '@noilink/shared';
import { initNativeBridge } from '../initNativeBridge';

declare global {
  interface Window {
    __NOILINK_NATIVEBridge_ON_MESSAGE__?: (msg: unknown) => void;
    __NOILINK_NATIVE_MESSAGE_QUEUE__?: unknown[];
  }
}

function getReceiver(): (msg: unknown) => void {
  const fn = window.__NOILINK_NATIVEBridge_ON_MESSAGE__;
  if (!fn) throw new Error('initNativeBridge() 가 receiver 를 등록해야 한다');
  return fn;
}

beforeEach(() => {
  delete window.__NOILINK_NATIVEBridge_ON_MESSAGE__;
  delete window.__NOILINK_NATIVE_MESSAGE_QUEUE__;
  initNativeBridge();
});

afterEach(() => {
  delete window.__NOILINK_NATIVEBridge_ON_MESSAGE__;
  delete window.__NOILINK_NATIVE_MESSAGE_QUEUE__;
});

describe('initNativeBridge: network.online → noilink-native-network-online 이벤트', () => {
  it('유효한 network.online 메시지를 받으면 window 이벤트가 정확히 1회 발화된다', () => {
    const listener = vi.fn();
    window.addEventListener('noilink-native-network-online', listener);

    getReceiver()({ v: NATIVE_BRIDGE_VERSION, type: 'network.online' });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('noilink-native-network-online', listener);
  });

  it('payload 가 빈 객체로 와도 동일하게 발화된다 (forward-compatible)', () => {
    const listener = vi.fn();
    window.addEventListener('noilink-native-network-online', listener);

    getReceiver()({ v: NATIVE_BRIDGE_VERSION, type: 'network.online', payload: {} });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('noilink-native-network-online', listener);
  });

  it('잘못된 v 의 network.online 은 무시되어 이벤트가 발화되지 않는다', () => {
    const listener = vi.fn();
    window.addEventListener('noilink-native-network-online', listener);

    // 핸드셰이크 버전이 어긋난 메시지는 envelope guard 에서 걸러져야 한다.
    getReceiver()({ v: 999, type: 'network.online' });
    getReceiver()({ type: 'network.online' });
    getReceiver()(null);
    getReceiver()('network.online');

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('noilink-native-network-online', listener);
  });

  it('다른 native 메시지 type 은 network-online 채널을 깨우지 않는다', () => {
    const listener = vi.fn();
    window.addEventListener('noilink-native-network-online', listener);

    // session.update 는 자기 채널로만 가야 한다 — 잘못된 trigger 로 큐 drain 이 발생하면 안 된다.
    getReceiver()({
      v: NATIVE_BRIDGE_VERSION,
      type: 'session.update',
      payload: { token: null, userId: null, displayName: null },
    });

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('noilink-native-network-online', listener);
  });

  it('네이티브가 핸드셰이크 전에 큐로 보낸 network.online 도 부트 시점에 일괄 발화된다', () => {
    // initNativeBridge 가 등록되기 전에 네이티브가 메시지를 큐로 미리 쌓아둔 상황.
    delete window.__NOILINK_NATIVEBridge_ON_MESSAGE__;
    window.__NOILINK_NATIVE_MESSAGE_QUEUE__ = [
      { v: NATIVE_BRIDGE_VERSION, type: 'network.online' },
      { v: NATIVE_BRIDGE_VERSION, type: 'network.online' },
    ];

    const listener = vi.fn();
    window.addEventListener('noilink-native-network-online', listener);

    initNativeBridge();

    // 큐에 있던 두 건 모두 디스패치되어야 한다 (중복 흡수는 상위 throttle 가드 책임).
    expect(listener).toHaveBeenCalledTimes(2);
    expect(window.__NOILINK_NATIVE_MESSAGE_QUEUE__).toEqual([]);

    window.removeEventListener('noilink-native-network-online', listener);
  });
});
