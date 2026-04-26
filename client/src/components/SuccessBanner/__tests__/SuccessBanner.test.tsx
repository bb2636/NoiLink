/**
 * `SuccessBanner` 회귀 테스트.
 *
 * 보호 항목 (Task #129):
 *  1. `showCloseButton` 미설정 시 X 닫기 버튼이 렌더되지 않는다 — 기존 호출부
 *     (BLE 안정성 안내 등) 의 시각적 변화가 없다.
 *  2. `showCloseButton` 이 켜지면 aria-label="닫기" 의 X 버튼이 렌더된다.
 *  3. X 버튼 클릭 시 `onUserClose` 가 호출되며 `onClose` (timeout 경로) 는 호출되지 않는다.
 *     → 텔레메트리에서 user-dismiss 가 진짜 사용자 행동만을 의미하도록 분리.
 *  4. `onUserClose` 가 미제공이고 X 가 눌리면 폴백으로 `onClose` 가 호출된다.
 *  5. 자동 닫힘 timeout 이 발화하면 `onClose` 만 호출되고 `onUserClose` 는 호출되지 않는다.
 *
 * framer-motion 의 AnimatePresence 는 jsdom 에서 exit 애니메이션이 깨끗이 끝나지
 * 않을 수 있으나, X 버튼 클릭 / timeout 발화의 콜백 호출 자체에는 영향이 없다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import SuccessBanner from '../SuccessBanner';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  unmountApp();
  vi.useRealTimers();
});

function getCloseButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="닫기"]');
}

describe('SuccessBanner — X 닫기 버튼 (Task #129)', () => {
  it('showCloseButton 미설정 시 X 버튼이 렌더되지 않는다', () => {
    render(
      <SuccessBanner
        isOpen
        message="안내"
        autoClose={false}
        onClose={() => {}}
      />,
    );
    expect(getCloseButton()).toBeNull();
  });

  it('showCloseButton 이 켜지면 X 버튼이 노출된다', () => {
    render(
      <SuccessBanner
        isOpen
        message="안내"
        autoClose={false}
        showCloseButton
      />,
    );
    const btn = getCloseButton();
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe('×');
  });

  it('X 버튼 클릭은 onUserClose 만 호출하고 onClose 는 호출하지 않는다', () => {
    const onClose = vi.fn();
    const onUserClose = vi.fn();
    render(
      <SuccessBanner
        isOpen
        message="안내"
        autoClose={false}
        showCloseButton
        onClose={onClose}
        onUserClose={onUserClose}
      />,
    );

    const btn = getCloseButton();
    act(() => {
      btn!.click();
    });

    expect(onUserClose).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('onUserClose 가 미제공이면 X 버튼은 폴백으로 onClose 를 호출한다', () => {
    const onClose = vi.fn();
    render(
      <SuccessBanner
        isOpen
        message="안내"
        autoClose={false}
        showCloseButton
        onClose={onClose}
      />,
    );

    const btn = getCloseButton();
    act(() => {
      btn!.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('자동 닫힘 timeout 은 onClose 만 호출하고 onUserClose 는 호출하지 않는다', () => {
    const onClose = vi.fn();
    const onUserClose = vi.fn();
    render(
      <SuccessBanner
        isOpen
        message="안내"
        autoClose
        duration={1000}
        showCloseButton
        onClose={onClose}
        onUserClose={onUserClose}
      />,
    );

    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUserClose).not.toHaveBeenCalled();
  });
});
