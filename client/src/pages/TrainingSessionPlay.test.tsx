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
    totalAttempts: 1,
  });
  return {
    submitCompletedTraining: vi.fn(success),
    submitCompletedTrainingWithRetry: vi.fn(success),
  };
});

// runSubmit 는 정상 완료 흐름에서 직전 점수 조회를 위해 `/sessions/user/:userId`
// 를 추가로 호출한다 (Task #113). BLE/부분 결과 분기 테스트는 비교 카드 동작과
// 무관하므로 빈 응답으로 안전하게 모킹해 네트워크 부수효과를 차단한다.
vi.mock('../utils/api', () => ({
  __esModule: true,
  default: { get: vi.fn(async () => ({ success: true, data: [] })) },
  api: { get: vi.fn(async () => ({ success: true, data: [] })) },
}));

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
// `showCloseButton` 이 켜진 호출(거부 토스트 — Task #129)에서는 X 닫기 버튼을 노출해
// 사용자 닫힘 → `onUserClose` (없으면 `onClose`) 라우팅을 실 컴포넌트와 동일하게 흉내낸다.
vi.mock('../components/SuccessBanner/SuccessBanner', () => ({
  default: ({
    isOpen,
    message,
    onClose,
    onUserClose,
    duration = 3000,
    autoClose = true,
    showCloseButton,
  }: {
    isOpen: boolean;
    message: string;
    onClose?: () => void;
    onUserClose?: () => void;
    duration?: number;
    autoClose?: boolean;
    showCloseButton?: boolean;
  }) => {
    React.useEffect(() => {
      if (isOpen && autoClose && onClose) {
        const id = setTimeout(() => onClose(), duration);
        return () => clearTimeout(id);
      }
    }, [isOpen, autoClose, duration, onClose]);
    return isOpen ? (
      <div data-testid="success-banner">
        {message}
        {showCloseButton ? (
          <button
            type="button"
            data-testid="success-banner-close"
            onClick={() => (onUserClose ? onUserClose() : onClose?.())}
          >
            ×
          </button>
        ) : null}
      </div>
    ) : null;
  },
}));

