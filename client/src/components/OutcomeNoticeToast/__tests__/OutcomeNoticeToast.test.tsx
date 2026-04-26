/**
 * 글로벌 outcome notice 토스트(Task #72) 동작 회귀 테스트.
 *
 * 보호 항목:
 *  - drain 이 결과(success / final-failure)를 push 하면 어떤 화면에 있든 즉시
 *    SuccessBanner 가 노출된다.
 *  - 토스트가 노출되는 순간 영속 큐에서 같은 localId 가 제거된다 — 트레이닝 목록
 *    화면(Training.tsx)에서 popOutcomeNotices 로 큐를 비울 때 같은 결과가 다시
 *    안내되지 않는다(중복 노출 방지).
 *  - 짧은 시간에 여러 push 가 들어오면 한 번에 하나씩 노출되고, dismiss 후 다음
 *    항목으로 넘어간다.
 *
 * SuccessBanner 의 framer-motion / setTimeout 부수효과는 단언과 무관하므로 가벼운
 * 더미로 대체한다(Training.test.tsx 와 같은 패턴).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../SuccessBanner/SuccessBanner', () => ({
  default: ({
    isOpen,
    message,
    backgroundColor,
    textColor,
    onClose,
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
        data-testid="outcome-toast"
        data-background={backgroundColor ?? ''}
        data-text-color={textColor ?? ''}
      >
        <span data-testid="outcome-toast-message">{message}</span>
        <button
          data-testid="outcome-toast-dismiss"
          type="button"
          onClick={() => onClose?.()}
        >
          dismiss
        </button>
      </div>
    ) : null,
}));

import OutcomeNoticeToast from '../OutcomeNoticeToast';
import {
  __resetPendingTrainingRunsForTest,
  popOutcomeNotices,
  pushOutcomeNotice,
} from '../../../utils/pendingTrainingRuns';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<OutcomeNoticeToast />);
  });
}

function unmount() {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
}

function getToast(): HTMLElement | null {
  return container?.querySelector('[data-testid="outcome-toast"]') as HTMLElement | null;
}

function getToastMessage(): string | null {
  const el = container?.querySelector('[data-testid="outcome-toast-message"]');
  return el?.textContent ?? null;
}

function dismissToast() {
  const btn = container?.querySelector(
    '[data-testid="outcome-toast-dismiss"]',
  ) as HTMLButtonElement | null;
  if (!btn) throw new Error('no dismiss button');
  act(() => {
    btn.click();
  });
}

beforeEach(() => {
  __resetPendingTrainingRunsForTest();
});

afterEach(() => {
  unmount();
  __resetPendingTrainingRunsForTest();
});

describe('OutcomeNoticeToast — 포그라운드 drain 결과 즉시 안내 (Task #72)', () => {
  it('마운트 직후엔 표시할 결과가 없으면 토스트가 렌더되지 않는다', () => {
    mount();
    expect(getToast()).toBeNull();
  });

  it('성공 push 가 오면 즉시 success 톤(#1E2F1A/#AAED10) 토스트가 노출된다', () => {
    mount();
    expect(getToast()).toBeNull();

    act(() => {
      pushOutcomeNotice({
        localId: 'live-1',
        outcome: 'success',
        title: '집중력',
        at: 1,
      });
    });

    const toast = getToast();
    expect(toast).not.toBeNull();
    expect(toast!.dataset.background).toBe('#1E2F1A');
    expect(toast!.dataset.textColor).toBe('#AAED10');
    expect(getToastMessage()).toContain("'집중력'");
    expect(getToastMessage()).toContain('백그라운드');
  });

  it('final-failure push 가 오면 warning 톤(#F59E0B/#1A1A1A) 토스트가 노출된다', () => {
    mount();

    act(() => {
      pushOutcomeNotice({
        localId: 'live-2',
        outcome: 'final-failure',
        title: '판단력',
        lastError: 'down',
        at: 2,
      });
    });

    const toast = getToast();
    expect(toast).not.toBeNull();
    expect(toast!.dataset.background).toBe('#F59E0B');
    expect(toast!.dataset.textColor).toBe('#1A1A1A');
    expect(getToastMessage()).toContain("'판단력'");
    expect(getToastMessage()).toContain('저장하지 못했어요');
  });

  it('토스트 노출 직후 영속 큐에서 같은 localId 가 제거된다 — 트레이닝 목록과 중복 노출되지 않는다', () => {
    mount();

    act(() => {
      pushOutcomeNotice({
        localId: 'dedupe-1',
        outcome: 'success',
        title: '기억력',
        at: 3,
      });
    });

    // 토스트가 떠 있는 동안에도 popOutcomeNotices 는 같은 항목을 다시 돌려주지 않는다.
    // (Training.tsx 가 다음에 마운트되더라도 같은 결과가 한 번 더 안내되지 않는 것을 보장)
    expect(popOutcomeNotices()).toEqual([]);
  });

  it('두 건이 연달아 들어오면 한 번에 하나씩 노출되고, dismiss 후 다음 결과로 넘어간다', () => {
    mount();

    act(() => {
      pushOutcomeNotice({
        localId: 'a',
        outcome: 'success',
        title: '집중력',
        at: 1,
      });
      pushOutcomeNotice({
        localId: 'b',
        outcome: 'final-failure',
        title: '판단력',
        lastError: 'down',
        at: 2,
      });
    });

    // 첫 번째: 가장 먼저 들어온 success 가 보인다.
    expect(getToastMessage()).toContain("'집중력'");
    expect(getToast()!.dataset.background).toBe('#1E2F1A');

    // dismiss → 다음 항목(final-failure)이 노출된다.
    dismissToast();
    expect(getToastMessage()).toContain("'판단력'");
    expect(getToast()!.dataset.background).toBe('#F59E0B');

    // 두 항목 모두 영속 큐에서도 제거된 상태여야 한다.
    expect(popOutcomeNotices()).toEqual([]);

    // dismiss → 더 이상 표시할 결과가 없어 토스트가 사라진다.
    dismissToast();
    expect(getToast()).toBeNull();
  });

  it('같은 localId 의 후속 push 는 토스트 큐를 늘리지 않고 최신 상태로 갱신한다', () => {
    mount();

    act(() => {
      pushOutcomeNotice({
        localId: 'same',
        outcome: 'success',
        title: '집중력',
        at: 1,
      });
    });
    expect(getToastMessage()).toContain("'집중력'");
    expect(getToast()!.dataset.background).toBe('#1E2F1A');

    // 같은 localId 로 상태가 바뀐 push 가 다시 들어온다.
    act(() => {
      pushOutcomeNotice({
        localId: 'same',
        outcome: 'final-failure',
        title: '집중력',
        lastError: 'late',
        at: 2,
      });
    });

    // 토스트는 여전히 1개만, 그러나 최신 상태(final-failure)로 갱신.
    expect(getToastMessage()).toContain('저장하지 못했어요');
    expect(getToast()!.dataset.background).toBe('#F59E0B');

    dismissToast();
    expect(getToast()).toBeNull();
  });

  it('unmount 후 push 가 오면 영속 큐에는 남고(다음 마운트가 처리), 토스트는 뜨지 않는다', () => {
    mount();
    unmount();

    pushOutcomeNotice({
      localId: 'after-unmount',
      outcome: 'success',
      title: '집중력',
      at: 1,
    });

    // 토스트는 떠 있지 않다(컨테이너 자체가 없다).
    expect(container).toBeNull();
    // 영속 큐에는 그대로 남아 다음 트레이닝 목록 진입 때 안내된다.
    const popped = popOutcomeNotices();
    expect(popped).toHaveLength(1);
    expect(popped[0].localId).toBe('after-unmount');
  });
});
