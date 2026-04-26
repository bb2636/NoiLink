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
}

const DEFAULT_MIN_INTERVAL_MS = 2000;

interface InternalState {
  unsubscribe: (() => void) | null;
  lastConnected: boolean | null;
  lastEmittedAt: number;
}

const moduleState: InternalState = {
  unsubscribe: null,
  lastConnected: null,
  lastEmittedAt: Number.NEGATIVE_INFINITY,
};

function isOnline(state: NetInfoState): boolean {
  if (state.isConnected !== true) return false;
  // `isInternetReachable` 가 명시적으로 false 일 때만 offline 으로 본다.
  // null/undefined 는 "아직 모름" 이므로 isConnected 만 신뢰한다.
  if (state.isInternetReachable === false) return false;
  return true;
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

  moduleState.lastConnected = null;
  moduleState.lastEmittedAt = Number.NEGATIVE_INFINITY;

  const sub = subscribe((state) => {
    const connected = isOnline(state);
    const prev = moduleState.lastConnected;
    moduleState.lastConnected = connected;

    // 첫 콜백은 baseline 만 기록하고 종료. (앱 시작 시 이미 online 인 경우를
    // "복구" 로 오해하지 않도록.)
    if (prev === null) return;

    // online → online: 복구 전환이 아님. 무시.
    // offline → offline: 무시.
    if (!connected) return;
    if (prev === true) return;

    // 진짜 false → true 전환. 그러나 minIntervalMs 안에 또 들어오면 합쳐서 한 번만.
    const t = now();
    if (t - moduleState.lastEmittedAt < minInterval) return;
    moduleState.lastEmittedAt = t;

    post({ v: NATIVE_BRIDGE_VERSION, type: 'network.online' });
  });

  moduleState.unsubscribe = typeof sub === 'function' ? sub : () => {};
  return stopNetworkRecoveryBridge;
}

export function stopNetworkRecoveryBridge(): void {
  if (!moduleState.unsubscribe) return;
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
  moduleState.unsubscribe = null;
  moduleState.lastConnected = null;
  moduleState.lastEmittedAt = Number.NEGATIVE_INFINITY;
}
