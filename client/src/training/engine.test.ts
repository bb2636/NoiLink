/**
 * 트레이닝 엔진의 BLE 소등 흐름 회귀 테스트
 *
 * 보호 대상:
 * - 사용자가 onMs 안에 탭하면 LED OFF 프레임(`encodeLedOffFrame`/`isLedOffPayload`
 *   컨벤션)이 BLE write 경로로 송신된다.
 * - allOff()는 켜져 있던 모든 Pod에 OFF 프레임을 보내고, 다시 호출하면 추가 OFF
 *   를 보내지 않는다(멱등).
 *
 * 정본: docs/firmware/led-off-convention.md §4 (UI ↔ LED 소등 시점 ±20ms 일치)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLOR_CODE,
  CTRL_STOP,
  isLedOffPayload,
} from '@noilink/shared';

// ───────────────────────────────────────────────────────────
// BLE bridge 모킹 — 엔진이 실제 네이티브 셸 없이도 검증 가능하도록
// 모듈 평가 전에 mock 등록.
// ───────────────────────────────────────────────────────────
vi.mock('../native/bleBridge', () => ({
  bleWriteLed: vi.fn(),
  bleWriteSession: vi.fn(),
  bleWriteControl: vi.fn(),
}));

import { bleWriteControl, bleWriteLed, bleWriteSession } from '../native/bleBridge';
import { TrainingEngine, type EngineConfig, type PodState } from './engine';

const mockedWriteLed = bleWriteLed as unknown as ReturnType<typeof vi.fn>;
const mockedWriteControl = bleWriteControl as unknown as ReturnType<typeof vi.fn>;
const mockedWriteSession = bleWriteSession as unknown as ReturnType<typeof vi.fn>;

// ───────────────────────────────────────────────────────────
// 테스트 헬퍼
// ───────────────────────────────────────────────────────────

interface CallbackBag {
  podStates: PodState[][];
  elapsedMs: number[];
  phaseChanges: unknown[];
  completed: unknown[];
}

function makeConfig(overrides: Partial<EngineConfig> = {}): {
  cfg: EngineConfig;
  bag: CallbackBag;
} {
  const bag: CallbackBag = {
    podStates: [],
    elapsedMs: [],
    phaseChanges: [],
    completed: [],
  };
  const cfg: EngineConfig = {
    mode: 'FOCUS',
    bpm: 60, // beat = 1000ms → 1 tick per second
    level: 1,
    totalDurationMs: 60_000,
    podCount: 4,
    isComposite: false,
    onPodStates: (s) => bag.podStates.push(s),
    onElapsedMs: (ms) => bag.elapsedMs.push(ms),
    onPhaseChange: (info) => bag.phaseChanges.push(info),
    onComplete: (m) => bag.completed.push(m),
    ...overrides,
  };
  return { cfg, bag };
}

/** OFF 프레임 송신 호출들만 추출 (isLedOffPayload 컨벤션 일치) */
function offCalls(): Array<{ tickId: number; pod: number; colorCode: number; onMs: number; mode?: string }> {
  return mockedWriteLed.mock.calls
    .map((c) => c[0] as { tickId: number; pod: number; colorCode: number; onMs: number; mode?: string })
    .filter((p) => isLedOffPayload({ colorCode: p.colorCode, onMs: p.onMs }));
}

