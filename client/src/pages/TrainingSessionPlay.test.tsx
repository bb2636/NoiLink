/**
 * BLE 단절·재연결 분기 회귀 테스트 (TrainingSessionPlay)
 *
 * 보호 대상 정책 (TrainingSessionPlay.tsx의 BLE 그레이스 useEffect):
 *   1. `ble.connection { connected: null, reason: 'unexpected' }` 가 오면 그레이스 기간(8s)
 *      동안 화면을 유지하고 "기기 연결 회복 중…" 배너를 띄운다.
 *      그 안에 `connected != null` 가 다시 오면 배너가 사라지고 트레이닝이 계속 된다
 *      (목록 화면으로 이동하지 않는다).
 *   2. 그레이스 기간 안에 재연결이 없으면 'ble-disconnect' 사유로 목록 화면(/training)으로
 *      복귀한다.
 *   3. `reason: 'retry-failed'` 가 오면 그레이스를 기다리지 않고 즉시 종료한다.
 *   4. `reason: 'user'` (사용자가 명시적으로 해제) 는 무시한다 — 배너도 띄우지 않고
 *      종료도 하지 않는다.
 *
 * 이 분기들은 TrainingSessionPlay 의 BLE useEffect 안에서만 결정되므로,
 * 엔진/네이티브 브리지/서브미트 유틸/레이아웃은 테스트 친화적으로 모킹하고
 * `noilink-native-bridge` CustomEvent 만 직접 발사해 시나리오를 재현한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// React 18 의 act() 가 jsdom 환경에서 정상 동작하도록 플래그를 켠다.
// (vitest jsdom 기본 환경은 IS_REACT_ACT_ENVIRONMENT 가 꺼져 있어 경고가 발생한다.)
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  DEFAULT_BLE_STABILITY_MS_THRESHOLD,
  DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD,
  NATIVE_BRIDGE_VERSION,
  setBleStabilityOverrideResolver,
  type NativeToWebMessage,
} from '@noilink/shared';
import type { TrainingRunState } from './TrainingSessionPlay';

// ───────────────────────────────────────────────────────────
// 의존성 모킹 — TrainingSessionPlay 의 BLE 분기 외 부수효과 제거
// (모듈 평가 전에 등록되어야 하므로 import 보다 앞에 둔다)
// ───────────────────────────────────────────────────────────

// 트레이닝 엔진은 실제 타이머를 돌리지 않는 더미로 대체한다.
// 단, 진짜 엔진과 동일하게:
//   - endNow() 는 onComplete 를 동기 발사한다 (TrainingSessionPlay 의 부분 결과 모달이
//     `engineMetrics !== null` 가드로 보호되므로, 백그라운드 분기 회귀 테스트가 모달
//     상태를 검증하려면 합성 메트릭이라도 즉시 통보돼야 한다).
//   - 진행률 트리거가 필요한 테스트는 `emitElapsed(ms)` 로 onElapsedMs 를 직접 발사한다
//     (FakeEngine.start() 는 자동 진행하지 않는다).
// 인스턴스 핸들은 globalThis 에 보관해 vi.mock 외부 스코프에서 접근한다.
vi.mock('../training/engine', () => {
  type EngineOpts = {
    onElapsedMs?: (ms: number) => void;
    onComplete?: (m: unknown) => void;
  };
  class FakeEngine {
    private opts: EngineOpts;
    constructor(opts: EngineOpts) {
      this.opts = opts;
      (globalThis as { __fakeEngineInstance__?: FakeEngine }).__fakeEngineInstance__ = this;
    }
    start() {}
    destroy() {
      const g = globalThis as { __fakeEngineInstance__?: FakeEngine };
      if (g.__fakeEngineInstance__ === this) g.__fakeEngineInstance__ = undefined;
    }
    endNow() {
      // 부분 결과 모달의 engineMetrics 가드를 통과시키기 위해 합성 메트릭을 즉시 발사.
      // 실제 엔진과 동일하게 onComplete 는 동기적으로 호출된다.
      this.opts.onComplete?.({});
    }
    handleTap() {
      return false;
    }
    // Task #27: BLE 회복 구간 알림 — 실제 채점 누적은 하지 않는 no-op stub.
    beginRecoveryWindow() {}
    endRecoveryWindow() {}
    // Task #38: 단절 빈도/누적 시간 안내 토스트 임계치 판정용 스냅샷.
    // 테스트가 setRecoveryStats() 로 임의 값을 주입할 수 있도록 가변 필드로 둔다.
    private __recoveryStats: { windows: number; totalMs: number } = { windows: 0, totalMs: 0 };
    getRecoveryStats() {
      return this.__recoveryStats;
    }
    setRecoveryStats(stats: { windows: number; totalMs: number }) {
      this.__recoveryStats = stats;
    }
    // Task #35: 진행률 트리거 — onElapsedMs 를 직접 발사해 elapsedMsRef 를 동기화.
    emitElapsed(ms: number) {
      this.opts.onElapsedMs?.(ms);
    }
  }
  return {
    TrainingEngine: FakeEngine,
  };
});

// BLE 구독은 native 셸이 아니어도 트레이닝 화면 mount/unmount 시 호출되므로 no-op.
vi.mock('../native/bleBridge', () => ({
  bleSubscribeCharacteristic: vi.fn(),
  bleUnsubscribeCharacteristic: vi.fn(),
}));

// BLE 그레이스 useEffect 는 isNoiLinkNativeShell() === true 일 때만 등록된다.
vi.mock('../native/initNativeBridge', () => ({
  isNoiLinkNativeShell: () => true,
}));

// 결과 제출은 aborted 게이트로 차단되어 호출되지 않지만, 안전하게 모킹.
// TrainingSessionPlay 는 백오프 래퍼인 `submitCompletedTrainingWithRetry` 를 호출하므로
// 그 export 도 함께 노출해야 부분 결과 confirm 분기에서 throw 되지 않는다.
vi.mock('../utils/submitTrainingRun', () => {
  const success = async () => ({
    error: null,
    displayScore: null,
    sessionId: 'test-session',
  });
  return {
    submitCompletedTraining: vi.fn(success),
    submitCompletedTrainingWithRetry: vi.fn(success),
  };
});

// 레이아웃/그리드/모달은 BLE 분기와 무관하므로 가벼운 더미로 대체한다.
// (MobileLayout 은 useAuth 등 컨텍스트를 요구해 단위 테스트에서 부담스럽다.)
vi.mock('../components/Layout', () => ({
  MobileLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mobile-layout">{children}</div>
  ),
}));
vi.mock('../components/PodGrid/PodGrid', () => ({
  default: () => <div data-testid="pod-grid" />,
}));
// 부분 결과 저장 모달의 isOpen / 핸들러 호출을 검증할 수 있도록 가벼운 더미를 둔다.
// isOpen=false 일 때는 null 을 그대로 반환해 BLE 분기 테스트 동작에 영향이 없다.
// SuccessBanner 는 framer-motion AnimatePresence 로 렌더되는데 jsdom + 가짜 타이머
// 환경에서는 exit 애니메이션이 깨끗이 끝나지 않아 DOM 잔상이 남는다. Task #38 의
// 토스트 1회 노출 보장을 검증하기 위해 가벼운 더미로 대체한다 — isOpen 이 false
// 인 동안에는 아무 것도 렌더하지 않으며, onClose 는 SuccessBanner 자체의
// duration 타이머가 호출하도록 그대로 두면 된다 (실 컴포넌트와 동일한 시그니처).
vi.mock('../components/SuccessBanner/SuccessBanner', () => ({
  default: ({
    isOpen,
    message,
    onClose,
    duration = 3000,
    autoClose = true,
  }: {
    isOpen: boolean;
    message: string;
    onClose?: () => void;
    duration?: number;
    autoClose?: boolean;
  }) => {
    React.useEffect(() => {
      if (isOpen && autoClose && onClose) {
        const id = setTimeout(() => onClose(), duration);
        return () => clearTimeout(id);
      }
    }, [isOpen, autoClose, duration, onClose]);
    return isOpen ? <div data-testid="success-banner">{message}</div> : null;
  },
}));

vi.mock('../components/ConfirmModal/ConfirmModal', () => ({
  default: ({
    isOpen,
    title,
    message,
    confirmText,
    cancelText,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
  }) =>
    isOpen ? (
      <div data-testid="confirm-modal" data-title={title ?? ''}>
        <p data-testid="confirm-modal-message">{message}</p>
        <button data-testid="confirm-modal-confirm" onClick={onConfirm}>
          {confirmText ?? 'confirm'}
        </button>
        <button data-testid="confirm-modal-cancel" onClick={onCancel}>
          {cancelText ?? 'cancel'}
        </button>
      </div>
    ) : null,
}));

import TrainingSessionPlay from './TrainingSessionPlay';

// ───────────────────────────────────────────────────────────
// 헬퍼
// ───────────────────────────────────────────────────────────

const RUN_STATE: TrainingRunState = {
  catalogId: 'focus-1',
  apiMode: 'FOCUS',
  userId: 'user-1',
  title: '집중력 트레이닝',
  totalDurationSec: 60,
  bpm: 60,
  level: 1,
  yieldsScore: true,
  isComposite: false,
};

/** 마지막 location 을 캡처해 navigate 결과(=목록 화면 진입 + abortReason)를 검증한다. */
type LocationSnapshot = { pathname: string; state: unknown };
let lastLocation: LocationSnapshot | null = null;

