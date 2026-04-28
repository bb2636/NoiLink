/**
 * TrainingBlinkPlay (점등-전용 진행 화면) 회귀 테스트
 *
 * 보호 대상:
 *   1. 일시정지 버튼이 engine.pause() 를 호출하고 다시 누르면 engine.resume() 을 호출한다.
 *   2. 자연 종료(onComplete) 시 navigate('/result', { blinkOnly: true, title }) 로 이동한다.
 *   3. 취소 버튼 → ConfirmModal 노출 → 종료 확정 시 engine.destroy() + 목록 화면 복귀.
 *   4. BLE retry-failed 분기는 그레이스 없이 즉시 목록(`/training`)으로 복귀한다.
 *
 * 엔진은 실제 타이머를 돌리지 않는 더미로 대체해 단위 테스트로 검증 가능하게 만든다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { NativeToWebMessage } from '@noilink/shared';
import type { TrainingRunState } from './TrainingSessionPlay';

// 트레이닝 엔진은 실제 RAF/setTimeout 을 돌리지 않는 더미로 대체.
// 단, 진짜 엔진과 동일하게 onComplete 는 외부에서 트리거 가능하도록 emit 헬퍼를 노출.
vi.mock('../training/engine', () => {
  type EngineOpts = {
    onElapsedMs?: (ms: number) => void;
    onComplete?: (m: unknown) => void;
  };
  class FakeEngine {
    private opts: EngineOpts;
    private paused = false;
    public pauseCalls = 0;
    public resumeCalls = 0;
    public destroyCalls = 0;
    public beginRecoveryCalls = 0;
    public endRecoveryCalls = 0;
    constructor(opts: EngineOpts) {
      this.opts = opts;
      (globalThis as { __fakeBlinkEngine__?: FakeEngine }).__fakeBlinkEngine__ = this;
    }
    start() {}
    destroy() {
      this.destroyCalls += 1;
      const g = globalThis as { __fakeBlinkEngine__?: FakeEngine };
      if (g.__fakeBlinkEngine__ === this) g.__fakeBlinkEngine__ = undefined;
    }
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    }
    resume() {
      this.resumeCalls += 1;
      this.paused = false;
    }
    getIsPaused() {
      return this.paused;
    }
    beginRecoveryWindow() {
      this.beginRecoveryCalls += 1;
    }
    endRecoveryWindow() {
      this.endRecoveryCalls += 1;
    }
    emitComplete(metrics: unknown = {}) {
      this.opts.onComplete?.(metrics);
    }
    emitElapsed(ms: number) {
      this.opts.onElapsedMs?.(ms);
    }
  }
  return { TrainingEngine: FakeEngine };
});

vi.mock('../native/initNativeBridge', () => ({
  isNoiLinkNativeShell: () => true,
}));

vi.mock('../native/bleFirmwareReady', () => ({
  // 펌웨어 ready=true 라야 BLE connection 'unexpected' 분기가 동작한다.
  getBleFirmwareReady: () => true,
}));

// bleBridge 의 export 들은 native shell 안에서만 의미가 있고, 단위 테스트에서는
// ReactNativeWebView 가 없어 직접 호출하면 throw 한다. 화면이 import 하는 export
// 만 stub 해 silent no-op 으로 만든다.
vi.mock('../native/bleBridge', () => ({
  bleSubscribeCharacteristic: vi.fn(),
  bleUnsubscribeCharacteristic: vi.fn(),
  bleWriteControl: vi.fn(),
  bleWriteLed: vi.fn(),
  getLegacyEmittedCount: () => 0,
  getLegacyLastEmittedFrameHex: () => '',
  resetLegacyEmittedDiag: vi.fn(),
}));

// 진단 표시("모드: 레거시/차세대")가 localStorage 의존 없이 결정 가능하도록 stub.
vi.mock('../native/legacyBleMode', () => ({
  getLegacyBleMode: () => true,
}));

// MobileLayout 은 useAuth 등 컨텍스트가 무거우므로 간단한 더미로 대체.
vi.mock('../components/Layout', () => ({
  MobileLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mobile-layout">{children}</div>
  ),
}));

// ConfirmModal: isOpen 시에만 렌더되어 onConfirm/onCancel 을 직접 노출.
vi.mock('../components/ConfirmModal/ConfirmModal', () => ({
  default: ({
    isOpen,
    onConfirm,
    onCancel,
    title,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
    title: string;
  }) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <span>{title}</span>
        <button data-testid="confirm-modal-yes" onClick={onConfirm}>
          종료
        </button>
        <button data-testid="confirm-modal-no" onClick={onCancel}>
          계속
        </button>
      </div>
    ) : null,
}));

import TrainingBlinkPlay from './TrainingBlinkPlay';

type FakeEngineHandle = {
  pauseCalls: number;
  resumeCalls: number;
  destroyCalls: number;
  beginRecoveryCalls: number;
  endRecoveryCalls: number;
  getIsPaused: () => boolean;
  emitComplete: (m?: unknown) => void;
  emitElapsed: (ms: number) => void;
};

function getEngine(): FakeEngineHandle {
  const g = globalThis as { __fakeBlinkEngine__?: FakeEngineHandle };
  const eng = g.__fakeBlinkEngine__;
  if (!eng) throw new Error('FakeEngine instance not found');
  return eng;
}

function makeRunState(): TrainingRunState {
  return {
    catalogId: 'focus',
    apiMode: 'FOCUS',
    userId: 'u1',
    title: '집중력 트레이닝',
    totalDurationSec: 45,
    bpm: 120,
    level: 3,
    yieldsScore: true,
    isComposite: false,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let lastLocation: { pathname: string; state: unknown } = { pathname: '/training/blink-session', state: null };

function LocationProbe() {
  const loc = useLocation();
  lastLocation = { pathname: loc.pathname, state: loc.state };
  return null;
}

function renderApp(initialState: TrainingRunState | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter
        initialEntries={[{ pathname: '/training/blink-session', state: initialState }]}
      >
        <Routes>
          <Route path="/training/blink-session" element={<TrainingBlinkPlay />} />
          <Route path="/training" element={<div data-testid="training-list">목록</div>} />
          <Route path="/result" element={<div data-testid="result-screen">결과</div>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  lastLocation = { pathname: '/training/blink-session', state: null };
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = null;
  root = null;
  (globalThis as { __fakeBlinkEngine__?: unknown }).__fakeBlinkEngine__ = undefined;
  vi.useRealTimers();
});

describe('TrainingBlinkPlay', () => {
  it('일시정지 버튼이 engine.pause() 를, 다시 누르면 engine.resume() 을 호출한다', () => {
    renderApp(makeRunState());
    const eng = getEngine();
    expect(eng.pauseCalls).toBe(0);
    expect(eng.resumeCalls).toBe(0);

    const btn = container!.querySelector('[data-testid="pause-resume-button"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();

    act(() => {
      btn.click();
    });
    expect(eng.pauseCalls).toBe(1);
    expect(eng.resumeCalls).toBe(0);

    act(() => {
      btn.click();
    });
    expect(eng.pauseCalls).toBe(1);
    expect(eng.resumeCalls).toBe(1);
  });

  it('엔진 자연 종료 시 결과 화면(blinkOnly=true)으로 이동한다', () => {
    renderApp(makeRunState());
    const eng = getEngine();

    act(() => {
      eng.emitComplete();
    });
    // useEffect 가 navigate 를 발사할 수 있도록 한 turn 흘림.
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(lastLocation.pathname).toBe('/result');
    expect(lastLocation.state).toMatchObject({
      title: '집중력 트레이닝',
      yieldsScore: false,
      blinkOnly: true,
    });
  });

  it('취소 버튼 → 모달 → 종료 확정 시 engine.destroy() + 목록 화면 복귀', () => {
    renderApp(makeRunState());
    const eng = getEngine();

    const cancelBtn = container!.querySelector('[data-testid="cancel-button"]') as HTMLButtonElement;
    act(() => {
      cancelBtn.click();
    });
    // 취소를 누르면 우선 일시정지가 걸려야 한다(점등이 모달 동안 계속되지 않게).
    expect(eng.pauseCalls).toBe(1);
    const modal = container!.querySelector('[data-testid="confirm-modal"]');
    expect(modal).toBeTruthy();

    const yes = container!.querySelector('[data-testid="confirm-modal-yes"]') as HTMLButtonElement;
    act(() => {
      yes.click();
    });
    expect(eng.destroyCalls).toBeGreaterThan(0);
    expect(lastLocation.pathname).toBe('/training');
  });

  it('취소 모달에서 "계속" 누르면 화면을 유지한다', () => {
    renderApp(makeRunState());
    const eng = getEngine();

    const cancelBtn = container!.querySelector('[data-testid="cancel-button"]') as HTMLButtonElement;
    act(() => {
      cancelBtn.click();
    });
    expect(eng.pauseCalls).toBe(1);

    const no = container!.querySelector('[data-testid="confirm-modal-no"]') as HTMLButtonElement;
    act(() => {
      no.click();
    });
    // 모달이 닫히고, destroy 는 호출되지 않으며, 화면은 그대로.
    expect(container!.querySelector('[data-testid="confirm-modal"]')).toBeNull();
    expect(eng.destroyCalls).toBe(0);
    expect(lastLocation.pathname).toBe('/training/blink-session');
  });

  it('BLE retry-failed 알림이 오면 즉시 목록 화면으로 복귀한다', () => {
    renderApp(makeRunState());
    const eng = getEngine();

    const detail: NativeToWebMessage = {
      type: 'ble.connection',
      payload: { connected: null, reason: 'retry-failed' },
    } as unknown as NativeToWebMessage;
    act(() => {
      window.dispatchEvent(new CustomEvent('noilink-native-bridge', { detail }));
    });

    expect(eng.destroyCalls).toBeGreaterThan(0);
    expect(lastLocation.pathname).toBe('/training');
    expect(lastLocation.state).toMatchObject({ abortReason: 'ble-disconnect' });
  });

  it('BPM 카드에 사용자 BPM 이 표시된다', () => {
    renderApp(makeRunState());
    const card = container!.querySelector('[data-testid="bpm-card"]');
    expect(card?.textContent).toContain('120');
  });

  it('잘못된 진입(state 누락)은 목록 화면으로 리다이렉트한다', () => {
    renderApp(null);
    expect(lastLocation.pathname).toBe('/training');
  });
});