/** 일반 점등(비-OFF) 호출 */
function litCalls(): Array<{ tickId: number; pod: number; colorCode: number; onMs: number }> {
  return mockedWriteLed.mock.calls
    .map((c) => c[0] as { tickId: number; pod: number; colorCode: number; onMs: number })
    .filter((p) => !isLedOffPayload({ colorCode: p.colorCode, onMs: p.onMs }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Date.now / setTimeout / requestAnimationFrame 제어용
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────
// (1) 점등 → 탭 시 즉시 LED OFF 프레임 송신
// ───────────────────────────────────────────────────────────

describe('TrainingEngine: 사용자가 onMs 안에 탭하면 OFF 프레임이 송신된다', () => {
  it('FOCUS 모드 — 타겟 점등 후 탭 → encodeLedOffFrame 컨벤션의 페이로드가 송신된다', () => {
    // 첫 fireFocusTick에서 Math.random이 첫 호출 < 0.6 → 타겟(BLUE), 두 번째 호출
    // (podId 결정)도 결정적으로 만든다.
    const seq = [0.1, 0.0, 0.5, 0.0, 0.5, 0.0]; // (target?, distractor color, podId floor) ...
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);

    const { cfg, bag } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();

    // 첫 tick은 350ms 후 발생 → 점등 발생까지 진행
    vi.advanceTimersByTime(360);

    expect(litCalls().length).toBeGreaterThanOrEqual(1);
    const lit = litCalls()[0];
    expect(lit.colorCode).toBe(COLOR_CODE.BLUE); // 타겟색
    expect(lit.onMs).toBeGreaterThan(0);
    expect(lit.tickId).toBeGreaterThan(0);

    // 점등된 Pod 식별 (마지막 onPodStates 스냅샷)
    const lastSnap = bag.podStates[bag.podStates.length - 1];
    const litPod = lastSnap.find((p) => p.fill !== 'OFF');
    expect(litPod, '점등된 Pod이 한 개 있어야 한다').toBeDefined();

    // 사용자 탭 (onMs=900ms 안)
    vi.advanceTimersByTime(50);
    const handled = engine.handleTap(litPod!.id);
    expect(handled).toBe(true);

    // OFF 프레임이 동일 pod / tickId / OFF 컨벤션으로 송신되었는지 검증
    const offs = offCalls();
    expect(offs.length).toBe(1);
    expect(offs[0].pod).toBe(litPod!.id);
    expect(offs[0].tickId).toBe(lit.tickId);
    expect(offs[0].colorCode).toBe(COLOR_CODE.OFF);
    expect(offs[0].onMs).toBe(0);
    // OFF 프레임은 ack 보장(withResponse) 모드여야 한다 (잔상 방지 정책)
    expect(offs[0].mode).toBe('withResponse');

    engine.destroy();
  });

  it('탭 응답이 점등 onMs 윈도우 내에 OFF 송신을 트리거한다 (UI ↔ LED 동기 정책)', () => {
    const seq = [0.1, 0.0, 0.5, 0.0];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);

    const { cfg, bag } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(360);

    const litPod = bag.podStates[bag.podStates.length - 1].find((p) => p.fill !== 'OFF');
    expect(litPod).toBeDefined();
    const litAt = litPod!.litAt!;
    const expiresAt = litPod!.expiresAt!;

    // onMs(=900ms)의 절반 시점에 탭
    vi.advanceTimersByTime(Math.floor((expiresAt - litAt) / 2));
    const tapAt = Date.now();

    expect(tapAt).toBeLessThan(expiresAt); // onMs 안에 탭

    engine.handleTap(litPod!.id);

    // OFF 프레임 송신 확인
    expect(offCalls().length).toBe(1);

    engine.destroy();
  });
});

// ───────────────────────────────────────────────────────────
// (2) allOff: 모든 점등 Pod에 OFF + 멱등성
// ───────────────────────────────────────────────────────────

describe('TrainingEngine: allOff 경로(destroy)가 모든 점등 Pod에 OFF 프레임을 보내고 멱등하다', () => {
  it('점등된 Pod이 있을 때 destroy() → 모든 점등 Pod에 OFF + CTRL_STOP, 두 번째 destroy() 는 no-op', () => {
    const seq = [0.1, 0.0, 0.5, 0.0, 0.5, 0.0];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);

    const { cfg, bag } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(360);

    const litPod = bag.podStates[bag.podStates.length - 1].find((p) => p.fill !== 'OFF');
    expect(litPod).toBeDefined();

    // destroy → 점등된 Pod에 OFF 프레임 + CTRL_STOP 송신
    engine.destroy();

    const offs = offCalls();
    expect(offs.length).toBe(1);
    expect(offs[0].pod).toBe(litPod!.id);
    expect(offs[0].colorCode).toBe(COLOR_CODE.OFF);
    expect(offs[0].onMs).toBe(0);

    expect(mockedWriteControl).toHaveBeenCalledWith(CTRL_STOP);
    const stopCallsAfterFirst = mockedWriteControl.mock.calls.filter((c) => c[0] === CTRL_STOP).length;
    expect(stopCallsAfterFirst).toBe(1);

    // 멱등: 두 번째 destroy 호출은 추가 OFF / STOP 을 보내지 않는다
    const totalOffBefore = offCalls().length;
    engine.destroy();
    expect(offCalls().length).toBe(totalOffBefore);
    expect(mockedWriteControl.mock.calls.filter((c) => c[0] === CTRL_STOP).length).toBe(1);
  });

  it('점등 Pod이 없을 때 destroy() → OFF 프레임은 0건, CTRL_STOP만 송신', () => {
    const { cfg } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();
    // 첫 tick(350ms) 전에 destroy → 어떤 Pod도 점등되지 않은 상태
    engine.destroy();

    expect(offCalls().length).toBe(0);
    expect(mockedWriteControl).toHaveBeenCalledWith(CTRL_STOP);
  });

  it('AGILITY Lv4 동시 점등 → 탭 처리 후 두 Pod 모두 OFF 프레임이 송신된다', () => {
    // fireAgilityTick: allowSimul && r < 0.25 분기 (BLUE+GREEN 두 Pod 점등)
    const seq = [0.1]; // 첫 random < 0.25 → 동시 점등 분기
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);

    const { cfg, bag } = makeConfig({ mode: 'AGILITY', bpm: 60, level: 4 });
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(360);

    const snap = bag.podStates[bag.podStates.length - 1];
    const litPods = snap.filter((p) => p.fill !== 'OFF');
    expect(litPods.length).toBe(2);

    // 한쪽 Pod 탭 → handleTap 후 allOff() 가 두 Pod 모두 OFF 송신
    engine.handleTap(litPods[0].id);

    const offs = offCalls();
    // 두 점등 Pod 모두에 대해 OFF 프레임 송신
    const offPods = new Set(offs.map((o) => o.pod));
    expect(offPods.has(litPods[0].id)).toBe(true);
    expect(offPods.has(litPods[1].id)).toBe(true);
    // 모두 OFF 컨벤션
    for (const o of offs) {
      expect(o.colorCode).toBe(COLOR_CODE.OFF);
      expect(o.onMs).toBe(0);
    }

    engine.destroy();
  });
});

