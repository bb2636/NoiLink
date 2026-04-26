/**
 * Device 페이지 — 브릿지 거부(ack ok=false) 토스트 회귀 테스트 (Task #104)
 *
 * 보호 대상:
 *   - `noilink-native-ack` (ok=false) 이벤트가 들어오면 화면 하단의 SuccessBanner 가
 *     `formatAckErrorForBanner` 가 만든 한국어 안내 + 디버그 키 (`[type:reason@field]`) 와
 *     함께 토스트로 노출된다.
 *   - 자유 문자열 (예: `Device is not connected`) 도 디버그 키 없이 그대로 보인다.
 *   - ok=true ack 가 들어오면 토스트가 뜨지 않는다.
 *
 * Task #77 의 단위 테스트(`client/src/native/__tests__/nativeAckErrors.test.ts`) 가
 * 파서/이벤트 구독만 검증하므로, 실제 페이지 컴포넌트가 이벤트를 수신해 SuccessBanner
 * 까지 그려내는지 보호하기 위한 화면-수준 회귀 테스트.
 *
 * 본 테스트는 Device 의 BLE 연결/해제 동작은 관심사가 아니므로, 무거운 의존성
 * (MobileLayout/useAuth/native bridge) 은 가벼운 더미로 대체하고, SuccessBanner 는
 * isOpen/message/배경색을 DOM 으로 노출해 단언이 쉽도록 모킹한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// ───────────────────────────────────────────────────────────
// 의존성 모킹 — ack 토스트 외 부수효과 제거
// ───────────────────────────────────────────────────────────

vi.mock('../components/Layout', () => ({
  MobileLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mobile-layout">{children}</div>
  ),
}));

// SuccessBanner: 전달된 props 를 DOM data-* 로 노출해 톤/메시지를 한 번에 검사한다.
// isOpen=false 면 아무것도 렌더하지 않아 "토스트가 뜨지 않았다" 도 검증할 수 있다.
// `showCloseButton` 이 켜진 호출(거부 토스트 — Task #129)에서는 X 닫기 버튼을 노출해
// 사용자 닫힘 → `onUserClose` (없으면 `onClose`) 라우팅을 실 컴포넌트와 동일하게 흉내낸다.
vi.mock('../components/SuccessBanner/SuccessBanner', () => ({
  default: ({
    isOpen,
    message,
    backgroundColor,
    textColor,
    showCloseButton,
    onUserClose,
    onClose,
  }: {
    isOpen: boolean;
    message: string;
    onClose?: () => void;
    onUserClose?: () => void;
    autoClose?: boolean;
    duration?: number;
    backgroundColor?: string;
    textColor?: string;
    showCloseButton?: boolean;
  }) =>
    isOpen ? (
      <div
        data-testid="success-banner"
        data-background={backgroundColor ?? ''}
        data-text-color={textColor ?? ''}
      >
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
    ) : null,
}));

// 텔레메트리 보고는 fire-and-forget 네트워크 호출 — 단위 테스트에서는 호출 횟수만
// 검증할 수 있도록 모듈 단위로 spy 로 대체한다 (`subscribeAckErrorBanner` 의 기본
// `onTelemetry` 가 이 함수이므로 페이지가 별도 주입 없이도 본 spy 를 거친다).
vi.mock('../utils/reportAckBannerEvent', () => ({
  reportAckBannerEventFireAndForget: vi.fn(),
}));

// Device 의 BLE 액션은 본 회귀 테스트의 관심사가 아니므로 no-op 으로 둔다.
vi.mock('../native/bleBridge', () => ({
  bleConnect: vi.fn(),
  bleDisconnect: vi.fn(),
}));

vi.mock('../native/initNativeBridge', () => ({
  isNoiLinkNativeShell: () => true,
}));

// 데모 기기 시드는 localStorage 에 손을 대므로 격리를 위해 no-op.
vi.mock('../utils/seedDemoDevices', () => ({
  ensureDemoDevicesSeeded: () => {},
}));

import Device from './Device';
import { reportAckBannerEventFireAndForget } from '../utils/reportAckBannerEvent';

// ───────────────────────────────────────────────────────────
// 헬퍼
// ───────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderDevice() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={['/device']}>
        <Device />
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

function dispatchAck(detail: { id: string; ok: boolean; error?: string }) {
  act(() => {
    window.dispatchEvent(new CustomEvent('noilink-native-ack', { detail }));
  });
}

function getBanner(): HTMLElement | null {
  return container?.querySelector('[data-testid="success-banner"]') as HTMLElement | null;
}

// ───────────────────────────────────────────────────────────
// 테스트
// ───────────────────────────────────────────────────────────

describe('Device — 브릿지 거부 토스트 (Task #77 / #104)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    unmountApp();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('ok=false ack (구조화된 사유) 가 오면 한국어 안내 + 디버그 키가 화면에 보인다', () => {
    renderDevice();

    // 진입 직후에는 토스트가 없다.
    expect(getBanner()).toBeNull();

    dispatchAck({
      id: 'req-1',
      ok: false,
      error: 'ble.connect:field-missing@payload.deviceId: ble.connect: payload.deviceId is required (string)',
    });

    const banner = getBanner();
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('내부 오류: ble.connect의 deviceId 누락');
    expect(banner!.textContent).toContain('[ble.connect:field-missing@payload.deviceId]');
    // 거부 토스트는 빨간 톤으로 노출돼야 한다 (Device.tsx 의 SuccessBanner 색상).
    expect(banner!.dataset.background).toBe('#3a1212');
    expect(banner!.dataset.textColor).toBe('#fca5a5');
  });

  it('자유 문자열(BleManagerError.message 등) 도 디버그 키 없이 노출된다', () => {
    renderDevice();
    dispatchAck({ id: 'req-2', ok: false, error: 'Device is not connected' });

    const banner = getBanner();
    expect(banner).not.toBeNull();
    // X 닫기 버튼(`×`) 도 banner DOM 안에 있으므로 부분 일치로 검증한다.
    expect(banner!.textContent).toContain('내부 오류: Device is not connected');
    // 디버그 키 대괄호가 붙지 않아야 한다.
    expect(banner!.textContent).not.toContain('[');
  });

  it('ok=true ack 는 토스트를 띄우지 않는다', () => {
    renderDevice();
    dispatchAck({ id: 'req-3', ok: true });
    expect(getBanner()).toBeNull();
  });

  // Task #138 — X 버튼이 빠르게 두 번 눌려도 운영 텔레메트리는 한 건만 흘러야 한다.
  // burst 가 첫 `notifyDismissed()` 로 마감된 뒤 도착한 두 번째 호출은
  // 활성 burst 가 없어 무시된다는 단위 테스트(`nativeAckErrors.test.ts`) 의
  // 통합 회귀 보호 — 페이지가 X 클릭 → `notifyDismissed()` 를 한 번씩만 흘리는지,
  // 그리고 모듈 기본 텔레메트리 sink (`reportAckBannerEventFireAndForget`) 가
  // 정확히 한 번만 호출되는지 화면 레이어에서 보장한다.
  it('X 버튼을 두 번 눌러도 user-dismiss 텔레메트리는 한 건만 흐른다', () => {
    renderDevice();
    dispatchAck({
      id: 'req-4',
      ok: false,
      error: 'ble.connect:field-missing@payload.deviceId: payload.deviceId is required',
    });

    const reportSpy = vi.mocked(reportAckBannerEventFireAndForget);
    expect(reportSpy).not.toHaveBeenCalled();

    const closeBtn = container?.querySelector(
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
    // 첫 클릭으로 토스트는 이미 사라졌어야 한다.
    expect(getBanner()).toBeNull();
  });
});
