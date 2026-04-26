/**
 * 네이티브 네트워크 복구 브리지 dedupe/throttle 회귀 잠금.
 *
 * - 첫 NetInfo 콜백은 baseline 으로만 기록되고 발사하지 않는다.
 * - false → true 전환에서만 발사한다.
 * - true → true (이미 online 상태가 반복 보고) 는 무시.
 * - 짧은 시간 안에 깜빡인 false → true 가 여러 번 들어와도 minIntervalMs 안에는
 *   한 번만 발사한다.
 * - 간격이 지나면 다시 발사할 수 있다.
 * - `isInternetReachable === false` 면 online 으로 보지 않는다.
 * - stop 후에는 더 이상 발사하지 않고, 다시 start 할 수 있다.
 * - start 가 멱등하다 (이중 마운트에도 구독이 두 번 생기지 않음).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('react-native', () => ({}));

const posted = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));
vi.mock('../../bridge/injectToWeb', () => ({
  postNativeToWeb: vi.fn((m: Record<string, unknown>) => {
    posted.list.push(m);
  }),
  registerWebViewInjector: vi.fn(),
}));

vi.mock('@react-native-community/netinfo', () => ({
  default: { addEventListener: vi.fn() },
}));

import {
  startNetworkRecoveryBridge,
  stopNetworkRecoveryBridge,
  __resetNetworkRecoveryBridgeForTest,
} from '../networkRecoveryBridge';
import { NATIVE_BRIDGE_VERSION } from '@noilink/shared';

type Listener = (state: { isConnected: boolean | null; isInternetReachable?: boolean | null }) => void;

interface Harness {
  emit: Listener;
  unsubscribed: boolean;
  fakeNow: number;
  stop: () => void;
}

function setup(opts: { minIntervalMs?: number } = {}): Harness {
  const h: Harness = {
    emit: () => {
      throw new Error('subscribe not yet called');
    },
    unsubscribed: false,
    fakeNow: 0,
    stop: () => {},
  };
  h.stop = startNetworkRecoveryBridge({
    minIntervalMs: opts.minIntervalMs,
    now: () => h.fakeNow,
    subscribe: (listener) => {
      h.emit = listener as Listener;
      return () => {
        h.unsubscribed = true;
      };
    },
  });
  return h;
}

beforeEach(() => {
  posted.list.length = 0;
  __resetNetworkRecoveryBridgeForTest();
});

describe('startNetworkRecoveryBridge — dedupe/throttle', () => {
  it('첫 콜백은 baseline 만 기록하고 발사하지 않는다 (앱 시작 시 이미 online 인 케이스)', () => {
    const h = setup();
    h.emit({ isConnected: true, isInternetReachable: true });
    expect(posted.list).toHaveLength(0);
    h.stop();
  });

  it('false → true 전환에서 정확히 한 번 network.online 을 발사한다', () => {
    const h = setup();
    h.emit({ isConnected: false }); // baseline = offline
    h.fakeNow += 5_000;
    h.emit({ isConnected: true, isInternetReachable: true });

    expect(posted.list).toHaveLength(1);
    expect(posted.list[0]).toEqual({ v: NATIVE_BRIDGE_VERSION, type: 'network.online' });
    h.stop();
  });

  it('이미 true 인 상태에서 같은 true 가 다시 와도 무시한다 (NetInfo refresh 등)', () => {
    const h = setup();
    h.emit({ isConnected: false });
    h.fakeNow += 5_000;
    h.emit({ isConnected: true, isInternetReachable: true });
    h.fakeNow += 5_000;
    h.emit({ isConnected: true, isInternetReachable: true });
    h.fakeNow += 5_000;
    h.emit({ isConnected: true, isInternetReachable: true });

    expect(posted.list).toHaveLength(1);
    h.stop();
  });

  it('minIntervalMs 안의 false→true→false→true 깜빡임은 한 번만 발사한다', () => {
    const h = setup({ minIntervalMs: 2_000 });
    h.emit({ isConnected: false }); // baseline
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // emit #1
    h.fakeNow += 200;
    h.emit({ isConnected: false });
    h.fakeNow += 200;
    h.emit({ isConnected: true, isInternetReachable: true }); // throttled
    h.fakeNow += 200;
    h.emit({ isConnected: false });
    h.fakeNow += 200;
    h.emit({ isConnected: true, isInternetReachable: true }); // throttled

    expect(posted.list).toHaveLength(1);
    h.stop();
  });

  it('throttle 간격이 지나면 다음 false → true 전환에서 다시 발사한다', () => {
    const h = setup({ minIntervalMs: 2_000 });
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // emit #1
    h.fakeNow += 5_000;
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // emit #2

    expect(posted.list).toHaveLength(2);
    h.stop();
  });

  it('isInternetReachable === false 는 online 으로 간주하지 않는다 (captive portal 등)', () => {
    const h = setup();
    h.emit({ isConnected: false });
    h.fakeNow += 5_000;
    // Wi-Fi 는 잡혔지만 인터넷이 안 됨 → 발사 안 함
    h.emit({ isConnected: true, isInternetReachable: false });
    expect(posted.list).toHaveLength(0);

    // 그 다음 인터넷이 진짜로 들어옴 → 발사
    h.fakeNow += 1_000;
    h.emit({ isConnected: true, isInternetReachable: true });
    expect(posted.list).toHaveLength(1);
    h.stop();
  });

  it('isInternetReachable 가 null/undefined 면 isConnected 만 신뢰한다', () => {
    const h = setup();
    h.emit({ isConnected: false }); // baseline
    h.fakeNow += 5_000;
    h.emit({ isConnected: true, isInternetReachable: null });

    expect(posted.list).toHaveLength(1);
    h.stop();
  });

  it('stop 호출 후에는 unsubscribe 가 일어나고 추가 emit 이 발사로 이어지지 않는다', () => {
    const h = setup();
    h.emit({ isConnected: false });
    h.stop();

    expect(h.unsubscribed).toBe(true);

    // stop 후에도 listener 콜백이 (네이티브 race 등으로) 한 번 더 들어온다고
    // 가정해 보자 — 이미 모듈 상태가 리셋됐으므로 baseline 로 처리되거나 무시되는
    // 게 정상이다. (주의: 우리는 listener 가 더는 호출되지 않을 것을 가정하지만,
    // 안전망으로 emit 자체가 발사를 일으키지 않는지를 확인한다.)
    h.emit({ isConnected: true, isInternetReachable: true });
    expect(posted.list).toHaveLength(0);
  });

  it('stop 후 다시 start 해서 새 baseline 부터 시작할 수 있다', () => {
    const h1 = setup();
    h1.emit({ isConnected: true, isInternetReachable: true }); // baseline
    h1.stop();

    posted.list.length = 0;
    const h2 = setup();
    h2.emit({ isConnected: false }); // 새 baseline
    h2.fakeNow += 5_000;
    h2.emit({ isConnected: true, isInternetReachable: true });

    expect(posted.list).toHaveLength(1);
    h2.stop();
  });

  it('이미 실행 중일 때 다시 start 하면 새 구독을 만들지 않는다 (멱등)', () => {
    const h = setup();
    // 같은 모듈 상태에 두 번째 start
    const stop2 = startNetworkRecoveryBridge({
      now: () => h.fakeNow,
      subscribe: () => {
        throw new Error('두 번째 subscribe 가 호출되면 안 된다');
      },
    });
    expect(typeof stop2).toBe('function');

    // 첫 구독은 여전히 동작
    h.emit({ isConnected: false });
    h.fakeNow += 5_000;
    h.emit({ isConnected: true, isInternetReachable: true });
    expect(posted.list).toHaveLength(1);

    h.stop();
  });
});