// ───────────────────────────────────────────────────────────
// (3) RHYTHM 탭 — handleRhythmTap 의 즉시 소등 경로
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// (4) BLE 단절 회복 구간 정책 (Task #27)
//   - beginRecoveryWindow → 새 자극이 점등되지 않고 분모/누락이 잡히지 않는다
//   - endRecoveryWindow → 곧장 다음 박부터 정상 점등 재개
//   - 회복 누적 시간이 buildMetrics().recovery 에 노출된다 (excludedMs/windows)
//
// 기획 의도: 짧은 BLE 단절 동안 도달하지 않은 입력을 '미반응'으로 채점하면
// 사용자가 부당하게 손해를 보므로, 회복 구간을 채점에서 통째로 제외한다.
// 이 정책이 조용히 깨지면 사용자에게 "갑자기 점수가 추락"하는 형태로만 드러나
// 진단이 어렵기 때문에 본 회귀 테스트로 잠근다.
// ───────────────────────────────────────────────────────────

describe('TrainingEngine: BLE 단절 회복 구간은 채점에서 제외된다 (Task #27)', () => {
  it('회복 중 fireFocusTick 호출이 분모/LED 송신을 일으키지 않는다', () => {
    // 결정론적 점등 — 첫 random < 0.6 → 타겟(BLUE)
    const seq = [0.1, 0.0, 0.1, 0.0, 0.1, 0.0];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);

    const { cfg, bag } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();

    // 첫 tick(350ms 후)에서 정상 점등이 발생
    vi.advanceTimersByTime(360);
    const litBefore = litCalls().length;
    expect(litBefore).toBeGreaterThanOrEqual(1);

    // 회복 구간 진입 — 켜져 있던 Pod가 OFF 처리되고 이후 tick은 점등을 건너뛴다
    engine.beginRecoveryWindow();
    const lastSnap = bag.podStates[bag.podStates.length - 1];
    expect(lastSnap.every((p) => p.fill === 'OFF')).toBe(true);

    const litAtEntry = litCalls().length;
    // 한 박(=1000ms) 이상 진행해도 새 점등이 없어야 한다
    vi.advanceTimersByTime(1500);
    expect(litCalls().length).toBe(litAtEntry);

    // 회복 종료 → 다음 tick부터 다시 점등 가능
    engine.endRecoveryWindow();
    vi.advanceTimersByTime(1100);
    expect(litCalls().length).toBeGreaterThan(litAtEntry);

    engine.destroy();
  });

  it('회복 구간 누적 시간이 buildMetrics().recovery 로 노출되고 windows 가 1 증가', () => {
    const { cfg } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(360);

    engine.beginRecoveryWindow();
    vi.advanceTimersByTime(2500); // 2.5초 회복 후 종료
    engine.endRecoveryWindow();

    // private buildMetrics 직접 호출 — 입력→출력 검증에 한정
    const metrics = (engine as unknown as { buildMetrics: () => Record<string, unknown> })
      .buildMetrics() as { recovery: { excludedMs: number; windows: number } };
    expect(metrics.recovery.windows).toBe(1);
    // 타이머 정밀도 마진 — 2500ms 부근(2400~2600)
    expect(metrics.recovery.excludedMs).toBeGreaterThanOrEqual(2400);
    expect(metrics.recovery.excludedMs).toBeLessThanOrEqual(2600);

    engine.destroy();
  });

  it('beginRecoveryWindow 는 멱등 — 같은 구간에 여러 번 호출해도 windows 1, 시작 시각은 첫 호출 기준', () => {
    const { cfg } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(360);

    engine.beginRecoveryWindow();
    vi.advanceTimersByTime(500);
    // 두 번째 신호 — 무시되어야 한다 (시작 시각 갱신 X, windows 증분 X)
    engine.beginRecoveryWindow();
    vi.advanceTimersByTime(1000);
    engine.endRecoveryWindow();

    const metrics = (engine as unknown as { buildMetrics: () => Record<string, unknown> })
      .buildMetrics() as { recovery: { excludedMs: number; windows: number } };
    expect(metrics.recovery.windows).toBe(1);
    // 누적 회복 시간은 ~1500ms (첫 호출 시점부터 endRecoveryWindow까지)
    expect(metrics.recovery.excludedMs).toBeGreaterThanOrEqual(1400);
    expect(metrics.recovery.excludedMs).toBeLessThanOrEqual(1600);

    engine.destroy();
  });

  it('endRecoveryWindow 는 멱등 — 회복 중이 아닐 때 호출해도 누적/windows에 영향 없음', () => {
    const { cfg } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(360);

    // 회복 시작 전에 종료 호출 — no-op
    engine.endRecoveryWindow();

    engine.beginRecoveryWindow();
    vi.advanceTimersByTime(800);
    engine.endRecoveryWindow();
    // 종료 후 다시 종료 호출 — no-op (누적 시간이 두 배가 되지 않아야 한다)
    vi.advanceTimersByTime(500);
    engine.endRecoveryWindow();

    const metrics = (engine as unknown as { buildMetrics: () => Record<string, unknown> })
      .buildMetrics() as { recovery: { excludedMs: number; windows: number } };
    expect(metrics.recovery.windows).toBe(1);
    expect(metrics.recovery.excludedMs).toBeGreaterThanOrEqual(700);
    expect(metrics.recovery.excludedMs).toBeLessThanOrEqual(900);

    engine.destroy();
  });

  it('getRecoveryStats — windows 와 누적 시간(현재 진행 중 구간 포함) 을 정확히 노출 (Task #38)', () => {
    const { cfg } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(360);

    // 초기 상태
    expect(engine.getRecoveryStats()).toEqual({ windows: 0, totalMs: 0 });

    // 첫 회복 구간: 2초
    engine.beginRecoveryWindow();
    vi.advanceTimersByTime(2000);
    let s = engine.getRecoveryStats();
    expect(s.windows).toBe(1);
    expect(s.totalMs).toBeGreaterThanOrEqual(1900);
    expect(s.totalMs).toBeLessThanOrEqual(2100);
    engine.endRecoveryWindow();

    // 두 번째 회복 구간: 3초 진행 중
    vi.advanceTimersByTime(500);
    engine.beginRecoveryWindow();
    vi.advanceTimersByTime(3000);
    s = engine.getRecoveryStats();
    expect(s.windows).toBe(2);
    // 종료된 구간 2초 + 진행 중 구간 3초 ≈ 5초
    expect(s.totalMs).toBeGreaterThanOrEqual(4900);
    expect(s.totalMs).toBeLessThanOrEqual(5100);

    engine.endRecoveryWindow();
    engine.destroy();
  });

  it('회복 중 종료(complete/destroy)되면 누적 시간이 자동 마감된다', () => {
    const { cfg } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(360);

    engine.beginRecoveryWindow();
    vi.advanceTimersByTime(1200);
    // 명시적 endRecoveryWindow 없이 종료
    engine.endNow();

    const metrics = (engine as unknown as { buildMetrics: () => Record<string, unknown> })
      .buildMetrics() as { recovery: { excludedMs: number; windows: number } };
    expect(metrics.recovery.windows).toBe(1);
    expect(metrics.recovery.excludedMs).toBeGreaterThanOrEqual(1100);
    expect(metrics.recovery.excludedMs).toBeLessThanOrEqual(1300);
  });

  it('회복 진입 시 켜져 있던 Pod에는 OFF 프레임이 송신된다 (UI/디바이스 동기 정리)', () => {
    const seq = [0.1, 0.0, 0.5, 0.0];
    let i = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);

    const { cfg, bag } = makeConfig({ mode: 'FOCUS', bpm: 60 });
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(360);

    const litPod = bag.podStates[bag.podStates.length - 1].find((p) => p.fill !== 'OFF');
    expect(litPod).toBeDefined();

    const offsBefore = offCalls().length;
    engine.beginRecoveryWindow();
    const offsAfter = offCalls().length;
    // 켜져 있던 Pod 1개에 OFF 프레임이 추가 송신
    expect(offsAfter).toBe(offsBefore + 1);

    engine.destroy();
  });
});

