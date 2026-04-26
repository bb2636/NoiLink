/**
 * 결과 화면(Result.tsx) 회복 카드 회귀 테스트 — Task #60
 *
 * 보호 대상 정책 (Result.tsx 의 BLE 회복 안내 카드, Task #36 에서 추가됨):
 *   1. recoverySegments 가 비었을 때:
 *      - 카드(요약 1줄)는 노출되지만 펼치기 토글은 비활성(disabled)이다.
 *      - 펼침 영역(recovery-segment-list) 과 환경 점검 안내(recovery-env-check) 는
 *        모두 DOM 에 없다.
 *   2. recoverySegments 가 2건일 때:
 *      - 토글이 활성이고, 클릭하면 평균/최장/횟수와 segment 목록이 보인다.
 *      - 환경 점검 안내(recovery-env-check) 는 노출되지 않는다 (windows < 3).
 *   3. recoverySegments 가 3건 이상일 때:
 *      - 환경 점검 안내(recovery-env-check) 가 펼침/접힘 상태와 무관하게 노출된다.
 *
 * 카피·임계값(현재 RECOVERY_ENV_CHECK_THRESHOLD = 3) 변경이 조용히 깨지지
 * 않도록 직접 렌더링 테스트로 잠근다. 엔진 단의 `recovery.segments` 회귀는
 * `engine.metrics.test.ts` 에서 별도로 보호한다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// React 18 의 act() 가 jsdom 환경에서 정상 동작하도록 플래그를 켠다.
// (vitest jsdom 기본 환경은 IS_REACT_ACT_ENVIRONMENT 가 꺼져 있어 경고가 발생한다.)
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// ───────────────────────────────────────────────────────────
// 의존성 모킹 — 회복 카드 분기 외 부수효과 제거
// (모듈 평가 전에 등록되어야 하므로 import 보다 앞에 둔다)
// ───────────────────────────────────────────────────────────

// useAuth 는 닉네임만 사용한다 — 컨텍스트 셋업 없이 가벼운 더미로 대체.
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { nickname: '테스터' } }),
}));

// MobileLayout 자체도 useAuth/useLocation 등 컨텍스트를 쓰므로 children 만 통과시킨다.
vi.mock('../components/Layout', () => ({
  MobileLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="mobile-layout">{children}</div>
  ),
}));

import Result, { type TrainingResultState } from './Result';

// ───────────────────────────────────────────────────────────
// 헬퍼 — Result 를 location.state 와 함께 렌더한다
// ───────────────────────────────────────────────────────────

const BASE_STATE: TrainingResultState = {
  title: '집중력 트레이닝',
  displayScore: 80,
  previousScore: 70,
  yieldsScore: true,
  sessionId: 'sess-test',
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderResult(stateOverride: Partial<TrainingResultState>) {
  const state: TrainingResultState = { ...BASE_STATE, ...stateOverride };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={[{ pathname: '/result', state }]}>
        <Routes>
          <Route path="/result" element={<Result />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

function unmountResult() {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
}

function recoveryCard(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="recovery-card"]') ?? null;
}

function toggleButton(): HTMLButtonElement | null {
  // 카드 안의 첫 번째 button 이 펼치기 토글 (aria-controls="recovery-details").
  return (
    container?.querySelector<HTMLButtonElement>(
      '[data-testid="recovery-card"] button[aria-controls="recovery-details"]',
    ) ?? null
  );
}

function segmentList(): HTMLElement | null {
  return (
    container?.querySelector<HTMLElement>('[data-testid="recovery-segment-list"]') ?? null
  );
}

function envCheck(): HTMLElement | null {
  return (
    container?.querySelector<HTMLElement>('[data-testid="recovery-env-check"]') ?? null
  );
}

function clickToggle() {
  const btn = toggleButton();
  if (!btn) throw new Error('회복 카드 토글 버튼을 찾지 못했습니다');
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

// ───────────────────────────────────────────────────────────
// 테스트
// ───────────────────────────────────────────────────────────

describe('Result — BLE 회복 안내 카드 (Task #36 / Task #60)', () => {
  afterEach(() => {
    unmountResult();
    vi.clearAllMocks();
  });

  it('recoverySegments 가 비어 있으면 요약만 노출되고 펼치기 토글은 비활성이다', () => {
    // 회복은 발생했지만(누적 2초·1회) 타임라인 segments 는 누락된 과거 페이로드.
    renderResult({
      recoveryExcludedMs: 2_000,
      recoveryWindows: 1,
      recoverySegments: [],
    });

    // 카드 자체는 보여야 한다 (excludedMs ≥ 1000ms 이므로).
    const card = recoveryCard();
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain('기기 연결 회복 구간');
    expect(card?.textContent).toContain('2초');

    // 토글 버튼은 존재하되 disabled 상태여야 한다.
    const btn = toggleButton();
    expect(btn).toBeTruthy();
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute('aria-expanded')).toBe('false');

    // 펼침 영역(목록) 과 환경 점검 안내는 둘 다 DOM 에 없어야 한다.
    expect(segmentList()).toBeNull();
    expect(envCheck()).toBeNull();
  });

  it('recoverySegments 가 2건이면 펼쳤을 때만 평균/최장/횟수·segment 목록이 보이고, 환경 점검 안내는 숨겨진다', () => {
    renderResult({
      recoveryExcludedMs: 4_000,
      recoveryWindows: 2,
      recoverySegments: [
        { startedAt: 5_000, durationMs: 1_500 },
        { startedAt: 22_000, durationMs: 2_500 },
      ],
    });

    // 토글은 활성, 초기 상태는 접힘.
    const btn = toggleButton();
    expect(btn).toBeTruthy();
    expect(btn?.disabled).toBe(false);
    expect(btn?.getAttribute('aria-expanded')).toBe('false');

    // 접힌 상태에서는 segment 목록이 DOM 에 없다.
    expect(segmentList()).toBeNull();

    // windows 가 임계 미만(< 3)이므로 환경 점검 안내는 펼침 여부와 무관하게 노출되지 않는다.
    expect(envCheck()).toBeNull();

    // 펼치기.
    clickToggle();
    expect(toggleButton()?.getAttribute('aria-expanded')).toBe('true');

    // 펼친 뒤에는 segment 목록이 보이고, 항목 수가 입력과 일치해야 한다.
    const list = segmentList();
    expect(list).toBeTruthy();
    expect(list?.querySelectorAll('li').length).toBe(2);

    // 평균/최장/횟수 라벨과 값(평균 2초·최장 3초·2회) 이 함께 노출돼야 한다.
    // - 평균 = round((1500+2500)/2) = 2000ms → "2초"
    // - 최장 = max(1500, 2500) = 2500ms → round(2500/1000)="3초"
    // - 횟수 = recoveryWindows(2) → "2회"
    const cardText = recoveryCard()?.textContent ?? '';
    expect(cardText).toContain('평균');
    expect(cardText).toContain('최장');
    expect(cardText).toContain('횟수');
    expect(cardText).toContain('2초');
    expect(cardText).toContain('3초');
    expect(cardText).toContain('2회');

    // 펼친 뒤에도 환경 점검 안내는 여전히 보이지 않아야 한다.
    expect(envCheck()).toBeNull();
  });

  it('recoverySegments 가 3건이면 환경 점검 안내가 (펼침 여부와 무관하게) 노출된다', () => {
    renderResult({
      recoveryExcludedMs: 6_000,
      recoveryWindows: 3,
      recoverySegments: [
        { startedAt: 5_000, durationMs: 1_500 },
        { startedAt: 22_000, durationMs: 2_500 },
        { startedAt: 40_000, durationMs: 2_000 },
      ],
    });

    // 접힌 초기 상태에서도 환경 점검 안내는 보여야 한다 (Task #36 정책).
    expect(toggleButton()?.getAttribute('aria-expanded')).toBe('false');
    const env = envCheck();
    expect(env).toBeTruthy();
    expect(env?.textContent).toContain('환경을 점검해 보세요');

    // 펼치고 나서도 환경 점검 안내는 그대로 유지된다.
    clickToggle();
    expect(envCheck()).toBeTruthy();
    expect(segmentList()?.querySelectorAll('li').length).toBe(3);
  });
});

