/**
 * 네이티브 셸이 OS 단의 네트워크 복구를 감지해 활성 WebView 에 `network.online`
 * 메시지를 postMessage 하는 모듈.
 *
 * 배경:
 *  - WebView 안의 브라우저 `online` 이벤트는 모바일/WebView 환경에서 신뢰성이 낮을
 *    수 있다 (지연되거나 누락). 그러면 결과 전송 큐의 즉시 drain 이 다음 앱 진입까지
 *    미뤄진다.
 *  - React Native 셸은 NetInfo 로 OS 단 네트워크 상태 변화를 직접 받을 수 있으므로,
 *    온라인 복구 신호가 들어오면 활성 WebView 에 별도 채널로 알린다.
 *
 * 정책 (네이티브 측 dedupe/throttle):
 *  - 첫 NetInfo 콜백은 "현재 상태 baseline" 으로만 기록하고 발사하지 않는다
 *    (앱 시작 시 이미 온라인인 경우 false → true 가 아니므로 복구가 아니다).
 *  - 이후 `false → true` 전환에서만 발사한다. 같은 online 상태가 반복 보고되어도
 *    무시한다.
 *  - 짧은 시간 내에 offline ↔ online 이 여러 번 깜빡여도 minIntervalMs 안에는
 *    한 번만 발사한다 (브리지 트래픽 자체를 줄이는 것이 목표; 웹 측에는 별도의
 *    `MIN_DRAIN_INTERVAL_MS` throttle 이 최종 보호선으로 작동한다).
 *  - `isInternetReachable === false` 이면 online 으로 간주하지 않는다 (Wi-Fi 는
 *    잡혔지만 인터넷이 안 되는 captive portal/혼잡 상태).
 *  - throttle 로 누락된 false → true 전환이 있으면 윈도우가 끝난 직후 단 한 번
 *    deferred emit 을 예약해 "마지막 복구 상태" 를 반드시 한 번 더 흘려보낸다.
 *    이 사이에 사용자가 다시 offline 으로 돌아가면 deferred emit 은 취소된다.
 *    (다른 트리거 — 브라우저 online / visibility / 앱 진입 — 가 모두 누락된
 *    환경에서 마지막 복구 신호가 모듈 상태 안에만 갇히는 hole 을 닫기 위함.)
 *
 * 멱등성:
 *  - `startNetworkRecoveryBridge` 가 이미 실행 중이면 새 구독을 만들지 않고
 *    기존 stop 함수를 그대로 돌려준다 (StrictMode 등으로 effect 가 두 번 실행되어도
 *    안전).
 */
import NetInfo, {
  type NetInfoState,
  type NetInfoSubscription,
} from '@react-native-community/netinfo';
import { NATIVE_BRIDGE_VERSION } from '@noilink/shared';
import { postNativeToWeb } from '../bridge/injectToWeb';

export interface NetworkRecoveryBridgeOptions {
  /**
   * 두 발사 사이 최소 간격 (ms). 기본 2000ms.
   *
   * 웹 측 `MIN_DRAIN_INTERVAL_MS` (30s) 가 cycle 폭주를 막는 최종 보호선이므로
   * 네이티브는 의도적으로 더 짧게 잡아 "정말 짧은 시간 안의 connectivity 잡음"만
   * 흡수한다. 그래야 온라인 복구가 늦게나마 한 번 더 들어왔을 때도 웹 측 가드를
   * 통과시켜 다른 트리거(mount/visibility) 가 놓친 케이스를 살릴 수 있다.
   */
  minIntervalMs?: number;
  /** 시간 함수 (테스트 주입용). 기본 `Date.now`. */
  now?: () => number;
  /** NetInfo 구독 함수 (테스트 주입용). */
  subscribe?: (listener: (state: NetInfoState) => void) => NetInfoSubscription;
  /** 발사 함수 (테스트 주입용). 기본 `postNativeToWeb`. */
  post?: typeof postNativeToWeb;
  /** setTimeout 주입 (테스트용). 기본 글로벌 setTimeout. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  /** clearTimeout 주입 (테스트용). 기본 글로벌 clearTimeout. */
  clearTimer?: (handle: unknown) => void;
}

const DEFAULT_MIN_INTERVAL_MS = 2000;

interface InternalState {
  unsubscribe: (() => void) | null;
  lastConnected: boolean | null;
  lastEmittedAt: number;
  /**
   * throttle 윈도우 끝에서 한 번만 마지막 복구 상태를 더 흘려보내기 위한 취소 함수.
   * null 이면 예약된 deferred emit 이 없다.
   */
  cancelDeferred: (() => void) | null;
}

