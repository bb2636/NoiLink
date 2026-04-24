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
import { NATIVE_BRIDGE_VERSION, type NativeToWebMessage } from '@noilink/shared';
import type { TrainingRunState } from './TrainingSessionPlay';

// ───────────────────────────────────────────────────────────
// 의존성 모킹 — TrainingSessionPlay 의 BLE 분기 외 부수효과 제거
// (모듈 평가 전에 등록되어야 하므로 import 보다 앞에 둔다)
// ───────────────────────────────────────────────────────────

// 트레이닝 엔진은 실제 타이머를 돌리지 않는 더미로 대체한다.
// destroy/endNow/handleTap 만 호출되며, 콜백은 발사하지 않는다(=engineMetrics null 유지).
vi.mock('../training/engine', () => {
  class FakeEngine {
    constructor(_: unknown) {}
    start() {}
    destroy() {}
    endNow() {}
    handleTap() {
      return false;
    }
    // Task #27: BLE 회복 구간 알림 — 실제 채점 누적은 하지 않는 no-op stub.
    beginRecoveryWindow() {}
    endRecoveryWindow() {}
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
vi.mock('../utils/submitTrainingRun', () => ({
  submitCompletedTraining: vi.fn(async () => ({
    error: null,
    displayScore: null,
    sessionId: 'test-session',
  })),
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
vi.mock('../components/ConfirmModal/ConfirmModal', () => ({
  default: () => null,
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

function renderApp() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter
        initialEntries={[{ pathname: '/training/session', state: RUN_STATE }]}
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
