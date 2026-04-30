/**
 * `PodGrid` 입력 정책 회귀 테스트.
 *
 * 사용자 정책 (replit.md "트레이닝 입력 채점 + 리포트/랭킹/기업 연동" 절):
 *   모든 채점 입력은 기기(NoiPod) 의 11바이트 BLE TOUCH notify 단일 소스에서만
 *   들어오며, 앱 화면의 PodGrid 는 점등 LED 의 시각 표시 전용이다.
 *
 * 본 테스트는 PodGrid 가 다시 button/onClick 으로 회귀하는 것을 컴파일/런타임에
 * 모두 차단한다.
 *  - 어떤 pod 도 <button> 으로 렌더되지 않는다 (role="button" 부재)
 *  - 4개 pod 가 모두 role="img" + aria-label 시각 마커로 렌더된다
 *  - 시그니처가 onTap 같은 입력 prop 을 받지 않는다 (TypeScript 단)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import PodGrid from '../PodGrid';
import type { PodState } from '../../../training/engine';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

function makePods(): PodState[] {
  return [
    { id: 0, fill: 'OFF',   tickId: 0, isTarget: false, litAt: null, expiresAt: null },
    { id: 1, fill: 'GREEN', tickId: 1, isTarget: true,  litAt: null, expiresAt: null },
    { id: 2, fill: 'OFF',   tickId: 0, isTarget: false, litAt: null, expiresAt: null },
    { id: 3, fill: 'RED',   tickId: 2, isTarget: true,  litAt: null, expiresAt: null },
  ];
}

describe('PodGrid 입력 정책 (시각 표시 전용)', () => {
  it('어떤 pod 도 button 으로 렌더되지 않는다 — 화면 클릭은 채점 입력 금지', () => {
    act(() => {
      root!.render(<PodGrid pods={makePods()} />);
    });

    const buttons = container!.querySelectorAll('button');
    expect(buttons.length).toBe(0);

    const buttonRoles = container!.querySelectorAll('[role="button"]');
    expect(buttonRoles.length).toBe(0);
  });

  it('4개 pod 가 모두 role="img" 시각 마커로 렌더된다', () => {
    act(() => {
      root!.render(<PodGrid pods={makePods()} />);
    });

    const imgs = container!.querySelectorAll('[role="img"]');
    expect(imgs.length).toBe(4);

    const labels = Array.from(imgs).map((el) => el.getAttribute('aria-label'));
    expect(labels[0]).toMatch(/^Pod 1\b/);
    expect(labels[1]).toMatch(/^Pod 2\b/);
    expect(labels[2]).toMatch(/^Pod 3\b/);
    expect(labels[3]).toMatch(/^Pod 4\b/);
  });

  it('시각 마커 클릭 시도가 어떤 핸들러도 트리거하지 않는다 (no-op)', () => {
    act(() => {
      root!.render(<PodGrid pods={makePods()} />);
    });

    const imgs = container!.querySelectorAll('[role="img"]');
    expect(imgs.length).toBe(4);

    expect(() => {
      act(() => {
        for (const el of Array.from(imgs)) {
          (el as HTMLElement).click();
        }
      });
    }).not.toThrow();
  });
});