const moduleState: InternalState = {
  unsubscribe: null,
  lastConnected: null,
  lastEmittedAt: Number.NEGATIVE_INFINITY,
  cancelDeferred: null,
};

function isOnline(state: NetInfoState): boolean {
  if (state.isConnected !== true) return false;
  // `isInternetReachable` 가 명시적으로 false 일 때만 offline 으로 본다.
  // null/undefined 는 "아직 모름" 이므로 isConnected 만 신뢰한다.
  if (state.isInternetReachable === false) return false;
  return true;
}

function clearDeferred(): void {
  if (!moduleState.cancelDeferred) return;
  try {
    moduleState.cancelDeferred();
  } catch (e) {
    console.warn('[NoiLink network] deferred cancel warn', e);
  }
  moduleState.cancelDeferred = null;
}

/**
 * 네이티브 네트워크 복구 브리지를 시작한다. 반환값은 stop 함수.
 *
 * 멱등 — 이미 실행 중이면 같은 stop 함수를 돌려준다.
 */
export function startNetworkRecoveryBridge(
  opts: NetworkRecoveryBridgeOptions = {}
): () => void {
  if (moduleState.unsubscribe) {
    return stopNetworkRecoveryBridge;
  }

  const now = opts.now ?? Date.now;
  const minInterval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const subscribe = opts.subscribe ?? NetInfo.addEventListener;
  const post = opts.post ?? postNativeToWeb;
  const setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  moduleState.lastConnected = null;
  moduleState.lastEmittedAt = Number.NEGATIVE_INFINITY;
  moduleState.cancelDeferred = null;

  const fire = (): void => {
    moduleState.lastEmittedAt = now();
    post({ v: NATIVE_BRIDGE_VERSION, type: 'network.online' });
  };

  const sub = subscribe((state) => {
    const connected = isOnline(state);
    const prev = moduleState.lastConnected;
    moduleState.lastConnected = connected;

    // 첫 콜백은 baseline 만 기록하고 종료. (앱 시작 시 이미 online 인 경우를
    // "복구" 로 오해하지 않도록.)
    if (prev === null) return;

    if (!connected) {
      // 다시 offline 으로 돌아갔다면, throttle 로 미뤄둔 마지막 복구 신호를
      // 더 보낼 이유가 없다. 예약된 deferred emit 을 취소.
      clearDeferred();
      return;
    }

    // online → online: 복구 전환이 아님. 무시 (단, 이미 예약된 deferred 는 유지).
    if (prev === true) return;

    // 진짜 false → true 전환.
    const t = now();
    if (t - moduleState.lastEmittedAt < minInterval) {
      // throttle 윈도우 안에 들어왔다. 이미 deferred 가 예약돼 있다면 그대로 두고
      // (같은 만료 시점), 없으면 윈도우 끝 직후 한 번 발사하도록 예약.
      if (moduleState.cancelDeferred) return;
      const wait = Math.max(0, minInterval - (t - moduleState.lastEmittedAt));
      const handle = setTimer(() => {
        // 타이머 발사 시점에 우리는 더 이상 예약 상태가 아니다.
        moduleState.cancelDeferred = null;
        // 발사 직전 한 번 더 확인: 그 사이에 다시 offline 으로 돌아갔거나
        // 브리지가 stop 됐다면 발사하지 않는다.
        if (!moduleState.unsubscribe) return;
        if (moduleState.lastConnected !== true) return;
        fire();
      }, wait);
      moduleState.cancelDeferred = () => clearTimer(handle);
      return;
    }

    // 정상 발사. 혹시 남아있던 deferred 가 있다면 정리 (이중 발사 방지).
    clearDeferred();
    fire();
  });

  moduleState.unsubscribe = typeof sub === 'function' ? sub : () => {};
  return stopNetworkRecoveryBridge;
}

export function stopNetworkRecoveryBridge(): void {
  if (!moduleState.unsubscribe) return;
  clearDeferred();
  try {
    moduleState.unsubscribe();
  } catch (e) {
    console.warn('[NoiLink network] unsubscribe warn', e);
  }
  moduleState.unsubscribe = null;
  moduleState.lastConnected = null;
  moduleState.lastEmittedAt = Number.NEGATIVE_INFINITY;
}

/** 테스트 전용 — 모듈 상태를 리셋한다. */
export function __resetNetworkRecoveryBridgeForTest(): void {
  if (moduleState.cancelDeferred) {
    try {
      moduleState.cancelDeferred();
    } catch {
      // ignore
    }
  }
  moduleState.unsubscribe = null;
  moduleState.lastConnected = null;
  moduleState.lastEmittedAt = Number.NEGATIVE_INFINITY;
  moduleState.cancelDeferred = null;
}
