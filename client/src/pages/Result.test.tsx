/**
 * 결과 화면(Result.tsx) 회귀 테스트
 *
 * 이 파일은 Result.tsx 의 두 가지 분기 정책을 함께 잠근다:
 *
 * 1) BLE 회복 안내 카드 (Task #36 / Task #60)
 *    - recoverySegments 가 비었을 때:
 *      - 카드(요약 1줄)는 노출되지만 펼치기 토글은 비활성(disabled)이다.
 *      - 펼침 영역(recovery-segment-list) 과 환경 점검 안내(recovery-env-check) 는
 *        모두 DOM 에 없다.
 *    - recoverySegments 가 2건일 때:
 *      - 토글이 활성이고, 클릭하면 평균/최장/횟수와 segment 목록이 보인다.
 *      - 환경 점검 안내(recovery-env-check) 는 노출되지 않는다 (windows < 3).
 *    - recoverySegments 가 3건 이상일 때:
 *      - 환경 점검 안내(recovery-env-check) 가 펼침/접힘 상태와 무관하게 노출된다.
 *
 * 2) 부분 결과 배지 (Task #23 / Task #63)
 *    - `location.state.isPartial === true` + `partialProgressPct` 가 함께 전달되면
 *      "부분 결과 · X% 진행" 배지가 점수 원 위쪽에 노출된다.
 *    - 배지의 X% 값은 navigate state 의 `partialProgressPct` 와 일치해야 한다.
 *    - 정상 완료 (`isPartial !== true`) 에서는 배지가 절대로 보이지 않는다
 *      (디자인 변경으로 항상 노출되거나 사라지는 회귀를 막는다).
 *
 * 카피·임계값(예: RECOVERY_ENV_CHECK_THRESHOLD = 3) 변경이 조용히 깨지지 않도록
 * 직접 렌더링 테스트로 잠근다. 엔진 단의 `recovery.segments` 회귀 와
 * `submitTrainingRun` 의 메타 동봉 로직은 각각 별도 단위 테스트가 보호한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// React 18 의 act() 가 jsdom 환경에서 정상 동작하도록 플래그를 켠다.
// (vitest jsdom 기본 환경은 IS_REACT_ACT_ENVIRONMENT 가 꺼져 있어 경고가 발생한다.)
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// ───────────────────────────────────────────────────────────
// 의존성 모킹 — 회복 카드/부분 배지 분기 외 부수효과 제거
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

// 결과 화면 재진입 시 서버에서 raw.recovery 를 받아오는 호출(Task #75) 을
// 가로채기 위해 api 모듈을 모킹한다. 각 테스트에서 mockResolvedValue 로 응답을 지정.
vi.mock('../utils/api', () => ({
  __esModule: true,
  default: { get: vi.fn() },
  api: { get: vi.fn() },
}));

import api from '../utils/api';
import Result, { type TrainingResultState } from './Result';

const mockApiGet = api.get as ReturnType<typeof vi.fn>;

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
  beforeEach(() => {
    // 기본값: 서버 호출이 일어나도 빈 응답을 반환해 기존 테스트 동작에 영향이 없게 한다.
    mockApiGet.mockResolvedValue({ success: true, data: { raw: null, score: null } });
  });

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

describe('Result — 부분 결과 배지 (Task #23 / Task #63)', () => {
  afterEach(() => {
    unmountResult();
    vi.clearAllMocks();
  });

  it('isPartial=true + partialProgressPct=65 면 "부분 결과 · 65% 진행" 배지가 보인다', () => {
    renderResult({
      isPartial: true,
      partialProgressPct: 65,
    });

    const text = container?.textContent ?? '';
    expect(text).toContain('부분 결과 · 65% 진행');

    // 접근성 라벨도 함께 노출되어야 스크린 리더 사용자도 맥락을 인지한다.
    const badge = container?.querySelector(
      '[aria-label="부분 결과 65 퍼센트 진행"]',
    );
    expect(badge).toBeTruthy();
  });

  it('isPartial=false 일 때는 부분 결과 배지가 노출되지 않는다 (정상 완료 회귀 보호)', () => {
    renderResult({
      isPartial: false,
      // partialProgressPct 가 함께 와도 isPartial 가 false 면 배지는 숨겨진다.
      partialProgressPct: 80,
    });

    const text = container?.textContent ?? '';
    expect(text).not.toContain('부분 결과');
    expect(text).not.toContain('% 진행');
  });

  it('isPartial=true 라도 partialProgressPct 가 없으면 배지를 숨긴다 (불완전 페이로드 안전망)', () => {
    renderResult({
      isPartial: true,
      // partialProgressPct 미지정 — 잘못된 값으로 "부분 결과 · undefined% 진행" 같은
      // 깨진 표기가 노출되어선 안 된다.
    });

    const text = container?.textContent ?? '';
    expect(text).not.toContain('부분 결과');
  });

  it('partialProgressPct 가 100 초과/음수여도 0~100 범위로 보정된 값이 노출된다', () => {
    renderResult({
      isPartial: true,
      partialProgressPct: 150,
    });

    const text = container?.textContent ?? '';
    expect(text).toContain('부분 결과 · 100% 진행');
  });
});

// ───────────────────────────────────────────────────────────
// Task #75 — 결과 화면 재진입 시 서버에서 끊김 타임라인 다시 불러오기
// ───────────────────────────────────────────────────────────
//
// 정책 요약:
//   1. navigate state 가 sessionId 만 들고 있으면(=재진입) 서버에서 raw.recovery
//      를 받아와 회복 카드를 동일하게 그린다.
//   2. 응답에 recovery 가 없으면(과거 세션) 카드를 띄우지 않고 자연스럽게 폴백한다.
//   3. navigate state 에 이미 recoverySegments 가 들어 있으면(=정상 완료 흐름)
//      서버 호출을 하지 않는다 — 추가 네트워크 비용을 만들지 않기 위함.

describe('Result — 결과 재진입 시 서버에서 회복 타임라인 다시 불러오기 (Task #75)', () => {
  beforeEach(() => {
    mockApiGet.mockReset();
  });

  afterEach(() => {
    unmountResult();
    vi.clearAllMocks();
  });

  it('navigate state 가 sessionId 만 있으면 서버 응답의 segments 로 카드를 그린다', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        raw: {
          recovery: {
            excludedMs: 4_000,
            windows: 2,
            segments: [
              { startedAt: 5_000, durationMs: 1_500 },
              { startedAt: 22_000, durationMs: 2_500 },
            ],
          },
        },
        score: null,
      },
    });

    // recoverySegments / recoveryExcludedMs / recoveryWindows 가 전부 누락된 재진입 상태.
    renderResult({
      recoveryExcludedMs: undefined,
      recoveryWindows: undefined,
      recoverySegments: undefined,
    });

    // 마이크로태스크 큐가 흘러 setState 가 반영되도록 act 안에서 await 한다.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 서버 호출이 정확한 엔드포인트로 한 번 일어났어야 한다.
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    expect(mockApiGet).toHaveBeenCalledWith('/metrics/session/sess-test');

    // 서버 응답 기반으로 카드와 요약이 렌더된다.
    const card = recoveryCard();
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain('기기 연결 회복 구간');
    expect(card?.textContent).toContain('4초');

    // 토글이 활성화돼 펼침이 가능해야 한다 (segments 가 있으니까).
    const btn = toggleButton();
    expect(btn?.disabled).toBe(false);
    clickToggle();
    expect(segmentList()?.querySelectorAll('li').length).toBe(2);
  });

  it('서버 응답에 recovery 가 없으면(과거 세션) 카드가 노출되지 않는다', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: { raw: { /* recovery 필드 누락 */ }, score: null },
    });

    renderResult({
      recoveryExcludedMs: undefined,
      recoveryWindows: undefined,
      recoverySegments: undefined,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiGet).toHaveBeenCalledTimes(1);
    // excludedMs 가 0 이므로 카드 자체가 DOM 에 그려지지 않는다.
    expect(recoveryCard()).toBeNull();
  });

  it('navigate state 가 이미 recoverySegments 를 들고 있으면 서버 호출을 하지 않는다', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        raw: {
          recovery: {
            excludedMs: 9_999,
            windows: 9,
            segments: [{ startedAt: 0, durationMs: 9_999 }],
          },
        },
        score: null,
      },
    });

    // 정상 완료 흐름 — 빈 segments 라도 navigate state 가 명시적으로 들고 있으므로
    // 서버 호출은 일어나지 않아야 한다.
    renderResult({
      recoveryExcludedMs: 0,
      recoveryWindows: 0,
      recoverySegments: [],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockApiGet).not.toHaveBeenCalled();
    // 그리고 카드도 (excludedMs=0 이므로) 노출되지 않는다 — 서버 응답에 영향받지 않는다.
    expect(recoveryCard()).toBeNull();
  });
});