function LocationProbe() {
  const loc = useLocation();
  lastLocation = { pathname: loc.pathname, state: loc.state };
  return <div data-testid="location-probe" data-pathname={loc.pathname} />;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderApp(override?: Partial<TrainingRunState>) {
  const runState: TrainingRunState = { ...RUN_STATE, ...override };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter
        initialEntries={[{ pathname: '/training/session', state: runState }]}
      >
        <Routes>
          <Route path="/training/session" element={<TrainingSessionPlay />} />
          <Route path="/training" element={<LocationProbe />} />
          <Route path="/result" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

/** 모킹된 FakeEngine 인스턴스 핸들 (emitElapsed 로 진행률을 직접 트리거). */
type FakeEngineHandle = {
  emitElapsed: (ms: number) => void;
  setRecoveryStats: (stats: { windows: number; totalMs: number }) => void;
};
function getFakeEngine(): FakeEngineHandle {
  const inst = (globalThis as { __fakeEngineInstance__?: FakeEngineHandle })
    .__fakeEngineInstance__;
  if (!inst) throw new Error('FakeEngine 인스턴스가 아직 생성되지 않았습니다');
  return inst;
}

function unmountApp() {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
}

function dispatchBridge(detail: NativeToWebMessage) {
  act(() => {
    window.dispatchEvent(new CustomEvent('noilink-native-bridge', { detail }));
  });
}

function bleConnectionMessage(opts: {
  connected: boolean;
  reason?: 'user' | 'unexpected' | 'retry-failed';
}): NativeToWebMessage {
  return {
    v: NATIVE_BRIDGE_VERSION,
    type: 'ble.connection',
    payload: {
      connected: opts.connected
        ? { id: 'pod-1', name: 'NoiPod-1', rssi: -55, lastSeenAt: Date.now() }
        : null,
      reason: opts.reason,
    },
  };
}

function reconnectingBannerVisible(): boolean {
  return Boolean(container?.textContent?.includes('기기 연결 회복 중'));
}

function onTrainingListWithReason(reason: string): boolean {
  if (!lastLocation) return false;
  if (lastLocation.pathname !== '/training') return false;
  const state = lastLocation.state as { abortReason?: string } | null;
  return state?.abortReason === reason;
}

// ───────────────────────────────────────────────────────────
// 테스트
// ───────────────────────────────────────────────────────────

describe('TrainingSessionPlay — BLE 단절/재연결 분기', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lastLocation = null;
    // isNoiLinkNativeShell 우회용 (모킹돼 있지만 실제 셸 의존 코드 안전망).
    (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } })
      .ReactNativeWebView = { postMessage: () => {} };
  });

  afterEach(() => {
    unmountApp();
    delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('unexpected 단절 후 그레이스 안에 재연결되면 배너가 사라지고 화면이 유지된다', () => {
    renderApp();

    // 진행 화면이 마운트되었고 아직 배너는 없다.
    expect(container?.querySelector('[data-testid="pod-grid"]')).toBeTruthy();
    expect(reconnectingBannerVisible()).toBe(false);

    // 단절 통보 → "기기 연결 회복 중" 배너 노출.
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'unexpected' }));
    expect(reconnectingBannerVisible()).toBe(true);

    // 그레이스 만료 직전(7.999s)에 재연결 성공 통보.
    act(() => {
      vi.advanceTimersByTime(7_999);
    });
    dispatchBridge(bleConnectionMessage({ connected: true }));

    // 배너 제거 + 목록 화면으로의 이탈 없음.
    expect(reconnectingBannerVisible()).toBe(false);
    expect(lastLocation).toBeNull();

    // 잔여 그레이스 타이머가 더 가도 종료가 발생하지 않아야 한다.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(lastLocation).toBeNull();
    expect(container?.querySelector('[data-testid="pod-grid"]')).toBeTruthy();
  });

  it('그레이스 기간 안에 재연결이 없으면 ble-disconnect 사유로 목록으로 돌아간다', () => {
    renderApp();
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'unexpected' }));
    expect(reconnectingBannerVisible()).toBe(true);
    expect(lastLocation).toBeNull();

    // 8s 그레이스 만료 → 자동 종료 + 'ble-disconnect' navigate.
    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    expect(onTrainingListWithReason('ble-disconnect')).toBe(true);
  });

  it("reason: 'retry-failed' 는 그레이스를 기다리지 않고 즉시 종료한다", () => {
    renderApp();

    // 사전 단절 통보 없이도 retry-failed 가 곧장 종료를 유발해야 한다.
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'retry-failed' }));

    // 타이머를 진행시키지 않은 상태에서 즉시 navigate 가 발생해야 한다.
    expect(onTrainingListWithReason('ble-disconnect')).toBe(true);
    // 진행 중인 그레이스 타이머가 추후에 다시 navigate 를 트리거해 abortReason 을
    // 덮어쓰지 않아야 한다(타이머가 정리되어야 함).
    const beforeState = lastLocation?.state;
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(lastLocation?.state).toBe(beforeState);
  });

  it("reason: 'user' 는 무시된다 (배너도 종료도 발생하지 않음)", () => {
    renderApp();

    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'user' }));

    expect(reconnectingBannerVisible()).toBe(false);
    expect(lastLocation).toBeNull();

    // 그레이스 길이를 넉넉히 지나도 종료가 발생해선 안 된다.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(lastLocation).toBeNull();
    expect(container?.querySelector('[data-testid="pod-grid"]')).toBeTruthy();
  });
});

