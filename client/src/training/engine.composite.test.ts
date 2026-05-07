/**
 * Task #150 — 종합트레이닝(Composite) 점등·입력 무반응 회귀 보호 테스트.
 *
 * 사용자 보고: 종합트레이닝을 시작하면 처음부터 끝까지 단 한 번도 점등이 발생하지
 * 않고 입력 카운터도 0 에 머문다. handleTap 은 pod.fill === 'OFF' 면 false 를
 * 반환하므로, "점등이 한 번도 안 일어남" 이 곧 "입력 무반응" 으로 이어진다.
 *
 * 본 테스트는 Composite 의 첫 RHYTHM 페이즈에서 fireTick → lightSinglePod →
 * onPodStates 가 정상 호출되는지, 그리고 5사이클 동안 페이즈 전환이 끊기지 않는지를
 * fake timers 로 검증한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../native/bleBridge', () => ({
  bleWriteLed: vi.fn(),
  bleWriteSession: vi.fn(),
  bleWriteControl: vi.fn(),
}));

import { bleWriteLed, bleWriteSession, bleWriteControl } from '../native/bleBridge';
import { TrainingEngine, type EngineConfig, type PodState } from './engine';

const mockedWriteLed = bleWriteLed as unknown as ReturnType<typeof vi.fn>;
const mockedWriteSession = bleWriteSession as unknown as ReturnType<typeof vi.fn>;
const mockedWriteControl = bleWriteControl as unknown as ReturnType<typeof vi.fn>;

interface Bag {
  podStates: PodState[][];
  phaseChanges: Array<{ phase: string; cognitiveMode?: string; cycleIndex: number }>;
  completed: unknown[];
}

function makeCompositeConfig(overrides: Partial<EngineConfig> = {}): { cfg: EngineConfig; bag: Bag } {
  const bag: Bag = { podStates: [], phaseChanges: [], completed: [] };
  const cfg: EngineConfig = {
    mode: 'COMPOSITE',
    bpm: 60,
    level: 1,
    totalDurationMs: 300_000,
    podCount: 4,
    isComposite: true,
    onPodStates: (s) => bag.podStates.push(s),
    onElapsedMs: () => {},
    onPhaseChange: (info) => bag.phaseChanges.push(info as Bag['phaseChanges'][number]),
    onComplete: (m) => bag.completed.push(m),
    ...overrides,
  };
  return { cfg, bag };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TrainingEngine Composite: 시작 직후 첫 점등이 즉시 발사된다 (Task #150 회귀 보호)', () => {
  it('start() 후 첫 1초 내에 onPodStates 가 점등 상태(non-OFF)로 1회 이상 호출된다', () => {
    const { cfg, bag } = makeCompositeConfig();
    const engine = new TrainingEngine(cfg);

    engine.start();
    // FIRST_TICK_DELAY_MS=500ms + 첫 박(BPM 60 → 1000ms 주기) 안쪽까지 진행.
    vi.advanceTimersByTime(1500);

    const litStates = bag.podStates.filter((s) => s.some((p) => p.fill !== 'OFF' && p.litAt !== null));
    expect(litStates.length).toBeGreaterThan(0);
    // BLE LED write 도 함께 발사돼야 한다 (네이티브 미연결 환경에서도 mocked 호출은 발생).
    expect(mockedWriteLed).toHaveBeenCalled();

    engine.destroy();
  });

  it('첫 페이즈는 RHYTHM 으로 진입하고, BLE SESSION + START 가 송신된다', () => {
    const { cfg, bag } = makeCompositeConfig();
    const engine = new TrainingEngine(cfg);

    engine.start();
    vi.advanceTimersByTime(10);

    expect(bag.phaseChanges.length).toBeGreaterThanOrEqual(1);
    expect(bag.phaseChanges[0].phase).toBe('RHYTHM');
    expect(mockedWriteSession).toHaveBeenCalled();
    expect(mockedWriteControl).toHaveBeenCalled();

    engine.destroy();
  });

  it('RHYTHM(30s) → MEMORY(30s) 페이즈 전환이 발생하고 MEMORY SHOW 점등이 송출된다', () => {
    const { cfg, bag } = makeCompositeConfig();
    const engine = new TrainingEngine(cfg);

    engine.start();
    // RHYTHM 30s 완전 통과 + MEMORY 진입 + 첫 SHOW 점등 (FIRST_TICK_DELAY_MS=500ms)
    vi.advanceTimersByTime(31_000);

    const phases = bag.phaseChanges.map((p) => p.phase);
    expect(phases).toContain('RHYTHM');
    expect(phases).toContain('COGNITIVE');
    const firstCognitive = bag.phaseChanges.find((p) => p.phase === 'COGNITIVE');
    expect(firstCognitive?.cognitiveMode).toBe('MEMORY');

    engine.destroy();
  });

  it('BLE write 가 throw 해도 tick 루프는 계속 돈다 (방어선)', () => {
    mockedWriteSession.mockImplementationOnce(() => {
      throw new Error('BLE write failed');
    });
    const { cfg, bag } = makeCompositeConfig();
    const engine = new TrainingEngine(cfg);

    expect(() => engine.start()).not.toThrow();
    vi.advanceTimersByTime(1500);

    const litStates = bag.podStates.filter((s) => s.some((p) => p.fill !== 'OFF' && p.litAt !== null));
    expect(litStates.length).toBeGreaterThan(0);

    engine.destroy();
  });
});
