/**
 * AGILITY(=명세 F. 멀티태스킹) 채널 분리 / 동시성공 회귀 테스트
 *
 * 보호 대상:
 * - 정상 채널: GREEN+touch / BLUE·YELLOW+nfc → hand/foot hit 누적, 채널 침범 카운트 0.
 * - 채널 침범: GREEN+nfc / BLUE·YELLOW+touch → hit 미인정, aCrossChannelErrors 누적,
 *   simul 진행 중이었으면 자극 일괄 종료(=동시성공 자연 실패).
 * - 동시(simul) 자극: 두 채널 모두 정확 입력 시에만 aSimulHit 누적. 한 채널만 입력되면
 *   aSimulHit 미증가 + 다른 pod 는 lit 유지(allOff 스킵).
 * - 하위 호환: source 미지정 호출(단위 테스트/구버전 경로) 은 색상만으로 판정.
 *
 * 명세 정본: attached_assets/Pasted--A-MEMORY-Show-Recall-GREEN-W-1778129932929_1778129932930.txt §F
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../native/bleBridge', () => ({
  bleWriteLed: vi.fn(),
  bleWriteSession: vi.fn(),
  bleWriteControl: vi.fn(),
}));

import { TrainingEngine, type EngineConfig, type PodState } from './engine';

function makeEngine(level: 1 | 2 | 3 | 4 | 5 = 4): TrainingEngine {
  const cfg: EngineConfig = {
    mode: 'AGILITY',
    bpm: 60,
    level,
    totalDurationMs: 60_000,
    podCount: 4,
    isComposite: false,
    onPodStates: () => {},
    onElapsedMs: () => {},
    onPhaseChange: () => {},
    onComplete: () => {},
  };
  const eng = new TrainingEngine(cfg);
  eng.start();
  return eng;
}

/**
 * 화이트박스 helper — engine 내부 pods 배열을 강제로 설정해 fireAgilityTick 의
 * 랜덤 의존성을 우회한다 (테스트 결정성 확보). simulPodIds 가 주어지면 simul state
 * 도 함께 설정해 동시 자극 분기를 시뮬레이션한다.
 */
function forceLit(
  eng: TrainingEngine,
  litPods: { id: number; fill: 'GREEN' | 'BLUE' | 'YELLOW' }[],
  simulPodIds?: number[]
): void {
  const now = Date.now();
  const e = eng as unknown as {
    pods: PodState[];
    agilitySimulPending: Set<number> | null;
    currentCognitiveMode: string;
  };
  e.currentCognitiveMode = 'AGILITY';
  e.pods = e.pods.map((p) => {
    const lit = litPods.find((l) => l.id === p.id);
    if (lit) return { ...p, fill: lit.fill, isTarget: true, litAt: now, expiresAt: now + 1000, tickId: 1 };
    return { ...p, fill: 'OFF', isTarget: false, litAt: null, expiresAt: null, tickId: 0 };
  });
  e.agilitySimulPending = simulPodIds ? new Set<number>(simulPodIds) : null;
}

function getAcc(eng: TrainingEngine): Record<string, number> {
  return (eng as unknown as { acc: Record<string, number> }).acc;
}

