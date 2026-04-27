/**
 * 트레이닝 엔진의 일시정지(pause)/재개(resume) 회귀 테스트
 *
 * 보호 대상:
 * - pause(): 켜져 있던 LED OFF 프레임 + CONTROL_STOP 송신, 모든 timer/RAF 정지.
 * - resume(): CONTROL_START 재송신, RAF/tick 루프 재개, elapsed 진행률이 일시정지
 *   시간만큼 뒤로 미뤄짐 (마치 그 시간이 흐르지 않은 것처럼).
 * - 멱등: 같은 pause/resume 호출이 중복돼도 한 번만 작용.
 *
 * 정책 정본:
 *  - 점등-전용 트레이닝 화면(TrainingBlinkPlay)이 사용자의 일시정지를 처리한다.
 *  - phase clock 자체가 멈추므로 재개 시 같은 지점에서 이어진다(회복 구간과 다름).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLOR_CODE, CTRL_START, CTRL_STOP, isLedOffPayload } from '@noilink/shared';

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

interface Bag {
  podStates: PodState[][];
  elapsedMs: number[];
  phaseChanges: unknown[];
  completed: unknown[];
}

function makeCfg(overrides: Partial<EngineConfig> = {}): { cfg: EngineConfig; bag: Bag } {
  const bag: Bag = { podStates: [], elapsedMs: [], phaseChanges: [], completed: [] };
  const cfg: EngineConfig = {
    mode: 'FOCUS',
    bpm: 60,
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

function offCalls(): Array<{ pod: number; colorCode: number; onMs: number }> {
  return mockedWriteLed.mock.calls
    .map((c) => c[0] as { pod: number; colorCode: number; onMs: number })
    .filter((p) => isLedOffPayload({ colorCode: p.colorCode, onMs: p.onMs }));
}

function controlCalls(): number[] {
  return mockedWriteControl.mock.calls.map((c) => c[0] as number);
}

beforeEach(() => {
  vi.useFakeTimers();
  mockedWriteLed.mockClear();
  mockedWriteControl.mockClear();
  mockedWriteSession.mockClear();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('TrainingEngine pause/resume', () => {
  it('pause() 는 켜져 있던 LED OFF 프레임 + CONTROL_STOP 을 송신한다', () => {
    const { cfg } = makeCfg();
    const engine = new TrainingEngine(cfg);
    engine.start();
    // FOCUS 모드는 첫 fireTick(350ms)에서 lightSinglePod 또는 lightTwoPods 로 점등.
    vi.advanceTimersByTime(400);

    // 점등이 일어났는지 확인 — 색이 들어간 LED 프레임이 최소 하나는 있어야 함.
    const colorWrites = mockedWriteLed.mock.calls
      .map((c) => c[0] as { colorCode: number })
      .filter((p) => p.colorCode !== COLOR_CODE.OFF);
    expect(colorWrites.length).toBeGreaterThan(0);

    const offBefore = offCalls().length;
    const controlsBefore = controlCalls().slice();

    engine.pause();

    // 켜져 있던 Pod 에 대한 OFF 프레임이 추가로 송신됐어야 함.
    expect(offCalls().length).toBeGreaterThan(offBefore);
    // 마지막 control 호출이 STOP 이어야 함.
    const controlsAfter = controlCalls();
    expect(controlsAfter.length).toBeGreaterThan(controlsBefore.length);
    expect(controlsAfter[controlsAfter.length - 1]).toBe(CTRL_STOP);
    expect(engine.getIsPaused()).toBe(true);

    engine.destroy();
  });

  it('pause() 후에는 elapsed RAF/tick 이 더 이상 진행되지 않는다', () => {
    const { cfg, bag } = makeCfg();
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(2_000);
    const elapsedAtPause = bag.elapsedMs[bag.elapsedMs.length - 1] ?? 0;

    engine.pause();
    const callsAtPause = bag.elapsedMs.length;

    // 일시정지 후 시간이 흘러도 onElapsedMs 가 추가 호출되지 않아야 한다.
    vi.advanceTimersByTime(5_000);
    expect(bag.elapsedMs.length).toBe(callsAtPause);
    expect(bag.elapsedMs[bag.elapsedMs.length - 1] ?? 0).toBe(elapsedAtPause);

    engine.destroy();
  });

  it('resume() 는 CONTROL_START 를 재송신하고 elapsed 가 일시정지 시간만큼 뒤로 미뤄진다', () => {
    const { cfg, bag } = makeCfg();
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(2_000);
    const elapsedAtPause = bag.elapsedMs[bag.elapsedMs.length - 1] ?? 0;
    expect(elapsedAtPause).toBeGreaterThan(1_500);
    expect(elapsedAtPause).toBeLessThan(2_500);

    engine.pause();
    const controlsBefore = controlCalls().length;
    // 일시정지 동안 5초 흐름.
    vi.advanceTimersByTime(5_000);

    engine.resume();
    // resume 직후 CONTROL_START 가 추가 송신.
    const controlsAfter = controlCalls();
    expect(controlsAfter.length).toBeGreaterThan(controlsBefore);
    expect(controlsAfter[controlsAfter.length - 1]).toBe(CTRL_START);
    expect(engine.getIsPaused()).toBe(false);

    // resume 후 1초 더 흐른 elapsed 는 (일시정지 직전 + 1s) 가 되어야 한다.
    // (= 2s + 1s = 3s, ±100ms 허용)
    vi.advanceTimersByTime(1_000);
    const elapsedAfterResume = bag.elapsedMs[bag.elapsedMs.length - 1] ?? 0;
    expect(elapsedAfterResume).toBeGreaterThan(elapsedAtPause + 800);
    expect(elapsedAfterResume).toBeLessThan(elapsedAtPause + 1_200);

    engine.destroy();
  });

  it('pause/resume 는 멱등 — 중복 호출은 추가 부수효과가 없다', () => {
    const { cfg } = makeCfg();
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(400);

    engine.pause();
    const ledAfterFirstPause = mockedWriteLed.mock.calls.length;
    const ctrlAfterFirstPause = controlCalls().length;

    engine.pause();
    expect(mockedWriteLed.mock.calls.length).toBe(ledAfterFirstPause);
    expect(controlCalls().length).toBe(ctrlAfterFirstPause);

    engine.resume();
    const ctrlAfterFirstResume = controlCalls().length;
    engine.resume();
    expect(controlCalls().length).toBe(ctrlAfterFirstResume);

    engine.destroy();
  });

  it('destroyed 엔진에 대한 pause/resume 은 no-op', () => {
    const { cfg } = makeCfg();
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(400);
    engine.destroy();

    const ledBefore = mockedWriteLed.mock.calls.length;
    const ctrlBefore = controlCalls().length;
    engine.pause();
    engine.resume();
    expect(mockedWriteLed.mock.calls.length).toBe(ledBefore);
    expect(controlCalls().length).toBe(ctrlBefore);
  });

  it('resume 후 자극 fireTick 이 재개되어 추가 점등 LED 프레임이 송신된다', () => {
    const { cfg } = makeCfg({ bpm: 120 }); // beat = 500ms
    const engine = new TrainingEngine(cfg);
    engine.start();
    vi.advanceTimersByTime(400);

    engine.pause();
    vi.advanceTimersByTime(2_000);

    const colorWritesBefore = mockedWriteLed.mock.calls
      .map((c) => c[0] as { colorCode: number })
      .filter((p) => p.colorCode !== COLOR_CODE.OFF).length;

    engine.resume();
    // resume 직후 fireTick 이 ~350ms 내로 다시 발사 → 새 색 점등 LED 프레임이 추가.
    vi.advanceTimersByTime(800);

    const colorWritesAfter = mockedWriteLed.mock.calls
      .map((c) => c[0] as { colorCode: number })
      .filter((p) => p.colorCode !== COLOR_CODE.OFF).length;
    expect(colorWritesAfter).toBeGreaterThan(colorWritesBefore);

    engine.destroy();
  });

  it('MEMORY phase 의 pause/resume 후에도 phase 종료 시각이 dt 만큼 정확히 뒤로 미뤄진다', () => {
    // schedule 기반 phase(MEMORY) 는 resume 시 phase 자체를 잔여시간으로 재시작한다.
    // remaining 계산이 정확해야 onComplete 시각이 (원 totalDurationMs + 일시정지 dt)
    // 직후에 호출된다 — 그 전에 호출되면 종료 시각이 당겨졌다는 회귀 신호.
    const { cfg, bag } = makeCfg({ mode: 'MEMORY', level: 1, totalDurationMs: 10_000 });
    const engine = new TrainingEngine(cfg);
    engine.start();

    // wallclock 2s — phase 진행 2s.
    vi.advanceTimersByTime(2_000);
    engine.pause();
    // 2s 일시정지 (이 시간만큼 wallclock 종료 시각이 미뤄져야 한다).
    vi.advanceTimersByTime(2_000);
    engine.resume();

    // 잔여 phase 시간 = 8s. 7.5s 만큼만 흘러간 시점에서는 아직 종료 안 됨.
    vi.advanceTimersByTime(7_500);
    expect(bag.completed.length).toBe(0);

    // 추가로 1s 더 흘리면 잔여시간을 모두 소진해 onComplete 가 호출된다.
    vi.advanceTimersByTime(1_000);
    expect(bag.completed.length).toBe(1);

    engine.destroy();
  });

  it('MEMORY phase 에서 pause/resume 시 SHOW 시퀀스 자극이 끊기지 않고 다시 흐른다', () => {
    // MEMORY phase 의 SHOW/RECALL 점등 콜백은 모두 schedule()→pendingTimers 에
    // 등록된다. pause 가 그것들을 일괄 cancel 하면 단순 fireTick 재예약만으로는
    // 자극이 복구되지 않는다 — currentPhaseScheduleBased 분기로 phase 자체를
    // 잔여시간만큼 재시작해 SHOW 자극이 다시 흐르는지 잠근다.
    const { cfg } = makeCfg({ mode: 'MEMORY', level: 1, totalDurationMs: 30_000 });
    const engine = new TrainingEngine(cfg);
    engine.start();

    // 첫 SHOW 시퀀스의 첫 자극이 한 박자(beat) 내에 송신된다 (BPM 60 → beatMs 1000ms).
    vi.advanceTimersByTime(1_200);
    const colorBeforePause = mockedWriteLed.mock.calls
      .map((c) => c[0] as { colorCode: number })
      .filter((p) => p.colorCode !== COLOR_CODE.OFF).length;
    expect(colorBeforePause).toBeGreaterThan(0);

    engine.pause();
    vi.advanceTimersByTime(2_000);

    const colorAfterPause = mockedWriteLed.mock.calls
      .map((c) => c[0] as { colorCode: number })
      .filter((p) => p.colorCode !== COLOR_CODE.OFF).length;

    engine.resume();
    // resume 후 phase 가 재시작되어 SHOW 자극이 다시 흐른다 (한 박자 + 여유).
    vi.advanceTimersByTime(2_500);

    const colorAfterResume = mockedWriteLed.mock.calls
      .map((c) => c[0] as { colorCode: number })
      .filter((p) => p.colorCode !== COLOR_CODE.OFF).length;
    expect(colorAfterResume).toBeGreaterThan(colorAfterPause);

    engine.destroy();
  });
});
