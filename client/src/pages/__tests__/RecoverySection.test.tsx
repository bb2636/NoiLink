/**
 * RecoverySection (components/RecoverySection.tsx) 컴포넌트 회귀 테스트
 * (Task #99 / Task #74 / Task #107 — 홈에서 분리된 단일 책임 파일을 직접 렌더).
 *
 * 유틸 단위 테스트(`recoveryCoachingDismissal.test.ts`)는 localStorage 키 정책을
 * 잠그지만, 실제로 사용자가 겪는 시나리오 — "환경 점검" 카드를 닫고 다른 페이지로
 * 갔다가 홈으로 돌아왔을 때 같은 트립이면 다시 안 뜨고, 트립이 끝났다 다시 시작되면
 * 다시 뜬다 — 는 `RecoverySection` 의 useEffect 동기화에 달려 있다. 이 테스트는
 * 그 컴포넌트 동작을 unmount/remount 사이클로 직접 검증해, useEffect 흐름이 회귀로
 * 깨졌을 때 빠르게 잡히도록 한다.
 *
 * 잠그는 시나리오:
 *  1. 닫힘 → 같은 트립으로 remount → 카드는 다시 노출되지 않는다.
 *  2. 닫힘 → 트립 종료(showCoaching=false)로 remount → 닫힘 기억이 자동 정리된다.
 *     → 다시 임계 초과 트립으로 remount 하면 카드가 새 안내로 등장한다.
 *  3. 서로 다른 userId 로 마운트하면 닫힘 상태가 섞이지 않는다(계정 격리).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AggregatedRecoveryStats } from '@noilink/shared';

import { RecoverySection } from '../../components/RecoverySection';
import { recoveryCoachingDismissalKey } from '../../utils/recoveryCoachingDismissal';

// React 18 의 act() 가 jsdom 환경에서 정상 동작하도록 플래그를 켠다.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// 임계 초과(=showCoaching true) 통계 — sessionsCount ≥ 3, 평균 ≥ 30초.
const TRIP_ACTIVE_STATS: AggregatedRecoveryStats = {
  sessionsCount: 5,
  sessionsWithRecovery: 3,
  totalMs: 200_000,
  windowsTotal: 6,
  avgMsPerSession: 40_000,
};

// 회복은 있지만 평균이 임계 미만 → 카드 자체는 노출되되 "환경 점검" 안내는 숨김.
// (sessionsWithRecovery > 0 라야 카드가 통째로 숨겨지지 않는다 — 그래야 트립
// 종료 시 닫힘 기억 자동 정리가 useEffect 로 실행되었는지를 카드 안에서 확인 가능.)
const TRIP_ENDED_STATS: AggregatedRecoveryStats = {
  sessionsCount: 5,
  sessionsWithRecovery: 1,
  totalMs: 5_000,
  windowsTotal: 1,
  avgMsPerSession: 1_000,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(node: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(node);
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

function coachingCard(): HTMLElement | null {
  return (
    container?.querySelector<HTMLElement>('[data-testid="recovery-coaching-card"]') ?? null
  );
}

function dismissButton(): HTMLButtonElement | null {
  return (
    container?.querySelector<HTMLButtonElement>(
      '[data-testid="recovery-coaching-dismiss"]',
    ) ?? null
  );
}

function clickDismiss() {
  const btn = dismissButton();
  if (!btn) throw new Error('회복 코칭 닫기 버튼을 찾지 못했습니다');
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('RecoverySection — 회복 안내 닫힘 기억의 페이지 재진입 회귀 (Task #99)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    unmount();
    localStorage.clear();
  });

  it('닫은 뒤 같은 트립으로 다시 마운트해도 안내가 다시 뜨지 않는다', () => {
    mount(<RecoverySection stats={TRIP_ACTIVE_STATS} userId="user-a" />);

    // 첫 마운트: 임계 초과이므로 안내 카드가 노출된다.
    expect(coachingCard()).not.toBeNull();

    // 사용자가 × 로 닫는다.
    clickDismiss();
    expect(coachingCard()).toBeNull();
    // 닫힘 기억이 localStorage 에 영속화되었는지 키 차원에서도 확인.
    expect(localStorage.getItem(recoveryCoachingDismissalKey('user-a')!)).not.toBeNull();

    // 다른 페이지로 떠났다가 홈으로 돌아오는 흐름을 unmount → mount 로 흉내낸다.
    // 통계는 여전히 임계 초과(=같은 트립).
    unmount();
    mount(<RecoverySection stats={TRIP_ACTIVE_STATS} userId="user-a" />);

    // 같은 트립 동안에는 다시 노출되어선 안 된다 — 회귀 방지.
    expect(coachingCard()).toBeNull();
  });

  it('트립이 끝나면 닫힘 기억이 자동 정리되고, 새 트립에서 다시 노출된다', () => {
    mount(<RecoverySection stats={TRIP_ACTIVE_STATS} userId="user-a" />);
    expect(coachingCard()).not.toBeNull();
    clickDismiss();
    expect(coachingCard()).toBeNull();
    expect(localStorage.getItem(recoveryCoachingDismissalKey('user-a')!)).not.toBeNull();

    // 신호가 임계 미만으로 떨어진 상태로 홈에 다시 진입 — useEffect 가 트립 종료를
    // 감지하고 닫힘 기억을 비워야 한다.
    unmount();
    mount(<RecoverySection stats={TRIP_ENDED_STATS} userId="user-a" />);

    // 임계 미만이라 안내 자체는 보이지 않는다.
    expect(coachingCard()).toBeNull();
    // 그러나 닫힘 기억은 자동으로 정리되어 있어야 한다 — 다음 트립에서 재등장 보장.
    expect(localStorage.getItem(recoveryCoachingDismissalKey('user-a')!)).toBeNull();

    // 신호가 다시 임계를 넘은 새 트립으로 재진입 → 안내가 다시 떠야 한다.
    unmount();
    mount(<RecoverySection stats={TRIP_ACTIVE_STATS} userId="user-a" />);
    expect(coachingCard()).not.toBeNull();
  });

  it('서로 다른 userId 의 닫힘 상태가 섞이지 않는다 (계정 격리)', () => {
    // user-a 가 안내를 닫는다.
    mount(<RecoverySection stats={TRIP_ACTIVE_STATS} userId="user-a" />);
    clickDismiss();
    expect(coachingCard()).toBeNull();

    // 같은 트립 통계로 user-b 가 마운트하면 — 닫힘 기억은 user-a 에만 있으므로
    // user-b 에게는 안내가 그대로 노출되어야 한다.
    unmount();
    mount(<RecoverySection stats={TRIP_ACTIVE_STATS} userId="user-b" />);
    expect(coachingCard()).not.toBeNull();

    // 반대 방향도 검증 — user-b 만 닫고 user-a 로 다시 마운트하면, user-a 의
    // 닫힘 기억은 그대로 유지되어 안내가 보이지 않아야 한다.
    clickDismiss();
    expect(coachingCard()).toBeNull();
    unmount();
    mount(<RecoverySection stats={TRIP_ACTIVE_STATS} userId="user-a" />);
    expect(coachingCard()).toBeNull();
  });

  it('userId 가 바뀌면 새 사용자의 저장값으로 다시 동기화된다 (remount 없이도)', () => {
    // 처음엔 user-a 로 마운트해 닫는다.
    mount(<RecoverySection stats={TRIP_ACTIVE_STATS} userId="user-a" />);
    clickDismiss();
    expect(coachingCard()).toBeNull();

    // 같은 RecoverySection 인스턴스에 prop 으로 다른 userId 를 넘긴다 —
    // useEffect([userId]) 가 user-b 의 저장값(=없음)으로 다시 동기화해야 한다.
    act(() => {
      root!.render(<RecoverySection stats={TRIP_ACTIVE_STATS} userId="user-b" />);
    });
    expect(coachingCard()).not.toBeNull();

    // 다시 user-a 로 돌리면 user-a 의 닫힘 기억이 복원되어야 한다.
    act(() => {
      root!.render(<RecoverySection stats={TRIP_ACTIVE_STATS} userId="user-a" />);
    });
    expect(coachingCard()).toBeNull();
  });
});
