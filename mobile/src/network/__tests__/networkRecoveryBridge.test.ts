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
 * - throttle 윈도우 안에 누락된 false → true 마지막 상태는 윈도우 만료 직후
 *   정확히 한 번 deferred emit 으로 전달되고, 그 사이 offline 으로 돌아가면
 *   취소된다.
 * - 매 발사 payload 에 진단 카운터 (path / immediateFires / deferredFires /
 *   deferredCancels) 가 동봉된다 — 운영 로그에서 hole-closer 발사 빈도를
 *   추적하는 단일 소스. 카운터는 모듈 시작 시 0 으로 초기화된다.
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
  getNetworkRecoveryBridgeCounters,
  __resetNetworkRecoveryBridgeForTest,
} from '../networkRecoveryBridge';
import { NATIVE_BRIDGE_VERSION } from '@noilink/shared';

type Listener = (state: { isConnected: boolean | null; isInternetReachable?: boolean | null }) => void;

interface FakeTimer {
  id: number;
  cb: () => void;
  fireAt: number;
  cancelled: boolean;
}

interface Harness {
  emit: Listener;
  unsubscribed: boolean;
  fakeNow: number;
  /** 시간을 ms 만큼 진행시키며 그 사이 만료된 deferred 타이머를 순서대로 발사한다. */
  advance: (ms: number) => void;
  /** 현재 살아있는 deferred 타이머 수. */
  pendingTimers: () => number;
  stop: () => void;
}