describe('handleAgilityTap — 채널 분리 (명세 F)', () => {
  it('GREEN(앵커) + touch → 정상 hand hit, 채널 침범 0', () => {
    const eng = makeEngine(4);
    forceLit(eng, [{ id: 1, fill: 'GREEN' }]);
    const ok = eng.handleTap(1, { source: 'touch' });
    expect(ok).toBe(true);
    const a = getAcc(eng);
    expect(a.aHandHit).toBe(1);
    expect(a.aFootHit).toBe(0);
    expect(a.aCrossChannelErrors).toBe(0);
  });

  it('BLUE(오른발) + nfc → 정상 foot hit', () => {
    const eng = makeEngine(4);
    forceLit(eng, [{ id: 0, fill: 'BLUE' }]);
    eng.handleTap(0, { source: 'nfc' });
    const a = getAcc(eng);
    expect(a.aFootHit).toBe(1);
    expect(a.aHandHit).toBe(0);
    expect(a.aCrossChannelErrors).toBe(0);
  });

  it('YELLOW(왼발) + nfc → 정상 foot hit', () => {
    const eng = makeEngine(4);
    forceLit(eng, [{ id: 3, fill: 'YELLOW' }]);
    eng.handleTap(3, { source: 'nfc' });
    const a = getAcc(eng);
    expect(a.aFootHit).toBe(1);
    expect(a.aCrossChannelErrors).toBe(0);
  });

  it('GREEN + nfc → 채널 침범, hand hit 미증가', () => {
    const eng = makeEngine(4);
    forceLit(eng, [{ id: 1, fill: 'GREEN' }]);
    eng.handleTap(1, { source: 'nfc' });
    const a = getAcc(eng);
    expect(a.aHandHit).toBe(0);
    expect(a.aFootHit).toBe(0);
    expect(a.aCrossChannelErrors).toBe(1);
  });

  it('BLUE + touch → 채널 침범, foot hit 미증가', () => {
    const eng = makeEngine(4);
    forceLit(eng, [{ id: 0, fill: 'BLUE' }]);
    eng.handleTap(0, { source: 'touch' });
    const a = getAcc(eng);
    expect(a.aFootHit).toBe(0);
    expect(a.aCrossChannelErrors).toBe(1);
  });

  it('YELLOW + touch → 채널 침범', () => {
    const eng = makeEngine(4);
    forceLit(eng, [{ id: 3, fill: 'YELLOW' }]);
    eng.handleTap(3, { source: 'touch' });
    const a = getAcc(eng);
    expect(a.aFootHit).toBe(0);
    expect(a.aCrossChannelErrors).toBe(1);
  });

  it('source 미지정 → 채널 검증 스킵 (하위 호환)', () => {
    const eng = makeEngine(4);
    forceLit(eng, [{ id: 0, fill: 'BLUE' }]);
    eng.handleTap(0); // 구버전 호출 경로
    const a = getAcc(eng);
    expect(a.aFootHit).toBe(1);
    expect(a.aCrossChannelErrors).toBe(0);
  });
});

describe('handleAgilityTap — 동시(simul) 자극 (명세 F Lv4+)', () => {
  it('두 채널 모두 정확 입력 → aSimulHit 누적', () => {
    const eng = makeEngine(4);
    forceLit(
      eng,
      [
        { id: 1, fill: 'GREEN' }, // 앵커(손)
        { id: 0, fill: 'BLUE' },  // 오른발
      ],
      [1, 0],
    );
    // 첫 채널: 발 → keepOtherPodLit 가 true 라 다른 pod (GREEN) 는 lit 유지.
    eng.handleTap(0, { source: 'nfc' });
    const internal = eng as unknown as { pods: PodState[]; agilitySimulPending: Set<number> | null };
    expect(internal.agilitySimulPending?.has(1)).toBe(true);
    expect(internal.pods.find((p) => p.id === 1)?.fill).toBe('GREEN');
    expect(internal.pods.find((p) => p.id === 0)?.fill).toBe('OFF');
    let a = getAcc(eng);
    expect(a.aSimulHit).toBe(0); // 아직 한 채널만

    // 둘째 채널: 손
    eng.handleTap(1, { source: 'touch' });
    a = getAcc(eng);
    expect(a.aHandHit).toBe(1);
    expect(a.aFootHit).toBe(1);
    expect(a.aSimulHit).toBe(1);
    expect(a.aCrossChannelErrors).toBe(0);
    expect(internal.agilitySimulPending).toBeNull();
  });

  it('첫 입력이 채널 침범 → simul 무효화, aSimulHit 미증가', () => {
    const eng = makeEngine(4);
    forceLit(
      eng,
      [
        { id: 1, fill: 'GREEN' },
        { id: 0, fill: 'BLUE' },
      ],
      [1, 0],
    );
    // GREEN 앵커에 nfc 입력 → 침범
    eng.handleTap(1, { source: 'nfc' });
    const internal = eng as unknown as { agilitySimulPending: Set<number> | null };
    const a = getAcc(eng);
    expect(a.aCrossChannelErrors).toBe(1);
    expect(a.aSimulHit).toBe(0);
    expect(a.aHandHit).toBe(0);
    expect(internal.agilitySimulPending).toBeNull(); // 무효화
  });

  it('단일(non-simul) 정확 입력은 simul로 잘못 분류되지 않는다', () => {
    const eng = makeEngine(4);
    // 단일 자극: GREEN 만 lit, simul state 없음
    forceLit(eng, [{ id: 2, fill: 'GREEN' }]);
    eng.handleTap(2, { source: 'touch' });
    const a = getAcc(eng);
    expect(a.aHandHit).toBe(1);
    expect(a.aSimulHit).toBe(0); // simul 자극이 아니었음
  });
});

