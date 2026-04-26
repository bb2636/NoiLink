/**
 * 트레이닝 목록 화면(Training.tsx)의 BLE 자동 종료 안내 배너 회귀 테스트
 *
 * Task #43 정책:
 *  - location.state.abortReason === 'ble-disconnect' 이고 bleUnstable === true 면
 *    배너 메시지에 환경 점검 한 줄("기기 연결이 자주 끊겼어요. 거리·간섭을 확인해 보세요.")이
 *    줄바꿈으로 덧붙고, 톤이 노란색(caution: 배경 #3A2A00 / 글자 #FFD66B)으로 바뀐다.
 *  - bleUnstable 이 false 이거나 누락이면 기존 메시지 한 줄만 노출되고 톤은 그대로
 *    'warning'(배경 #F59E0B / 글자 #1A1A1A) 이다.
 *  - 'background' / 'save-failed' 사유는 bleUnstable 값을 무시한다 — 잘못된 타입으로
 *    들어와도 톤·메시지 모두 안전 회귀.
 *
 * SuccessBanner / MobileLayout 은 BLE 분기 외 부수효과(framer-motion exit, useAuth 등)를
 * 가지므로 가벼운 더미로 대체하고, 배너에 전달된 props 만 검사한다.
 * (TrainingSessionPlay.test.tsx 와 동일한 모킹 패턴.)
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// ───────────────────────────────────────────────────────────
// 의존성 모킹 — 배너 props 검사 외 부수효과 제거
// (모듈 평가 전에 등록되어야 하므로 import 보다 앞에 둔다)
// ───────────────────────────────────────────────────────────

// MobileLayout 은 useAuth/네비게이션 컨텍스트 등 무거운 의존성을 가진다.
vi.mock('../components/Layout', () => ({
  MobileLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mobile-layout">{children}</div>
  ),
}));

// SuccessBanner: 전달된 props 를 모두 DOM data-* 속성으로 노출해 단언이 쉽도록 한다.
// isOpen=false 면 아무것도 렌더하지 않아 활성 배너 유무도 확인할 수 있다.
vi.mock('../components/SuccessBanner/SuccessBanner', () => ({
  default: ({
    isOpen,
    message,
    backgroundColor,
    textColor,
  }: {
    isOpen: boolean;
    message: string;
    onClose?: () => void;
    autoClose?: boolean;
    duration?: number;
    backgroundColor?: string;
    textColor?: string;
  }) =>
    isOpen ? (
      <div
        data-testid="success-banner"
        data-background={backgroundColor ?? ''}
        data-text-color={textColor ?? ''}
      >
        {message}
      </div>
    ) : null,
}));

// 백그라운드 drain 결과 큐는 이번 회귀 테스트의 관심사가 아니므로 항상 비어있게 둔다.
// (실제 구현은 sessionStorage 를 사용하므로 jsdom 에서도 동작하지만, 테스트 격리를 위해 명시적으로 모킹.)
vi.mock('../utils/pendingTrainingRuns', () => ({
  popOutcomeNotices: () => [],
}));

import Training from './Training';
import { TRAINING_ABORT_NOTICE, TRAINING_BLE_UNSTABLE_HINT } from './trainingAbortReason';

// ───────────────────────────────────────────────────────────
// 헬퍼
// ───────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderAt(state: unknown) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[{ pathname: '/training', state }]}>
        <Routes>
          <Route path="/training" element={<Training />} />
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

function getBanner(): HTMLElement | null {
  return container?.querySelector('[data-testid="success-banner"]') as HTMLElement | null;
}

// ───────────────────────────────────────────────────────────
// 테스트
// ───────────────────────────────────────────────────────────

describe('Training — BLE 자동 종료 안내 배너 (Task #43)', () => {
  afterEach(() => {
    unmountApp();
    vi.clearAllMocks();
  });

  it("ble-disconnect + bleUnstable=true 면 환경 점검 한 줄과 노란 톤(#3A2A00/#FFD66B) 이 적용된다", () => {
    renderAt({ abortReason: 'ble-disconnect', bleUnstable: true });

    const banner = getBanner();
    expect(banner).not.toBeNull();

    // 메시지: 기본 안내 + 줄바꿈 + 환경 점검 한 줄.
    const baseMessage = TRAINING_ABORT_NOTICE['ble-disconnect'].message;
    expect(banner!.textContent).toContain(baseMessage);
    expect(banner!.textContent).toContain(TRAINING_BLE_UNSTABLE_HINT);
    expect(banner!.textContent).toBe(`${baseMessage}\n${TRAINING_BLE_UNSTABLE_HINT}`);

    // 톤: caution(노란 톤).
    expect(banner!.dataset.background).toBe('#3A2A00');
    expect(banner!.dataset.textColor).toBe('#FFD66B');
  });

  it('ble-disconnect + bleUnstable=false 면 기존 메시지 한 줄만, warning 톤(#F59E0B/#1A1A1A) 이 그대로 유지된다', () => {
    renderAt({ abortReason: 'ble-disconnect', bleUnstable: false });

    const banner = getBanner();
    expect(banner).not.toBeNull();

    const baseMessage = TRAINING_ABORT_NOTICE['ble-disconnect'].message;
    expect(banner!.textContent).toBe(baseMessage);
    expect(banner!.textContent).not.toContain(TRAINING_BLE_UNSTABLE_HINT);

    expect(banner!.dataset.background).toBe('#F59E0B');
    expect(banner!.dataset.textColor).toBe('#1A1A1A');
  });

  it('ble-disconnect + bleUnstable 누락이면 false 와 동일하게 동작한다', () => {
    renderAt({ abortReason: 'ble-disconnect' });

    const banner = getBanner();
    expect(banner).not.toBeNull();

    const baseMessage = TRAINING_ABORT_NOTICE['ble-disconnect'].message;
    expect(banner!.textContent).toBe(baseMessage);
    expect(banner!.textContent).not.toContain(TRAINING_BLE_UNSTABLE_HINT);

    expect(banner!.dataset.background).toBe('#F59E0B');
    expect(banner!.dataset.textColor).toBe('#1A1A1A');
  });

  it("background 사유에서는 bleUnstable=true 가 들어와도 무시된다 (neutral 톤·기본 메시지 유지)", () => {
    renderAt({ abortReason: 'background', bleUnstable: true });

    const banner = getBanner();
    expect(banner).not.toBeNull();

    const baseMessage = TRAINING_ABORT_NOTICE.background.message;
    expect(banner!.textContent).toBe(baseMessage);
    expect(banner!.textContent).not.toContain(TRAINING_BLE_UNSTABLE_HINT);

    // neutral 톤: 검정 배경 / 흰 글자.
    expect(banner!.dataset.background).toBe('#1A1A1A');
    expect(banner!.dataset.textColor).toBe('#FFFFFF');
  });

  it("save-failed 사유에서는 bleUnstable=true 가 들어와도 무시된다 (warning 톤·기본 메시지 유지)", () => {
    renderAt({ abortReason: 'save-failed', bleUnstable: true });

    const banner = getBanner();
    expect(banner).not.toBeNull();

    const baseMessage = TRAINING_ABORT_NOTICE['save-failed'].message;
    expect(banner!.textContent).toBe(baseMessage);
    expect(banner!.textContent).not.toContain(TRAINING_BLE_UNSTABLE_HINT);

    // 기존 warning 톤 그대로.
    expect(banner!.dataset.background).toBe('#F59E0B');
    expect(banner!.dataset.textColor).toBe('#1A1A1A');
  });

  it("ble-disconnect + bleUnstable 가 잘못된 타입(문자열) 으로 들어오면 false 로 안전 회귀한다", () => {
    // 외부(네이티브 셸/구버전 코드)에서 잘못된 타입이 흘러들어와도 톤이 흔들리면 안 된다.
    renderAt({ abortReason: 'ble-disconnect', bleUnstable: 'true' });

    const banner = getBanner();
    expect(banner).not.toBeNull();

    const baseMessage = TRAINING_ABORT_NOTICE['ble-disconnect'].message;
    expect(banner!.textContent).toBe(baseMessage);
    expect(banner!.textContent).not.toContain(TRAINING_BLE_UNSTABLE_HINT);
    expect(banner!.dataset.background).toBe('#F59E0B');
    expect(banner!.dataset.textColor).toBe('#1A1A1A');
  });

  it('save-failed + bleUnstable 가 잘못된 타입(문자열) 으로 들어와도 warning 톤·기본 메시지가 유지된다', () => {
    // ble-disconnect 외 사유에서는 bleUnstable 값 자체가 무시되므로 타입이
    // 망가져도 사용자에게 보이는 메시지/톤이 흔들리면 안 된다.
    renderAt({ abortReason: 'save-failed', bleUnstable: 'true' });

    const banner = getBanner();
    expect(banner).not.toBeNull();

    const baseMessage = TRAINING_ABORT_NOTICE['save-failed'].message;
    expect(banner!.textContent).toBe(baseMessage);
    expect(banner!.textContent).not.toContain(TRAINING_BLE_UNSTABLE_HINT);
    expect(banner!.dataset.background).toBe('#F59E0B');
    expect(banner!.dataset.textColor).toBe('#1A1A1A');
  });
});