/**
 * Task #38 — 잦은 BLE 단절 안내 토스트 회귀 테스트
 *
 * 정책:
 *   - 단절-재연결이 한 세션에 누적 3회 이상 또는 누적 15초 이상이면 부드러운
 *     안내 토스트("기기 연결이 자주 끊겨요. 거리·간섭을 확인해 보세요.")를
 *     상단에 1회만 노출한다.
 *   - 임계 미달이면 토스트가 뜨지 않는다.
 *   - 임계를 넘은 뒤에 회복이 더 발생해도 한 세션에 한 번만 노출된다.
 *
 * 토스트 컴포넌트(SuccessBanner)는 `framer-motion` AnimatePresence 안에서
 * 렌더되므로 텍스트 검사로 노출 여부를 판단한다.
 */
describe('TrainingSessionPlay — BLE 단절 빈도 안내 토스트 (Task #38)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lastLocation = null;
    (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } })
      .ReactNativeWebView = { postMessage: () => {} };
  });

  afterEach(() => {
    unmountApp();
    delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const STABILITY_NOTICE = '기기 연결이 자주 끊겨요';
  const stabilityNoticeVisible = () =>
    Boolean(container?.textContent?.includes(STABILITY_NOTICE));

  // 임계값은 shared에서 가져와 사용한다 (Task #44). 기본값이 바뀌거나
  // 오버라이드 훅으로 디바이스/사용자별로 조정돼도 회귀 테스트가 그대로 통과해야 한다.
  const W = DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD;
  const MS = DEFAULT_BLE_STABILITY_MS_THRESHOLD;

  it('회복 횟수·시간이 임계 미달이면 토스트가 뜨지 않는다', () => {
    renderApp();
    // 두 임계 모두 미만으로 누적된 상태로 회복 종료를 통보.
    getFakeEngine().setRecoveryStats({
      windows: Math.max(0, W - 1),
      totalMs: Math.max(0, MS - 1_000),
    });
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'unexpected' }));
    dispatchBridge(bleConnectionMessage({ connected: true }));
    expect(stabilityNoticeVisible()).toBe(false);
  });

  it('회복 횟수가 임계에 도달하면 토스트가 노출된다', () => {
    renderApp();
    // 누적 시간은 임계 미만으로 두고 횟수 조건만 만족시킨다.
    getFakeEngine().setRecoveryStats({
      windows: W,
      totalMs: Math.max(0, MS - 1_000),
    });
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'unexpected' }));
    dispatchBridge(bleConnectionMessage({ connected: true }));
    expect(stabilityNoticeVisible()).toBe(true);
  });

  it('회복 누적 시간이 임계에 도달하면 토스트가 노출된다', () => {
    renderApp();
    // 횟수는 임계 미만으로 두고 시간 조건만 만족시킨다.
    getFakeEngine().setRecoveryStats({
      windows: Math.max(0, W - 1),
      totalMs: MS,
    });
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'unexpected' }));
    dispatchBridge(bleConnectionMessage({ connected: true }));
    expect(stabilityNoticeVisible()).toBe(true);
  });

  it('한 세션에 한 번만 노출된다 — 토스트 자동 닫힘 후 추가 회복에도 다시 뜨지 않음', () => {
    renderApp();
    // 첫 노출.
    getFakeEngine().setRecoveryStats({
      windows: W,
      totalMs: Math.max(0, MS - 1_000),
    });
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'unexpected' }));
    dispatchBridge(bleConnectionMessage({ connected: true }));
    expect(stabilityNoticeVisible()).toBe(true);

    // 자동 닫힘 시간(4s) 경과 후 토스트 사라짐.
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(stabilityNoticeVisible()).toBe(false);

    // 더 많은 회복이 누적되며 추가 재연결이 와도 다시 뜨지 않아야 한다.
    getFakeEngine().setRecoveryStats({ windows: W + 2, totalMs: MS * 2 });
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'unexpected' }));
    dispatchBridge(bleConnectionMessage({ connected: true }));
    expect(stabilityNoticeVisible()).toBe(false);
  });

  it('오버라이드 훅이 임계를 올리면 토스트 노출 기준도 함께 올라간다 (Task #44)', () => {
    // 기본값보다 훨씬 큰 임계로 오버라이드.
    setBleStabilityOverrideResolver(() => ({
      windowThreshold: W + 10,
      msThreshold: MS * 4,
    }));
    try {
      renderApp();
      // 기본 임계는 넘지만 새 임계는 한참 못 미친다.
      getFakeEngine().setRecoveryStats({ windows: W, totalMs: MS });
      dispatchBridge(bleConnectionMessage({ connected: false, reason: 'unexpected' }));
      dispatchBridge(bleConnectionMessage({ connected: true }));
      expect(stabilityNoticeVisible()).toBe(false);

      // 새 임계(횟수)에 도달하면 노출된다.
      getFakeEngine().setRecoveryStats({ windows: W + 10, totalMs: MS });
      dispatchBridge(bleConnectionMessage({ connected: false, reason: 'unexpected' }));
      dispatchBridge(bleConnectionMessage({ connected: true }));
      expect(stabilityNoticeVisible()).toBe(true);
    } finally {
      setBleStabilityOverrideResolver(null);
    }
  });
});