describe('TrainingEngine: COMPOSITE/RHYTHM 탭 → bleOffPod 즉시 송신', () => {
  it('RHYTHM 점등 후 탭 → 동일 tickId/pod의 OFF 프레임이 송신된다', () => {
    // composite 모드 → 첫 세그먼트는 RHYTHM
    const { cfg, bag } = makeConfig({
      mode: 'COMPOSITE',
      bpm: 60,
      level: 1,
      isComposite: true,
      totalDurationMs: 60_000,
    });
    const engine = new TrainingEngine(cfg);
    engine.start();

    // 첫 RHYTHM tick은 startTickLoop(350ms 지연) 후 발생.
    // beat=1000ms · onMs=400ms 이므로 [350~750]ms 구간에 Pod 1개가 점등된다.
    // 점등 윈도우 중간(=400ms 직후)에 측정해 lit 상태를 보장.
    vi.advanceTimersByTime(360);

    const snap = bag.podStates[bag.podStates.length - 1];
    const litPod = snap.find((p) => p.fill !== 'OFF');
    expect(litPod, 'RHYTHM 첫 박에서 Pod 1개가 점등되어야 한다').toBeDefined();

    // 탭 직후 OFF 프레임 송신 (handleRhythmTap → bleOffPod)
    const offsBefore = offCalls().length;
    engine.handleTap(litPod!.id);
    const offsAfter = offCalls();
    expect(offsAfter.length).toBe(offsBefore + 1);
    const lastOff = offsAfter[offsAfter.length - 1];
    expect(lastOff.pod).toBe(litPod!.id);
    expect(lastOff.tickId).toBe(litPod!.tickId);
    expect(lastOff.colorCode).toBe(COLOR_CODE.OFF);
    expect(lastOff.onMs).toBe(0);
    expect(lastOff.mode).toBe('withResponse');

    // 세션 메타도 RHYTHM phase 로 송신되었는지 확인
    expect(mockedWriteSession).toHaveBeenCalled();

    engine.destroy();
  });
});