function setup(opts: { minIntervalMs?: number } = {}): Harness {
  const timers: FakeTimer[] = [];
  let nextId = 1;

  const h: Harness = {
    emit: () => {
      throw new Error('subscribe not yet called');
    },
    unsubscribed: false,
    fakeNow: 0,
    advance: (ms: number) => {
      const target = h.fakeNow + ms;
      // 만료 순서대로 발사. 콜백이 새 타이머를 만들 수도 있으므로 루프.
      for (;;) {
        const due = timers
          .filter((t) => !t.cancelled && t.fireAt <= target)
          .sort((a, b) => a.fireAt - b.fireAt)[0];
        if (!due) break;
        h.fakeNow = due.fireAt;
        due.cancelled = true;
        due.cb();
      }
      h.fakeNow = target;
    },
    pendingTimers: () => timers.filter((t) => !t.cancelled).length,
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
    setTimer: (cb, ms) => {
      const id = nextId++;
      timers.push({ id, cb, fireAt: h.fakeNow + ms, cancelled: false });
      return id;
    },
    clearTimer: (handle) => {
      const t = timers.find((x) => x.id === handle);
      if (t) t.cancelled = true;
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
    expect(posted.list[0]).toEqual({
      v: NATIVE_BRIDGE_VERSION,
      type: 'network.online',
      payload: { path: 'immediate', immediateFires: 1, deferredFires: 0, deferredCancels: 0 },
    });
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
    h.emit({ isConnected: false }); // 다시 offline → deferred 취소
    h.fakeNow += 200;
    h.emit({ isConnected: true, isInternetReachable: true }); // throttled (재예약)
    h.fakeNow += 200;
    h.emit({ isConnected: false }); // 마지막은 offline → deferred 취소

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

describe('startNetworkRecoveryBridge — throttle 윈도우 만료 후 deferred emit', () => {
  it('throttle 로 누락된 마지막 false → true 는 윈도우 만료 직후 한 번 더 발사된다', () => {
    const h = setup({ minIntervalMs: 2_000 });
    h.emit({ isConnected: false }); // baseline
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // emit #1 @ t=100
    expect(posted.list).toHaveLength(1);

    // 200ms 뒤 깜빡임 — throttle 안 (100 → 500, lastEmittedAt=100, interval 2000)
    h.fakeNow += 200;
    h.emit({ isConnected: false });
    h.fakeNow += 200;
    h.emit({ isConnected: true, isInternetReachable: true }); // throttled, deferred 예약

    // 윈도우 만료까지는 발사되지 않음
    expect(posted.list).toHaveLength(1);
    expect(h.pendingTimers()).toBe(1);

    // 윈도우 끝 직후로 시간 진행
    h.advance(5_000);

    // deferred 가 정확히 한 번 발사 — payload 의 path 는 'deferred' 로,
    // 카운터는 immediateFires=1 (앞선 emit #1) + deferredFires=1 (지금) 로 와야 한다.
    // deferredCancels 는 immediate fire 직전 정리에서 0→0 (예약된 게 없었음) 이고,
    // 이번 deferred 콜백 내부에서는 cancel 이 발생하지 않았으므로 0 그대로.
    expect(posted.list).toHaveLength(2);
    expect(posted.list[1]).toEqual({
      v: NATIVE_BRIDGE_VERSION,
      type: 'network.online',
      payload: { path: 'deferred', immediateFires: 1, deferredFires: 1, deferredCancels: 0 },
    });
    expect(h.pendingTimers()).toBe(0);
    h.stop();
  });

  it('윈도우 안에서 다시 offline 으로 돌아가면 deferred emit 은 취소되어 발사되지 않는다', () => {
    const h = setup({ minIntervalMs: 2_000 });
    h.emit({ isConnected: false }); // baseline
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // emit #1
    expect(posted.list).toHaveLength(1);

    h.fakeNow += 200;
    h.emit({ isConnected: false });
    h.fakeNow += 200;
    h.emit({ isConnected: true, isInternetReachable: true }); // throttled, deferred 예약
    expect(h.pendingTimers()).toBe(1);

    // 윈도우 만료 전에 다시 offline → deferred 취소되어야 함
    h.fakeNow += 100;
    h.emit({ isConnected: false });
    expect(h.pendingTimers()).toBe(0);

    // 시간을 진행해도 더 이상 발사되지 않는다
    h.advance(10_000);
    expect(posted.list).toHaveLength(1);
    h.stop();
  });

  it('윈도우 안에서 false→true 가 여러 번 깜빡여도 deferred emit 은 한 번뿐이다', () => {
    const h = setup({ minIntervalMs: 2_000 });
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // emit #1 @ t=100

    // 윈도우 안 (lastEmittedAt=100, interval=2000 → 만료 t=2100) 의 여러 깜빡임
    for (let i = 0; i < 4; i += 1) {
      h.fakeNow += 100;
      h.emit({ isConnected: false });
      h.fakeNow += 100;
      h.emit({ isConnected: true, isInternetReachable: true });
    }
    // 마지막 상태는 online → deferred 한 개가 살아있어야 함
    expect(h.pendingTimers()).toBe(1);
    expect(posted.list).toHaveLength(1);

    h.advance(5_000);

    // 정확히 한 번만 추가 발사
    expect(posted.list).toHaveLength(2);
    expect(h.pendingTimers()).toBe(0);
    h.stop();
  });

  it('deferred 발사 후에도 다음 throttle cycle 에서 또 deferred 를 예약할 수 있다', () => {
    const h = setup({ minIntervalMs: 2_000 });
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // emit #1 @ t=100

    h.fakeNow += 200; // t=300
    h.emit({ isConnected: false });
    h.fakeNow += 200; // t=500
    h.emit({ isConnected: true, isInternetReachable: true }); // deferred #1 예약 @ fireAt=2100
    h.advance(2_000); // → fakeNow=2500, deferred #1 발사 → emit #2 @ t=2100, lastEmittedAt=2100
    expect(posted.list).toHaveLength(2);

    // 다음 깜빡임 사이클: lastEmittedAt=2100, 윈도우는 t=4100 까지.
    // t=2500 에서 offline, t=2600 에서 online → 500ms < 2000 → throttled, deferred #2 예약.
    h.emit({ isConnected: false });
    h.fakeNow += 100; // t=2600
    h.emit({ isConnected: true, isInternetReachable: true }); // throttled, deferred #2 예약
    expect(h.pendingTimers()).toBe(1);
    h.advance(5_000); // deferred #2 발사 → emit #3
    expect(posted.list).toHaveLength(3);
    h.stop();
  });

  it('stop 호출 시 예약된 deferred emit 도 취소된다', () => {
    const h = setup({ minIntervalMs: 2_000 });
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // emit #1
    h.fakeNow += 200;
    h.emit({ isConnected: false });
    h.fakeNow += 200;
    h.emit({ isConnected: true, isInternetReachable: true }); // deferred 예약
    expect(h.pendingTimers()).toBe(1);

    h.stop();
    expect(h.pendingTimers()).toBe(0);

    // 시간을 진행해도 발사되지 않는다
    h.advance(10_000);
    expect(posted.list).toHaveLength(1);
  });

  it('stop 직후 race 로 deferred 콜백이 늦게 실행돼도 발사하지 않는다', () => {
    // 이 케이스는 clearTimer 가 약간 늦게 처리되는 호스트(예: 일부 RN 환경)에서
    // 이미 발사 예약된 콜백이 그대로 실행될 수 있는 상황을 가정한다.
    const timers: Array<{ cb: () => void; cancelled: boolean }> = [];
    let posted2: Array<Record<string, unknown>> = [];
    posted.list.length = 0;

    const stop = startNetworkRecoveryBridge({
      minIntervalMs: 2_000,
      now: () => 0,
      subscribe: (listener) => {
        listener({ isConnected: false, isInternetReachable: null } as never);
        listener({ isConnected: true, isInternetReachable: true } as never);
        // throttle 안의 두 번째 false→true 를 하나 더 보내 deferred 를 예약시킨다.
        listener({ isConnected: false, isInternetReachable: null } as never);
        listener({ isConnected: true, isInternetReachable: true } as never);
        return () => {};
      },
      post: (m) => {
        posted2.push(m as Record<string, unknown>);
      },
      setTimer: (cb) => {
        const t = { cb, cancelled: false };
        timers.push(t);
        return t;
      },
      clearTimer: (h) => {
        // 일부러 cancelled 만 표시 — 이후 강제로 cb 를 호출해본다.
        (h as { cancelled: boolean }).cancelled = true;
      },
    });

    expect(posted2).toHaveLength(1);
    // 호스트가 stop 시점에 clearTimer 를 호출하지만, 우리가 가진 cb 참조는
    // 살아있으므로 강제로 실행해본다 (race 시뮬레이션).
    stop();
    for (const t of timers) {
      // cancelled 표시와 무관하게 강제로 실행 — race 시 발사 가드가 작동해야 함
      t.cb();
    }
    // stop 이후이므로 발사하지 않아야 함
    expect(posted2).toHaveLength(1);
  });
});

describe('startNetworkRecoveryBridge — 진단 카운터 (hole-closer 발사 빈도 추적)', () => {
  it('immediate 발사가 누적되어 매 payload 의 immediateFires 와 동일하게 흐른다', () => {
    const h = setup({ minIntervalMs: 1_000 });
    h.emit({ isConnected: false }); // baseline
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // immediate #1
    h.fakeNow += 5_000;
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // immediate #2
    h.fakeNow += 5_000;
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // immediate #3

    expect(posted.list).toHaveLength(3);
    expect(posted.list[0]).toMatchObject({
      payload: { path: 'immediate', immediateFires: 1, deferredFires: 0 },
    });
    expect(posted.list[1]).toMatchObject({
      payload: { path: 'immediate', immediateFires: 2, deferredFires: 0 },
    });
    expect(posted.list[2]).toMatchObject({
      payload: { path: 'immediate', immediateFires: 3, deferredFires: 0 },
    });
    expect(getNetworkRecoveryBridgeCounters()).toEqual({
      immediateFires: 3,
      deferredFires: 0,
      deferredCancels: 0,
    });
    h.stop();
  });

  it('deferred 발사 카운터는 throttle 윈도우 hole 을 한 번 닫을 때마다 1 씩 오른다', () => {
    const h = setup({ minIntervalMs: 2_000 });
    // cycle 1: immediate #1 (t=100) → throttle 안 깜빡임 → deferred #1 발사 (t=2100)
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // immediate #1
    h.fakeNow += 200;
    h.emit({ isConnected: false });
    h.fakeNow += 200;
    h.emit({ isConnected: true, isInternetReachable: true }); // deferred 예약 (fireAt=2100)
    h.advance(1_700); // h.fakeNow → 2100, deferred #1 발사 (lastEmittedAt=2100)

    // cycle 2: 새 throttle 윈도우(만료 t=4100) 안에서 다시 깜빡 → deferred #2
    // advance 직후 h.fakeNow=2100 → 100ms 뒤 offline, 200ms 뒤 online 으로
    // 윈도우 안에서 hole 을 한 번 더 만든다.
    h.fakeNow += 100;
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // deferred 예약 (fireAt=4100)
    h.advance(2_000); // → deferred #2 발사

    expect(posted.list).toHaveLength(3);
    expect(posted.list[0]).toMatchObject({
      payload: { path: 'immediate', immediateFires: 1, deferredFires: 0 },
    });
    expect(posted.list[1]).toMatchObject({
      payload: { path: 'deferred', immediateFires: 1, deferredFires: 1 },
    });
    expect(posted.list[2]).toMatchObject({
      payload: { path: 'deferred', immediateFires: 1, deferredFires: 2 },
    });
    expect(getNetworkRecoveryBridgeCounters()).toMatchObject({
      immediateFires: 1,
      deferredFires: 2,
    });
    h.stop();
  });

  it('윈도우 안에서 다시 offline 이 되어 deferred 가 취소되면 deferredCancels 가 증가한다', () => {
    const h = setup({ minIntervalMs: 2_000 });
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // immediate #1
    h.fakeNow += 200;
    h.emit({ isConnected: false });
    h.fakeNow += 200;
    h.emit({ isConnected: true, isInternetReachable: true }); // deferred 예약
    h.fakeNow += 100;
    h.emit({ isConnected: false }); // ← 취소: deferredCancels=1

    // 시간이 지나도 deferred 는 발사되지 않으므로 발사 카운터는 그대로.
    h.advance(10_000);
    expect(posted.list).toHaveLength(1);
    expect(getNetworkRecoveryBridgeCounters()).toEqual({
      immediateFires: 1,
      deferredFires: 0,
      deferredCancels: 1,
    });
    h.stop();
  });

  it('deferredCancels 가 누적되어 그 이후의 immediate 발사 payload 에 반영된다', () => {
    const h = setup({ minIntervalMs: 2_000 });
    // 시나리오: 한 번의 throttle cycle 에서 deferred 가 예약됐다가 offline 으로
    // 취소되고 (deferredCancels=1), 그 뒤 다음 false→true 전환이 throttle 밖에서
    // 일어나 immediate 로 발사되면 그 payload 의 deferredCancels 에 누적값이
    // 그대로 실려 흘러간다 — 운영 로그에서 cancel 빈도를 immediate 발사와 함께
    // 한눈에 보기 위함.
    h.emit({ isConnected: false });
    h.fakeNow += 100;
    h.emit({ isConnected: true, isInternetReachable: true }); // immediate #1 @ t=100
    h.fakeNow += 200; // t=300
    h.emit({ isConnected: false });
    h.fakeNow += 200; // t=500
    h.emit({ isConnected: true, isInternetReachable: true }); // deferred 예약 (만료 t=2100)
    expect(h.pendingTimers()).toBe(1);

    // 윈도우가 충분히 지났지만 deferred 타이머는 advance 없이 발사 안 됨.
    h.fakeNow = 10_000;
    h.emit({ isConnected: false });
    h.fakeNow += 100; // t=10_100
    h.emit({ isConnected: true, isInternetReachable: true }); // immediate #2 — 살아있던 deferred 를 정리하며 발사

    // immediate #2 의 payload 에는 deferredCancels=1 이 반영되어 있어야 한다.
    expect(posted.list).toHaveLength(2);
    expect(posted.list[1]).toMatchObject({
      payload: {
        path: 'immediate',
        immediateFires: 2,
        deferredFires: 0,
        deferredCancels: 1,
      },
    });
    h.stop();
  });

  it('start 가 카운터를 0 으로 초기화하므로 stop → start 후 새 세션은 즉시 카운터 1 부터 시작한다', () => {
    const h1 = setup({ minIntervalMs: 1_000 });
    h1.emit({ isConnected: false });
    h1.fakeNow += 100;
    h1.emit({ isConnected: true, isInternetReachable: true }); // immediate #1
    expect(posted.list).toHaveLength(1);
    expect(getNetworkRecoveryBridgeCounters()).toMatchObject({ immediateFires: 1 });

    h1.stop();
    // stop 직후 카운터는 0 으로 정리되어 있다 (모듈이 죽은 동안 노출되는 값은 의미 없음).
    expect(getNetworkRecoveryBridgeCounters()).toEqual({
      immediateFires: 0,
      deferredFires: 0,
      deferredCancels: 0,
    });

    posted.list.length = 0;
    const h2 = setup({ minIntervalMs: 1_000 });
    h2.emit({ isConnected: false });
    h2.fakeNow += 100;
    h2.emit({ isConnected: true, isInternetReachable: true });

    expect(posted.list[0]).toMatchObject({
      payload: { path: 'immediate', immediateFires: 1, deferredFires: 0, deferredCancels: 0 },
    });
    h2.stop();
  });

  it('웹 측 진단 로그를 위해 path 와 카운터가 모두 같은 payload 안에 들어 있다 (forward-compatible 형태)', () => {
    // 운영 회수 경로는 매 발사 payload 한 줄 (`[network-online] path=... immediate=N
    // deferred=N cancelled=N`) 을 만든다. payload 모양이 깨지면 로그 라인이 비어
    // 운영 데이터가 통째로 누락되므로, 4 개 키가 모두 존재하는지 회귀로 잠근다.
    const h = setup({ minIntervalMs: 500 });
    h.emit({ isConnected: false });
    h.fakeNow += 50;
    h.emit({ isConnected: true, isInternetReachable: true });

    expect(posted.list).toHaveLength(1);
    const payload = (posted.list[0] as { payload?: Record<string, unknown> }).payload;
    expect(payload).toBeDefined();
    expect(payload).toMatchObject({
      path: 'immediate',
      immediateFires: 1,
      deferredFires: 0,
      deferredCancels: 0,
    });
    // 누락 회귀 잠금 — 키 자체의 존재.
    expect(Object.keys(payload!).sort()).toEqual([
      'deferredCancels',
      'deferredFires',
      'immediateFires',
      'path',
    ]);
    h.stop();
  });

  it('getNetworkRecoveryBridgeCounters: 미시작 상태에서는 모두 0 이다 (회귀: 누적값 leak 방지)', () => {
    expect(getNetworkRecoveryBridgeCounters()).toEqual({
      immediateFires: 0,
      deferredFires: 0,
      deferredCancels: 0,
    });
  });
});