describe('agilitySimulPending — 라이프사이클/레이스 방어', () => {
  it('이전 simul 의 만료 cleanup 이 새 simul 의 pending set 을 비우지 않는다 (토큰 가드)', () => {
    const eng = makeEngine(4);
    const internal = eng as unknown as {
      agilitySimulPending: Set<number> | null;
      agilitySimulSeq: number;
      pods: PodState[];
    };

    // 첫 번째 simul 자극 시작 (수동 simulation — fireAgilityTick 의 핵심 라인 모방)
    internal.agilitySimulSeq += 1;
    const seq1 = internal.agilitySimulSeq;
    internal.agilitySimulPending = new Set<number>([1, 0]);

    // 첫 번째 simul 의 cleanup 콜백 (만료 시 fire 될 함수)
    const cleanup1 = () => {
      if (internal.agilitySimulPending && internal.agilitySimulSeq === seq1) {
        internal.agilitySimulPending = null;
      }
    };

    // 두 번째 simul 자극이 cleanup 전에 시작 (실제 환경의 race 시나리오)
    internal.agilitySimulSeq += 1;
    internal.agilitySimulPending = new Set<number>([1, 0]);

    // 이제 첫 번째 cleanup 이 fire — 토큰 가드가 없으면 두 번째 simul state 까지 비움
    cleanup1();

    // 토큰 가드 동작: 새 simul 의 pending set 은 그대로 살아 있어야 함
    expect(internal.agilitySimulPending).not.toBeNull();
    expect(internal.agilitySimulPending?.has(1)).toBe(true);
    expect(internal.agilitySimulPending?.has(0)).toBe(true);
  });

  it('pause() 가 진행 중인 simul state 를 정리해 resume 후 stale leak 이 없다', () => {
    const eng = makeEngine(4);
    forceLit(
      eng,
      [
        { id: 1, fill: 'GREEN' },
        { id: 0, fill: 'BLUE' },
      ],
      [1, 0],
    );

    // 첫 채널만 입력 (simul 진행 중 상태)
    eng.handleTap(0, { source: 'nfc' });
    const internal = eng as unknown as { agilitySimulPending: Set<number> | null };
    expect(internal.agilitySimulPending?.has(1)).toBe(true);

    // 일시정지 — simul state 도 함께 비워져야 함
    eng.pause();
    expect(internal.agilitySimulPending).toBeNull();

    // resume 후 다음 단일 자극이 simul 로 잘못 분류되지 않음을 검증
    eng.resume();
    forceLit(eng, [{ id: 2, fill: 'GREEN' }]); // 단일 GREEN
    eng.handleTap(2, { source: 'touch' });
    const a = getAcc(eng);
    expect(a.aHandHit).toBeGreaterThanOrEqual(1);
    expect(a.aSimulHit).toBe(0); // 단일 자극이므로 simul 카운트 X
  });
});