/**
 * 백그라운드 진입 → 부분 결과 저장 분기 회귀 테스트 (TrainingSessionPlay)
 *
 * 보호 대상 정책 (TrainingSessionPlay.tsx 의 visibilitychange/pagehide useEffect):
 *   1. 진행률 < PARTIAL_RESULT_THRESHOLD (또는 점수 비산출 모드: yieldsScore=false / FREE)
 *      에서 백그라운드 진입 시 → finalizeAndAbort('background') 가 호출되어 LED OFF +
 *      목록 화면으로 navigate(`/training`) + abortReason='background'.
 *   2. 진행률 ≥ PARTIAL_RESULT_THRESHOLD 인 점수 산출 세션은 navigate 가 발생하지 않고
 *      `partialFinishOpen` 모달이 열린다 (= 사용자에게 부분 결과 저장 선택지 제공).
 *   3. handlePartialConfirm: aborted 게이트가 해제되어 결과 제출
 *      (submitCompletedTrainingWithRetry — TrainingSessionPlay 가 호출하는 백오프 래퍼)
 *      이 진행된다.
 *   4. handlePartialDismiss: 'background' 사유로 목록 화면으로 돌아간다.
 *
 * BLE 분기 테스트와 동일한 모킹 패턴(엔진/브리지/서브미트 무력화)을 재사용하고,
 * 진행률은 FakeEngine.emitElapsed 로 직접 트리거하며, 백그라운드 진입은
 * `document.hidden = true` + `visibilitychange` 디스패치로 재현한다.
 */
