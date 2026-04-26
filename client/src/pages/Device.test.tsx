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
    expect(banner!.textContent).toBe('내부 오류: Device is not connected');
    // 디버그 키 대괄호가 붙지 않아야 한다.
    expect(banner!.textContent).not.toContain('[');
  });

  it('ok=true ack 는 토스트를 띄우지 않는다', () => {
    renderDevice();
    dispatchAck({ id: 'req-3', ok: true });
    expect(getBanner()).toBeNull();
  });
});
