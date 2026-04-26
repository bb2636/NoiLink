/**
 * DeviceAdd 페이지 — 브릿지 거부(ack ok=false) 토스트 회귀 테스트 (Task #104)
 *
 * 보호 대상:
 *   - 페어링 화면 진입 직후 자동 스캔 도중 `noilink-native-ack` (ok=false) 가 오면
 *     한국어 안내 + 디버그 키가 SuccessBanner 토스트로 노출된다.
 *   - 자유 문자열 (예: `Device is not connected`) 도 디버그 키 없이 그대로 보인다.
 *   - ok=true ack 는 토스트를 띄우지 않는다.
 *
 * Task #77 의 단위 테스트(`client/src/native/__tests__/nativeAckErrors.test.ts`) 가
 * 파서/구독만 검증하므로, 실제 페이지 컴포넌트가 이벤트를 수신해 SuccessBanner
 * 까지 그려내는지 보호하기 위한 화면-수준 회귀 테스트.
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

// 자동 스캔 진입 시 호출되는 BLE 브릿지 함수들 — 모두 no-op.
vi.mock('../native/bleBridge', () => ({
  bleEnsureReady: vi.fn(),
  bleStartScan: vi.fn(),
  bleStopScan: vi.fn(),
  bleConnect: vi.fn(),
}));

vi.mock('../native/initNativeBridge', () => ({
  isNoiLinkNativeShell: () => true,
}));

import DeviceAdd from './DeviceAdd';

// ───────────────────────────────────────────────────────────
// 헬퍼
// ───────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderDeviceAdd() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={['/device/add']}>
        <DeviceAdd />
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

describe('DeviceAdd — 브릿지 거부 토스트 (Task #77 / #104)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    unmountApp();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('ok=false ack (구조화된 사유) 가 오면 한국어 안내 + 디버그 키가 화면에 보인다', () => {
    renderDeviceAdd();

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
    expect(banner!.dataset.background).toBe('#3a1212');
    expect(banner!.dataset.textColor).toBe('#fca5a5');
  });

  it('자유 문자열(BleManagerError.message 등) 도 디버그 키 없이 노출된다', () => {
    renderDeviceAdd();
    dispatchAck({ id: 'req-2', ok: false, error: 'Device is not connected' });

    const banner = getBanner();
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toBe('내부 오류: Device is not connected');
    expect(banner!.textContent).not.toContain('[');
  });

  it('ok=true ack 는 토스트를 띄우지 않는다', () => {
    renderDeviceAdd();
    dispatchAck({ id: 'req-3', ok: true });
    expect(getBanner()).toBeNull();
  });
});