describe('TrainingSessionPlay — 백그라운드 진입/부분 결과 저장 분기', () => {
  let documentHidden = false;
  let originalHidden: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    lastLocation = null;
    documentHidden = false;
    (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } })
      .ReactNativeWebView = { postMessage: () => {} };
    // jsdom 의 document.hidden 은 prototype getter — instance 에 configurable 속성으로
    // 덮어써서 테스트 중에만 값을 바꾸고, afterEach 에서 원복한다.
    originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => documentHidden,
    });
  });

  afterEach(() => {
    unmountApp();
    delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
    vi.useRealTimers();
    vi.clearAllMocks();
    if (originalHidden) {
      Object.defineProperty(document, 'hidden', originalHidden);
    } else {
      // instance 속성을 제거해 prototype 의 기본 getter 가 다시 활성화되도록 한다.
      delete (document as unknown as { hidden?: boolean }).hidden;
    }
  });

  /** 백그라운드 진입을 모사한다 — document.hidden=true 후 visibilitychange 디스패치. */
  function fireBackground() {
    documentHidden = true;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  /** 진행률(0~1)을 FakeEngine 의 onElapsedMs 로 직접 통보해 elapsedMsRef 를 동기화한다. */
  function setProgressRatio(pct: number) {
    act(() => {
      getFakeEngine().emitElapsed(RUN_STATE.totalDurationSec * 1000 * pct);
    });
  }

  function modal(): HTMLElement | null {
    return container?.querySelector<HTMLElement>('[data-testid="confirm-modal"]') ?? null;
  }

  it('진행률 < 임계값(80%) 에서 백그라운드 진입 시 background 사유로 목록으로 돌아간다', () => {
    renderApp();
    // 점수 산출 모드(FOCUS) + 진행률 50% — 임계값(80%) 미만.
    setProgressRatio(0.5);
    fireBackground();

    expect(onTrainingListWithReason('background')).toBe(true);
    // 부분 결과 모달은 열리지 않아야 한다.
    expect(modal()).toBeNull();
  });

  it('점수 비산출(FREE) 모드에서는 진행률 100% 라도 background 사유로 목록으로 돌아간다', () => {
    // FREE 모드는 임계값과 무관하게 항상 즉시 종료 경로로 가야 한다.
    renderApp({ apiMode: 'FREE', yieldsScore: false });
    setProgressRatio(1.0);
    fireBackground();

    expect(onTrainingListWithReason('background')).toBe(true);
    expect(modal()).toBeNull();
  });

  it('점수 산출 + 진행률 ≥ 임계값(80%) 에서 백그라운드 진입 시 부분 결과 모달이 열리고 navigate 는 발생하지 않는다', () => {
    renderApp();
    setProgressRatio(0.85);
    fireBackground();

    // partialFinishOpen=true && engineMetrics !== null → 모달이 렌더링된다.
    const m = modal();
    expect(m).toBeTruthy();
    expect(m?.getAttribute('data-title')).toBe('거의 다 끝났던 세션이에요');
    // 목록/결과 화면으로의 이탈은 발생하지 않아야 한다.
    expect(lastLocation).toBeNull();
  });

  it('handlePartialConfirm: aborted 게이트가 해제되어 결과 제출이 진행된다', async () => {
    renderApp();
    setProgressRatio(0.85);
    fireBackground();

    // TrainingSessionPlay 의 runSubmit 은 백오프 래퍼(submitCompletedTrainingWithRetry)
    // 를 통과하므로 회귀 테스트도 동일한 함수를 검증한다.
    const { submitCompletedTrainingWithRetry } = await import('../utils/submitTrainingRun');
    // 모달이 열린 시점(=aborted 게이트 ON)에서는 자동 제출이 차단되어 있어야 한다.
    expect(submitCompletedTrainingWithRetry).not.toHaveBeenCalled();

    // "결과 보러가기" 클릭 → handlePartialConfirm.
    const confirmBtn = container?.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-modal-confirm"]',
    );
    expect(confirmBtn).toBeTruthy();
    await act(async () => {
      confirmBtn!.click();
      // runSubmit 는 async — 제출 함수 호출 직전 await 까지 microtask 비움.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(submitCompletedTrainingWithRetry).toHaveBeenCalledTimes(1);
  });

  it('handlePartialDismiss: 그만두기 시 background 사유로 목록 화면으로 돌아간다', async () => {
    renderApp();
    setProgressRatio(0.85);
    fireBackground();

    const { submitCompletedTrainingWithRetry } = await import('../utils/submitTrainingRun');
    const cancelBtn = container?.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-modal-cancel"]',
    );
    expect(cancelBtn).toBeTruthy();
    act(() => {
      cancelBtn!.click();
    });

    // 부분 결과 저장 없이 목록 화면으로 복귀 + abortReason='background'.
    expect(onTrainingListWithReason('background')).toBe(true);
    expect(submitCompletedTrainingWithRetry).not.toHaveBeenCalled();
  });
});