// 텔레메트리 보고는 fire-and-forget 네트워크 호출 — 단위 테스트에서는 호출 횟수만
// 검증할 수 있도록 모듈 단위로 spy 로 대체한다 (`subscribeAckErrorBanner` 의 기본
// `onTelemetry` 가 이 함수이므로 페이지가 별도 주입 없이도 본 spy 를 거친다).
vi.mock('../utils/reportAckBannerEvent', () => ({
  reportAckBannerEventFireAndForget: vi.fn(),
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
import { reportAckBannerEventFireAndForget } from '../utils/reportAckBannerEvent';

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

/** navigate state 의 bleUnstable 값을 그대로 노출 (Task #43 회귀 검증용). */
function bleUnstableFromLastLocation(): unknown {
  const state = lastLocation?.state as { bleUnstable?: unknown } | null;
  return state?.bleUnstable;
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
 * Task #43 — BLE 자동 종료 시 회복 통계에 따라 환경 점검 안내를 함께 띄우는 신호 회귀 테스트
 *
 * 정책 (TrainingSessionPlay.finalizeAndAbort):
 *   - reason='ble-disconnect' 종료 시점에 engineRef.getRecoveryStats() 를 읽어
 *     임계(1회 이상 OR 5초 이상)를 넘으면 navigate state 에 bleUnstable=true 를 함께 전달.
 *   - 임계 미달이거나 첫 단절 즉시 종료된 케이스는 bleUnstable=false.
 *   - retry-failed 즉시 종료 분기와 그레이스 만료 분기 모두에서 동일하게 동작해야 한다.
 *
 * navigate state 의 message/톤 가공은 Training.tsx 책임이므로 여기서는 신호(플래그)
 * 전달만 검증한다.
 */
describe('TrainingSessionPlay — BLE 자동 종료 시 환경 점검 신호 (Task #43)', () => {
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

  it('첫 단절 즉시 종료(retry-failed, 회복 통계 0) 케이스는 bleUnstable=false', () => {
    renderApp();
    // 회복 통계는 기본값 {windows:0, totalMs:0} — 임계 미달.
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'retry-failed' }));

    expect(onTrainingListWithReason('ble-disconnect')).toBe(true);
    expect(bleUnstableFromLastLocation()).toBe(false);
  });

  it('회복 windows ≥ 1 이면 retry-failed 종료에서도 bleUnstable=true 를 전달한다', () => {
    renderApp();
    // 한 번 회복했지만 다시 끊겨 최종 실패한 시나리오를 통계로만 모사.
    getFakeEngine().setRecoveryStats({ windows: 1, totalMs: 1_000 });
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'retry-failed' }));

    expect(onTrainingListWithReason('ble-disconnect')).toBe(true);
    expect(bleUnstableFromLastLocation()).toBe(true);
  });

  it('누적 회복 시간이 5초 이상이면 windows 0 이어도 bleUnstable=true', () => {
    renderApp();
    // 회복이 한 번도 마감되지 않았더라도(=현재 진행 중 구간 포함) 5s 누적이면 임계 충족.
    getFakeEngine().setRecoveryStats({ windows: 0, totalMs: 5_000 });
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'retry-failed' }));

    expect(onTrainingListWithReason('ble-disconnect')).toBe(true);
    expect(bleUnstableFromLastLocation()).toBe(true);
  });

  it('누적 회복 시간이 5초 미만이고 windows 도 0 이면 bleUnstable=false', () => {
    renderApp();
    getFakeEngine().setRecoveryStats({ windows: 0, totalMs: 4_999 });
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'retry-failed' }));

    expect(onTrainingListWithReason('ble-disconnect')).toBe(true);
    expect(bleUnstableFromLastLocation()).toBe(false);
  });

  it('그레이스 만료 분기에서도 회복 통계가 임계 이상이면 bleUnstable=true', () => {
    renderApp();
    // unexpected 단절 → 그레이스 시작.
    dispatchBridge(bleConnectionMessage({ connected: false, reason: 'unexpected' }));
    expect(reconnectingBannerVisible()).toBe(true);

    // 그레이스 만료 직전에 통계 임계를 충족시키고, 시간 경과로 자동 종료를 유발.
    getFakeEngine().setRecoveryStats({ windows: 2, totalMs: 8_000 });
    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    expect(onTrainingListWithReason('ble-disconnect')).toBe(true);
    expect(bleUnstableFromLastLocation()).toBe(true);
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
 *   1. 진행률 < partialThresholdForMode(apiMode) (또는 점수 비산출 모드:
 *      yieldsScore=false / FREE) 에서 백그라운드 진입 시 → finalizeAndAbort('background')
 *      가 호출되어 LED OFF + 목록 화면으로 navigate(`/training`) + abortReason='background'.
 *   2. 진행률 ≥ partialThresholdForMode(apiMode) 인 점수 산출 세션은 navigate 가 발생하지
 *      않고 `partialFinishOpen` 모달이 열린다 (= 사용자에게 부분 결과 저장 선택지 제공).
 *   3. handlePartialConfirm: aborted 게이트가 해제되어 결과 제출
 *      (submitCompletedTrainingWithRetry — TrainingSessionPlay 가 호출하는 백오프 래퍼)
 *      이 진행된다.
 *   4. handlePartialDismiss: 'background' 사유로 목록 화면으로 돌아간다.
 *
 * Task #24: 임계값은 모드별로 다르다 (FOCUS/JUDGMENT 0.6, ENDURANCE 0.9, 그 외 0.8).
 *   여기서는 기본 RUN_STATE 가 FOCUS(0.6) 라는 점에 유의하고, ENDURANCE 케이스는
 *   별도 테스트가 추가로 보호한다.
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

  it('진행률 < 임계값(FOCUS=60%) 에서 백그라운드 진입 시 background 사유로 목록으로 돌아간다', () => {
    renderApp();
    // 점수 산출 모드(FOCUS) + 진행률 50% — FOCUS 임계값(60%) 미만.
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

  it('점수 산출 + 진행률 ≥ 임계값(FOCUS=60%) 에서 백그라운드 진입 시 부분 결과 모달이 열리고 navigate 는 발생하지 않는다', () => {
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

  // ─────────────────────────────────────────────────────────
  // Task #113 — 결과로 navigate 할 때 직전 점수를 함께 실어 보낸다
  // ─────────────────────────────────────────────────────────
  // 정책 요약:
  //   1. runSubmit 직전에 `/sessions/user/:userId` 를 한 번 호출해 사용자 이력을
  //      받아 두고, 응답에서 현재 세션(`res.sessionId`)을 제외한 가장 최근의
  //      score 를 navigate state.previousScore 로 전달한다.
  //   2. 이력이 비거나 점수가 없으면 previousScore 는 undefined 로 둔다 —
  //      Result.tsx 가 비교 카드를 자연스럽게 숨긴다.
  // 보호 목적:
  //   - 정상 완료 직후에도 가짜 폴백(`todayScore - 12`) 이 다시 새어 나오지 않도록
  //     navigate state.previousScore 가 서버 응답으로 채워지는 경로를 잠근다.

  it('runSubmit 후 navigate state.previousScore/previousScoreCreatedAt/previousScoreLocalDate 가 서버 이력의 진짜 직전 세션 값으로 채워진다 (Task #113 / Task #123 / Task #132)', async () => {
    // 사용자 이력 — 첫 항목은 현재 세션(test-session, score 없음), 그 다음이 직전 세션.
    const mockApi = await import('../utils/api');
    const apiGet = (mockApi.default as unknown as { get: ReturnType<typeof vi.fn> }).get;
    apiGet.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'test-session', createdAt: '2026-04-26T00:00:00.000Z' },
        { id: 'sess-prev', score: 73, createdAt: '2026-04-25T00:00:00.000Z' },
      ],
    });

    renderApp();
    setProgressRatio(0.85);
    fireBackground();

    const confirmBtn = container?.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-modal-confirm"]',
    );
    await act(async () => {
      confirmBtn!.click();
      // submit + 직전 점수 fetch + navigate 까지 microtask 큐를 충분히 비운다.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 직전 점수 조회가 정확한 엔드포인트로 일어났어야 한다.
    expect(apiGet).toHaveBeenCalledWith('/sessions/user/user-1?limit=50');

    // navigate state.previousScore 가 서버 응답의 73 으로 채워져야 한다.
    // 그리고 비교 카드 라벨용 createdAt 도 같은 세션의 값으로 한 쌍으로 함께
    // 전달돼야 한다 — 가짜 "오늘 - 2일" 라벨이 다시 새어 나오지 않게 잠근다.
    // Task #132: KST 기준 표시용 날짜도 함께 채워져, 라벨이 디바이스 시간대로
    // 흔들리지 않게 한다. 2026-04-25T00:00:00Z = KST 09:00 → "2026-04-25".
    const navState = lastLocation?.state as {
      previousScore?: number;
      previousScoreCreatedAt?: string;
      previousScoreLocalDate?: string;
    } | null;
    expect(lastLocation?.pathname).toBe('/result');
    expect(navState?.previousScore).toBe(73);
    expect(navState?.previousScoreCreatedAt).toBe('2026-04-25T00:00:00.000Z');
    expect(navState?.previousScoreLocalDate).toBe('2026-04-25');
  });

  it('자정 경계: 직전 세션이 UTC 15:00 직전이면 previousScoreLocalDate 는 KST 의 다음 날짜로 떨어진다 (Task #132)', async () => {
    // UTC 2026-04-24 15:30 = KST 2026-04-25 00:30 (KST 자정 직후).
    // ISO 만 보면 디바이스 로컬 시간대로 라벨이 흔들릴 수 있지만, 클라이언트가
    // 같은 KST 헬퍼로 계산해 보내는 표시용 날짜는 항상 "2026-04-25" 이어야 한다.
    const mockApi = await import('../utils/api');
    const apiGet = (mockApi.default as unknown as { get: ReturnType<typeof vi.fn> }).get;
    apiGet.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 'test-session', createdAt: '2026-04-26T00:00:00.000Z' },
        { id: 'sess-prev-late', score: 65, createdAt: '2026-04-24T15:30:00.000Z' },
      ],
    });

    renderApp();
    setProgressRatio(0.85);
    fireBackground();

    const confirmBtn = container?.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-modal-confirm"]',
    );
    await act(async () => {
      confirmBtn!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const navState = lastLocation?.state as {
      previousScore?: number;
      previousScoreCreatedAt?: string;
      previousScoreLocalDate?: string;
    } | null;
    expect(navState?.previousScore).toBe(65);
    expect(navState?.previousScoreCreatedAt).toBe('2026-04-24T15:30:00.000Z');
    // 핵심 회귀: KST 기준 04-25 가 떨어져야 한다 (디바이스 시간대 무관).
    expect(navState?.previousScoreLocalDate).toBe('2026-04-25');
  });

  it('직전 세션이 없으면 navigate state.previousScore 는 undefined 로 남는다 (첫 세션 정책)', async () => {
    const mockApi = await import('../utils/api');
    const apiGet = (mockApi.default as unknown as { get: ReturnType<typeof vi.fn> }).get;
    // 이력에 본인이 막 만든 세션 하나만 있는 케이스.
    apiGet.mockResolvedValueOnce({
      success: true,
      data: [{ id: 'test-session', score: 60, createdAt: '2026-04-26T00:00:00.000Z' }],
    });

    renderApp();
    setProgressRatio(0.85);
    fireBackground();

    const confirmBtn = container?.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-modal-confirm"]',
    );
    await act(async () => {
      confirmBtn!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Task #123 / Task #132: 점수가 없으면 ISO/표시용 날짜도 모두 undefined —
    // 라벨이 어긋난 채 새어 나가지 않게 잠근다.
    const navState = lastLocation?.state as {
      previousScore?: number;
      previousScoreCreatedAt?: string;
      previousScoreLocalDate?: string;
    } | null;
    expect(lastLocation?.pathname).toBe('/result');
    expect(navState?.previousScore).toBeUndefined();
    expect(navState?.previousScoreCreatedAt).toBeUndefined();
    expect(navState?.previousScoreLocalDate).toBeUndefined();
  });

  it('사용자 이력 조회가 실패해도 navigate 는 진행되고 previousScore 만 undefined 로 남는다', async () => {
    const mockApi = await import('../utils/api');
    const apiGet = (mockApi.default as unknown as { get: ReturnType<typeof vi.fn> }).get;
    apiGet.mockRejectedValueOnce(new Error('network down'));

    renderApp();
    setProgressRatio(0.85);
    fireBackground();

    const confirmBtn = container?.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-modal-confirm"]',
    );
    await act(async () => {
      confirmBtn!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const navState = lastLocation?.state as { previousScore?: number } | null;
    expect(lastLocation?.pathname).toBe('/result');
    expect(navState?.previousScore).toBeUndefined();
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

  // Task #24: 모드별 임계값 회귀
  it('FOCUS 65% (= 임계값 60% 직상) 에서 부분 결과 모달이 열린다', () => {
    renderApp({ apiMode: 'FOCUS' });
    setProgressRatio(0.65);
    fireBackground();
    expect(modal()).toBeTruthy();
    expect(lastLocation).toBeNull();
  });

  it('JUDGMENT 65% 에서도 부분 결과 모달이 열린다 (임계값 60%)', () => {
    renderApp({ apiMode: 'JUDGMENT' });
    setProgressRatio(0.65);
    fireBackground();
    expect(modal()).toBeTruthy();
  });

  it('ENDURANCE 85% (= 종전 80% 임계 통과 / 신규 90% 임계 미달) 에서는 모달 없이 목록으로 돌아간다', () => {
    // ENDURANCE 는 Late 구간(200~300s) 점수가 핵심이라 90% 미만은 부분 저장 의미가 없다.
    renderApp({ apiMode: 'ENDURANCE' });
    setProgressRatio(0.85);
    fireBackground();
    expect(modal()).toBeNull();
    expect(onTrainingListWithReason('background')).toBe(true);
  });

  it('ENDURANCE 92% (= 임계값 90% 직상) 에서는 부분 결과 모달이 열린다', () => {
    renderApp({ apiMode: 'ENDURANCE' });
    setProgressRatio(0.92);
    fireBackground();
    expect(modal()).toBeTruthy();
    expect(lastLocation).toBeNull();
  });

  it('COMPOSITE 80% (= 4사이클 완료 직전) 에서는 부분 결과 모달이 열린다', () => {
    renderApp({ apiMode: 'COMPOSITE', isComposite: true });
    setProgressRatio(0.8);
    fireBackground();
    expect(modal()).toBeTruthy();
  });
});

/**
 * Task #77 / #104 — 트레이닝 도중 브릿지 거부(ack ok=false) 토스트 회귀 테스트
 *
 * 보호 대상:
 *   - `noilink-native-ack` (ok=false) 이벤트가 들어오면 트레이닝 진행 화면에
 *     `formatAckErrorForBanner` 가 만든 한국어 안내 + 디버그 키가 SuccessBanner
 *     토스트로 노출된다 (TrainingSessionPlay 의 ackErrorBanner SuccessBanner).
 *   - 자유 문자열도 디버그 키 없이 그대로 보인다.
 *   - ok=true ack 는 토스트를 띄우지 않는다.
 *
 * Task #77 의 단위 테스트는 파서/구독만 검증하므로, 실제 화면이 이벤트를 수신해
 * SuccessBanner 까지 그려내는지 보호하기 위한 화면-수준 회귀 테스트.
 */
describe('TrainingSessionPlay — 브릿지 거부 토스트 (Task #77 / #104)', () => {
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

  function dispatchAck(detail: { id: string; ok: boolean; error?: string }) {
    act(() => {
      window.dispatchEvent(new CustomEvent('noilink-native-ack', { detail }));
    });
  }

  function ackBannerText(): string | null {
    // ack 토스트는 "내부 오류:" 접두사로 시작한다 — BLE 회복/단절 토스트와 텍스트로 구분.
    const banners = container?.querySelectorAll('[data-testid="success-banner"]');
    if (!banners) return null;
    for (const b of Array.from(banners)) {
      const text = b.textContent ?? '';
      if (text.startsWith('내부 오류:')) return text;
    }
    return null;
  }

  it('ok=false ack (구조화된 사유) 가 오면 한국어 안내 + 디버그 키가 화면에 보인다', () => {
    renderApp();

    // 진입 직후에는 ack 토스트가 없다.
    expect(ackBannerText()).toBeNull();

    dispatchAck({
      id: 'req-1',
      ok: false,
      error: 'ble.writeLed:field-enum@payload.colorCode: ble.writeLed: payload.colorCode invalid enum',
    });

    const text = ackBannerText();
    expect(text).not.toBeNull();
    expect(text!).toContain('내부 오류: ble.writeLed의 colorCode 허용되지 않은 값');
    expect(text!).toContain('[ble.writeLed:field-enum@payload.colorCode]');
  });

  it('자유 문자열(BleManagerError.message 등) 도 디버그 키 없이 노출된다', () => {
    renderApp();
    dispatchAck({ id: 'req-2', ok: false, error: 'Device is not connected' });

    const text = ackBannerText();
    expect(text).not.toBeNull();
    // X 닫기 버튼(`×`) 도 banner DOM 안에 있으므로 부분 일치로 검증한다.
    expect(text!).toContain('내부 오류: Device is not connected');
    // 디버그 키 대괄호가 붙지 않아야 한다.
    expect(text!).not.toContain('[');
  });

  it('ok=true ack 는 토스트를 띄우지 않는다', () => {
    renderApp();
    dispatchAck({ id: 'req-3', ok: true });
    expect(ackBannerText()).toBeNull();
  });

  // Task #138 — X 버튼이 빠르게 두 번 눌려도 운영 텔레메트리는 한 건만 흘러야 한다.
  // burst 가 첫 `notifyDismissed()` 로 마감된 뒤 도착한 두 번째 호출은 활성 burst 가
  // 없어 무시된다는 단위 테스트(`nativeAckErrors.test.ts`) 의 통합 회귀 보호 —
  // 트레이닝 화면이 X 클릭 → `notifyDismissed()` 를 한 번씩만 흘리는지, 그리고 모듈
  // 기본 텔레메트리 sink (`reportAckBannerEventFireAndForget`) 가 정확히 한 번만
  // 호출되는지 화면 레이어에서 보장한다.
  it('X 버튼을 두 번 눌러도 user-dismiss 텔레메트리는 한 건만 흐른다', () => {
    renderApp();
    dispatchAck({
      id: 'req-4',
      ok: false,
      error: 'ble.writeLed:field-enum@payload.colorCode: ble.writeLed: payload.colorCode invalid enum',
    });

    const reportSpy = vi.mocked(reportAckBannerEventFireAndForget);
    expect(reportSpy).not.toHaveBeenCalled();

    // ack 토스트 SuccessBanner 만 골라낸다 — BLE 안정성 토스트와 구분하기 위해
    // 부모 banner 의 텍스트가 "내부 오류:" 로 시작하는 쪽만 채택.
    const banners = container?.querySelectorAll('[data-testid="success-banner"]') ?? [];
    let ackBanner: Element | null = null;
    for (const b of Array.from(banners)) {
      if ((b.textContent ?? '').startsWith('내부 오류:')) {
        ackBanner = b;
        break;
      }
    }
    expect(ackBanner).not.toBeNull();
    const closeBtn = ackBanner!.querySelector(
      '[data-testid="success-banner-close"]',
    ) as HTMLButtonElement | null;
    expect(closeBtn).not.toBeNull();

    // 같은 act 안에서 두 번 클릭해 — 첫 클릭으로 setBanner(null) 이 예약되어도
    // React 렌더 flush 전이므로 같은 DOM 노드를 한 번 더 누른 것과 동치다.
    // 실제 사용자가 토스트 닫힘 애니메이션 직전에 X 를 한 번 더 누른 케이스를 흉내낸다.
    act(() => {
      closeBtn!.click();
      closeBtn!.click();
    });

    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'user-dismiss' }),
    );
    expect(ackBannerText()).toBeNull();
  });
});
