/**
 * 트레이닝 엔진 점수 산출(buildMetrics) 회귀 테스트
 *
 * 보호 대상:
 * - `TrainingEngine.buildMetrics()` 가 누적기(`acc`)로부터 6대 지표
 *   (RHYTHM/MEMORY/COMPREHENSION/FOCUS/JUDGMENT/AGILITY/ENDURANCE)와
 *   공통 통계(rtMean/rtSD/touchCount/hitCount)를 결정론적으로 산출한다.
 * - 누군가 분기·가중치를 바꾸면 컴파일은 통과하고 사용자에게는
 *   "점수가 갑자기 이상해졌다"는 형태로만 드러나므로, 본 회귀 테스트가
 *   계산식의 조용한 변경을 막는다.
 *
 * 참조: client/src/training/engine.ts (buildMetrics, emptyAcc, mean/sd/clamp)
 *      shared/types.ts (RawMetrics 형 정의)
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('../native/bleBridge', () => ({
  bleWriteLed: vi.fn(),
  bleWriteSession: vi.fn(),
  bleWriteControl: vi.fn(),
}));

import { TrainingEngine, type EngineConfig } from './engine';

// ───────────────────────────────────────────────────────────
// 헬퍼: buildMetrics 호출 가능한 엔진 인스턴스
// ───────────────────────────────────────────────────────────

function makeEngine(overrides: Partial<EngineConfig> = {}) {
  const cfg: EngineConfig = {
    mode: 'COMPOSITE',
    bpm: 60,
    level: 2,
    totalDurationMs: 60_000,
    podCount: 4,
    isComposite: true,
    onPodStates: () => {},
    onElapsedMs: () => {},
    onPhaseChange: () => {},
    onComplete: () => {},
    ...overrides,
  };
  const engine = new TrainingEngine(cfg);
  return engine;
}

/**
 * private buildMetrics()를 직접 호출한다.
 * 포커스: 입력(누적기) → 출력(메트릭)의 순수 함수성 회귀 검증.
 */
function callBuildMetrics(engine: TrainingEngine) {
  return (engine as unknown as { buildMetrics: () => Record<string, unknown> }).buildMetrics();
}

/** acc를 시드한다 (private 필드를 테스트 전용으로 덮어쓰기). */
function seedAcc(engine: TrainingEngine, acc: Record<string, unknown>) {
  (engine as unknown as { acc: Record<string, unknown> }).acc = acc;
}

/** emptyAcc()와 동일한 기본 누적기 (engine.ts 와 일치 유지) */
function freshAcc() {
  return {
    ticks: 0, taps: 0, hits: 0, rtSamples: [] as number[],
    rhythmTicks: 0, rPerfect: 0, rGood: 0, rBad: 0, rMiss: 0, rOffsets: [] as number[],
    fTargetCount: 0, fTargetHits: 0, fDistractorCount: 0, fCommissions: 0, fOmissions: 0, fRTs: [] as number[],
    mShown: 0, mCorrect: 0, mPerfectSeqs: 0, mTotalSeqs: 0, mRTs: [] as number[],
    cTotal: 0, cCorrect: 0, cSwitchCount: 0, cSwitchFirstRTs: [] as number[], cSwitchErrors: 0, cSwitchAttempts: 0, cRTs: [] as number[],
    jGoCount: 0, jGoHit: 0, jGoRTs: [] as number[], jNoGoCount: 0, jNoGoSuccess: 0, jDoubleCount: 0, jDoubleHit: 0, jImpulse: 0,
    aHandCount: 0, aHandHit: 0, aFootCount: 0, aFootHit: 0, aSimulCount: 0, aSimulHit: 0, aRTs: [] as number[],
    earlyHits: 0, earlyTotal: 0, earlyRTs: [] as number[],
    midHits: 0, midTotal: 0, midRTs: [] as number[],
    lateHits: 0, lateTotal: 0, lateRTs: [] as number[],
    earlyOmissions: 0, lateOmissions: 0,
    recoveryMs: 0, recoveryWindows: 0,
  };
}

// ───────────────────────────────────────────────────────────
// (1) 결정론적 누적기 → 핵심 필드 기댓값 일치
// ───────────────────────────────────────────────────────────

describe('buildMetrics: 결정론적 누적기에서 핵심 필드가 기댓값과 일치한다', () => {
  it('모든 6대 지표가 정의된 공식으로 계산된다 (회귀 잠금)', () => {
    const engine = makeEngine({ level: 2 });
    seedAcc(engine, {
      ...freshAcc(),
      // RHYTHM: 10틱 중 perfect 4 / good 3 / bad 2 / miss 1
      // accuracy = (4 + 3*0.5 + 2*0.2)/10 = 0.59
      // offsets: mean=30, sample sd = sqrt(((10-30)^2+(30-30)^2+(50-30)^2)/2) = 20
      rhythmTicks: 10, rPerfect: 4, rGood: 3, rBad: 2, rMiss: 1, rOffsets: [10, 30, 50],

      // FOCUS: 10타겟 중 8적중 / 10방해 중 2오답 / 누락 2
      // hitRate=0.8, commission=0.2, omission=(10-8)/10=0.2
      // fRTs mean=300, sample sd = sqrt(((200-300)^2+(400-300)^2)/1)=sqrt(20000)≈141.42 → 141
      fTargetCount: 10, fTargetHits: 8, fDistractorCount: 10, fCommissions: 2, fOmissions: 2, fRTs: [200, 400],

      // MEMORY: shown=10/correct=7 → seqAcc=0.7
      // perfect 2/totalSeqs 4 → perfectRecall=0.5
      // mRTs: mean=200
      mShown: 10, mCorrect: 7, mPerfectSeqs: 2, mTotalSeqs: 4, mRTs: [100, 300],

      // COMPREHENSION: ruleAcc=8/10=0.8, switchRT=mean([100,200,300])=200,
      // switchErrRate=2/10=0.2, cRTs mean=200
      cTotal: 10, cCorrect: 8, cSwitchCount: 3, cSwitchFirstRTs: [100, 200, 300],
      cSwitchErrors: 2, cSwitchAttempts: 10, cRTs: [150, 250],

      // JUDGMENT: go=7/10=0.7, noGo=4/5=0.8, double=3/4=0.75
      // jGoRTs mean=400, sample sd=sqrt(((300-400)^2+(500-400)^2)/1)=sqrt(20000)→141
      jGoCount: 10, jGoHit: 7, jGoRTs: [300, 500],
      jNoGoCount: 5, jNoGoSuccess: 4, jDoubleCount: 4, jDoubleHit: 3, jImpulse: 1,

      // AGILITY: hand=8/10=0.8 → anchorOmit=0.2, foot=4/5=0.8, simul=3/4=0.75
      // aRTs mean=400
      aHandCount: 10, aHandHit: 8, aFootCount: 5, aFootHit: 4, aSimulCount: 4, aSimulHit: 3, aRTs: [300, 500],

      // ENDURANCE: early=4/5=0.8→80, mid=3/5=0.6→60, late=2/5=0.4→40
      // maintain = 40/80 = 0.5
      // earlyRTm = 150, lateRTm = 350 → drift = clamp((350-150)/150, 0, 1) = 1
      // omissionIncrease = max(0, 4-1) = 3
      earlyHits: 4, earlyTotal: 5, earlyRTs: [100, 200],
      midHits: 3, midTotal: 5, midRTs: [200, 300],
      lateHits: 2, lateTotal: 5, lateRTs: [300, 400],
      earlyOmissions: 1, lateOmissions: 4,

      // RECOVERY: 회복 구간 4123ms 누적·2회 → excludedMs=4123(반올림), windows=2
      recoveryMs: 4123, recoveryWindows: 2,
    });

    const m = callBuildMetrics(engine) as {
      touchCount: number; hitCount: number; rtMean: number; rtSD: number;
      createdAt: string;
      rhythm: { totalTicks: number; perfectCount: number; goodCount: number; badCount: number; missCount: number; accuracy: number; avgOffset: number; offsetSD: number };
      memory: { maxSpan: number; sequenceAccuracy: number; perfectRecallRate: number; avgReactionTime: number };
      comprehension: { avgReactionTime: number; switchCost: number; switchErrorRate: number; learningSlope: number; ruleAccuracy: number };
      focus: { targetHitRate: number; commissionErrorRate: number; omissionErrorRate: number; avgReactionTime: number; reactionTimeSD: number; lapseCount: number };
      judgment: { noGoSuccessRate: number; goSuccessRate: number; doubleTapSuccessRate: number; avgGoReactionTime: number; reactionTimeSD: number; impulseCount: number };
      agility: { footAccuracy: number; anchorOmissionRate: number; simultaneousSuccessRate: number; switchCost: number; syncError: number; reactionTime: number };
      endurance: { earlyScore: number; midScore: number; lateScore: number; maintainRatio: number; drift: number; earlyReactionTime: number; lateReactionTime: number; omissionIncrease: number };
      recovery: { excludedMs: number; windows: number };
    };

    // RHYTHM
    expect(m.rhythm.totalTicks).toBe(10);
    expect(m.rhythm.perfectCount).toBe(4);
    expect(m.rhythm.goodCount).toBe(3);
    expect(m.rhythm.badCount).toBe(2);
    expect(m.rhythm.missCount).toBe(1);
    expect(m.rhythm.accuracy).toBeCloseTo(0.59, 5);
    expect(m.rhythm.avgOffset).toBe(30);
    expect(m.rhythm.offsetSD).toBe(20);

    // FOCUS
    expect(m.focus.targetHitRate).toBeCloseTo(0.8, 5);
    expect(m.focus.commissionErrorRate).toBeCloseTo(0.2, 5);
    expect(m.focus.omissionErrorRate).toBeCloseTo(0.2, 5);
    expect(m.focus.avgReactionTime).toBe(300);
    expect(m.focus.reactionTimeSD).toBe(141);
    expect(m.focus.lapseCount).toBe(0);

    // MEMORY (maxSpan = level + 2 = 4)
    expect(m.memory.maxSpan).toBe(4);
    expect(m.memory.sequenceAccuracy).toBeCloseTo(0.7, 5);
    expect(m.memory.perfectRecallRate).toBeCloseTo(0.5, 5);
    expect(m.memory.avgReactionTime).toBe(200);

    // COMPREHENSION
    expect(m.comprehension.ruleAccuracy).toBeCloseTo(0.8, 5);
    expect(m.comprehension.switchCost).toBe(200);
    expect(m.comprehension.switchErrorRate).toBeCloseTo(0.2, 5);
    expect(m.comprehension.avgReactionTime).toBe(200);
    expect(m.comprehension.learningSlope).toBe(0);

    // JUDGMENT
    expect(m.judgment.goSuccessRate).toBeCloseTo(0.7, 5);
    expect(m.judgment.noGoSuccessRate).toBeCloseTo(0.8, 5);
    expect(m.judgment.doubleTapSuccessRate).toBeCloseTo(0.75, 5);
    expect(m.judgment.avgGoReactionTime).toBe(400);
    expect(m.judgment.reactionTimeSD).toBe(141);
    expect(m.judgment.impulseCount).toBe(1);

    // AGILITY
    expect(m.agility.footAccuracy).toBeCloseTo(0.8, 5);
    expect(m.agility.anchorOmissionRate).toBeCloseTo(0.2, 5);
    expect(m.agility.simultaneousSuccessRate).toBeCloseTo(0.75, 5);
    expect(m.agility.reactionTime).toBe(400);
    // 현행 코드는 두 값을 상수 노출(추후 제거 시 본 테스트가 신호) — 회귀 잠금
    expect(m.agility.switchCost).toBe(250);
    expect(m.agility.syncError).toBe(80);

    // ENDURANCE
    expect(m.endurance.earlyScore).toBe(80);
    expect(m.endurance.midScore).toBe(60);
    expect(m.endurance.lateScore).toBe(40);
    expect(m.endurance.maintainRatio).toBeCloseTo(0.5, 5);
    expect(m.endurance.drift).toBe(1); // clamp 1.333 → 1
    expect(m.endurance.earlyReactionTime).toBe(150);
    expect(m.endurance.lateReactionTime).toBe(350);
    expect(m.endurance.omissionIncrease).toBe(3);

    // RECOVERY (Task #27): 채점 제외 시간/횟수가 그대로 노출
    expect(m.recovery.excludedMs).toBe(4123);
    expect(m.recovery.windows).toBe(2);

    // 통합 통계
    // allRTs = [...fRTs, ...cRTs, ...jGoRTs, ...aRTs, ...mRTs]
    //        = [200,400, 150,250, 300,500, 300,500, 100,300]
    // sum=3000, len=10, mean=300
    expect(m.rtMean).toBe(300);
    // sample sd = sqrt(165000/9) ≈ 135.40 → 135
    expect(m.rtSD).toBe(135);

    // touchCount = totalTaps + rPerfect + rGood + rBad
    // totalTaps = fTargetHits(8) + fCommissions(2) + cCorrect(8) + jGoHit(7)
    //            + jDoubleHit(3) + aHandHit(8) + aFootHit(4) + mCorrect(7) = 47
    // touchCount = 47 + 4 + 3 + 2 = 56
    expect(m.touchCount).toBe(56);

    // hitCount = fTargetHits(8) + cCorrect(8) + jGoHit(7) + jDoubleHit(3)
    //          + jNoGoSuccess(4) + aHandHit(8) + aFootHit(4) + mCorrect(7) = 49
    expect(m.hitCount).toBe(49);

    // createdAt: ISO 문자열
    expect(typeof m.createdAt).toBe('string');
    expect(() => new Date(m.createdAt)).not.toThrow();
    expect(Number.isNaN(new Date(m.createdAt).getTime())).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────
// (2) 엣지 케이스: 빈 누적기 — 분모 0 보호 + 기본값 일관성
// ───────────────────────────────────────────────────────────

describe('buildMetrics: 빈 누적기에서 분모 0 보호와 기본값이 일관되게 적용된다', () => {
  it('모든 누적기가 0이어도 NaN/Infinity 없이 결정론적 기본값을 낸다', () => {
    const engine = makeEngine({ level: 1 });
    seedAcc(engine, freshAcc());
    const m = callBuildMetrics(engine) as {
      touchCount: number; hitCount: number; rtMean: number; rtSD: number;
      rhythm: { totalTicks: number; accuracy: number; avgOffset: number; offsetSD: number };
      memory: { maxSpan: number; sequenceAccuracy: number; perfectRecallRate: number; avgReactionTime: number };
      comprehension: { avgReactionTime: number; switchCost: number; switchErrorRate: number; ruleAccuracy: number };
      focus: { targetHitRate: number; commissionErrorRate: number; omissionErrorRate: number; avgReactionTime: number; reactionTimeSD: number };
      judgment: { goSuccessRate: number; noGoSuccessRate: number; doubleTapSuccessRate: number; avgGoReactionTime: number; reactionTimeSD: number; impulseCount: number };
      agility: { footAccuracy: number; anchorOmissionRate: number; simultaneousSuccessRate: number; reactionTime: number };
      endurance: { earlyScore: number; midScore: number; lateScore: number; maintainRatio: number; drift: number; earlyReactionTime: number; lateReactionTime: number; omissionIncrease: number };
      recovery: { excludedMs: number; windows: number };
    };

    // NaN/Infinity 부재 검증 (모든 숫자 필드)
    const numericFields = [
      m.touchCount, m.hitCount, m.rtMean, m.rtSD,
      m.rhythm.totalTicks, m.rhythm.accuracy, m.rhythm.avgOffset, m.rhythm.offsetSD,
      m.memory.sequenceAccuracy, m.memory.perfectRecallRate, m.memory.avgReactionTime,
      m.comprehension.avgReactionTime, m.comprehension.switchCost, m.comprehension.switchErrorRate, m.comprehension.ruleAccuracy,
      m.focus.targetHitRate, m.focus.commissionErrorRate, m.focus.omissionErrorRate, m.focus.avgReactionTime, m.focus.reactionTimeSD,
      m.judgment.goSuccessRate, m.judgment.noGoSuccessRate, m.judgment.doubleTapSuccessRate, m.judgment.avgGoReactionTime, m.judgment.reactionTimeSD,
      m.agility.footAccuracy, m.agility.anchorOmissionRate, m.agility.simultaneousSuccessRate, m.agility.reactionTime,
      m.endurance.earlyScore, m.endurance.midScore, m.endurance.lateScore,
      m.endurance.maintainRatio, m.endurance.drift,
      m.endurance.earlyReactionTime, m.endurance.lateReactionTime, m.endurance.omissionIncrease,
    ];
    for (const v of numericFields) {
      expect(Number.isFinite(v)).toBe(true);
    }

    // RHYTHM: 0 누적 → accuracy 0
    expect(m.rhythm.totalTicks).toBe(0);
    expect(m.rhythm.accuracy).toBe(0);
    expect(m.rhythm.avgOffset).toBe(0);
    expect(m.rhythm.offsetSD).toBe(0);

    // FOCUS: 분모 0 → 모두 0, RT 기본값 500
    expect(m.focus.targetHitRate).toBe(0);
    expect(m.focus.commissionErrorRate).toBe(0);
    expect(m.focus.omissionErrorRate).toBe(0);
    expect(m.focus.avgReactionTime).toBe(500);
    expect(m.focus.reactionTimeSD).toBe(0);

    // MEMORY: maxSpan = level(1) + 2 = 3
    expect(m.memory.maxSpan).toBe(3);
    expect(m.memory.sequenceAccuracy).toBe(0);
    expect(m.memory.perfectRecallRate).toBe(0);
    expect(m.memory.avgReactionTime).toBe(500);

    // COMPREHENSION: switchRT 기본 500, RT 500
    expect(m.comprehension.ruleAccuracy).toBe(0);
    expect(m.comprehension.switchCost).toBe(500);
    expect(m.comprehension.switchErrorRate).toBe(0);
    expect(m.comprehension.avgReactionTime).toBe(500);

    // JUDGMENT: 모든 분모 0 → 모두 0, RT 500
    expect(m.judgment.goSuccessRate).toBe(0);
    expect(m.judgment.noGoSuccessRate).toBe(0);
    expect(m.judgment.doubleTapSuccessRate).toBe(0);
    expect(m.judgment.avgGoReactionTime).toBe(500);
    expect(m.judgment.reactionTimeSD).toBe(0);
    expect(m.judgment.impulseCount).toBe(0);

    // AGILITY: handRate=0 → anchorOmit = clamp(1-0,0,1) = 1
    expect(m.agility.footAccuracy).toBe(0);
    expect(m.agility.anchorOmissionRate).toBe(1);
    expect(m.agility.simultaneousSuccessRate).toBe(0);
    expect(m.agility.reactionTime).toBe(500);

    // ENDURANCE: earlyScore=0 → maintain=0 (분모 보호), drift=0 (earlyRTm=lateRTm=500)
    expect(m.endurance.earlyScore).toBe(0);
    expect(m.endurance.midScore).toBe(0);
    expect(m.endurance.lateScore).toBe(0);
    expect(m.endurance.maintainRatio).toBe(0);
    expect(m.endurance.drift).toBe(0);
    expect(m.endurance.earlyReactionTime).toBe(500);
    expect(m.endurance.lateReactionTime).toBe(500);
    expect(m.endurance.omissionIncrease).toBe(0);

    // 통합 통계
    expect(m.rtMean).toBe(500);
    expect(m.rtSD).toBe(0);
    expect(m.touchCount).toBe(0);
    expect(m.hitCount).toBe(0);

    // RECOVERY: 비누적 → 0/0
    expect(m.recovery.excludedMs).toBe(0);
    expect(m.recovery.windows).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────
// (3) 엣지 케이스: 모든 시도 실패
// ───────────────────────────────────────────────────────────

describe('buildMetrics: 모든 시도 실패 시 적중률·정확도가 0, 누락/오답률은 1', () => {
  it('count > 0 이지만 hit = 0 → 모든 정답 비율 0, 누락률 1', () => {
    const engine = makeEngine({ level: 2 });
    seedAcc(engine, {
      ...freshAcc(),
      // RHYTHM: 모두 miss
      rhythmTicks: 8, rPerfect: 0, rGood: 0, rBad: 0, rMiss: 8, rOffsets: [],

      // FOCUS: 타겟 모두 누락 + 방해는 모두 잘못 누름
      fTargetCount: 5, fTargetHits: 0, fDistractorCount: 4, fCommissions: 4, fOmissions: 5,

      // MEMORY: 입력 모두 오답
      mShown: 6, mCorrect: 0, mPerfectSeqs: 0, mTotalSeqs: 2, mRTs: [],

      // COMPREHENSION: 정답 0
      cTotal: 5, cCorrect: 0, cSwitchCount: 2, cSwitchFirstRTs: [], cSwitchErrors: 4, cSwitchAttempts: 4, cRTs: [],

      // JUDGMENT: GO/NO-GO/DOUBLE 모두 실패
      jGoCount: 4, jGoHit: 0, jNoGoCount: 3, jNoGoSuccess: 0, jDoubleCount: 2, jDoubleHit: 0, jImpulse: 3,

      // AGILITY: 손/발/동시 모두 실패
      aHandCount: 4, aHandHit: 0, aFootCount: 4, aFootHit: 0, aSimulCount: 2, aSimulHit: 0,

      // ENDURANCE: 적중 0
      earlyHits: 0, earlyTotal: 5, midHits: 0, midTotal: 5, lateHits: 0, lateTotal: 5,
      earlyOmissions: 1, lateOmissions: 5,
    });

    const m = callBuildMetrics(engine) as {
      rhythm: { accuracy: number };
      memory: { sequenceAccuracy: number; perfectRecallRate: number };
      comprehension: { ruleAccuracy: number; switchErrorRate: number };
      focus: { targetHitRate: number; commissionErrorRate: number; omissionErrorRate: number };
      judgment: { goSuccessRate: number; noGoSuccessRate: number; doubleTapSuccessRate: number };
      agility: { footAccuracy: number; anchorOmissionRate: number; simultaneousSuccessRate: number };
      endurance: { earlyScore: number; midScore: number; lateScore: number; maintainRatio: number; omissionIncrease: number };
      hitCount: number;
    };

    expect(m.rhythm.accuracy).toBe(0);
    expect(m.focus.targetHitRate).toBe(0);
    expect(m.focus.commissionErrorRate).toBe(1);
    expect(m.focus.omissionErrorRate).toBe(1);
    expect(m.memory.sequenceAccuracy).toBe(0);
    expect(m.memory.perfectRecallRate).toBe(0);
    expect(m.comprehension.ruleAccuracy).toBe(0);
    expect(m.comprehension.switchErrorRate).toBe(1);
    expect(m.judgment.goSuccessRate).toBe(0);
    expect(m.judgment.noGoSuccessRate).toBe(0);
    expect(m.judgment.doubleTapSuccessRate).toBe(0);
    expect(m.agility.footAccuracy).toBe(0);
    expect(m.agility.anchorOmissionRate).toBe(1); // hand=0 → 1-0=1
    expect(m.agility.simultaneousSuccessRate).toBe(0);

    expect(m.endurance.earlyScore).toBe(0);
    expect(m.endurance.midScore).toBe(0);
    expect(m.endurance.lateScore).toBe(0);
    expect(m.endurance.maintainRatio).toBe(0); // earlyScore=0 → 0
    expect(m.endurance.omissionIncrease).toBe(4); // 5-1

    expect(m.hitCount).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────
// (4) 엣지 케이스: 모든 시도 성공
// ───────────────────────────────────────────────────────────

describe('buildMetrics: 모든 시도 성공 시 적중률·정확도가 1, 오답/누락률은 0', () => {
  it('count = hit (전부 성공) → 모든 정답 비율 1, 정확도 1', () => {
    const engine = makeEngine({ level: 3 });
    seedAcc(engine, {
      ...freshAcc(),
      // RHYTHM: 모두 PERFECT (가중치 1.0) → accuracy 1
      rhythmTicks: 6, rPerfect: 6, rGood: 0, rBad: 0, rMiss: 0, rOffsets: [0, 0, 0, 0, 0, 0],

      // FOCUS: 모두 적중 + 방해는 누름 0
      fTargetCount: 5, fTargetHits: 5, fDistractorCount: 4, fCommissions: 0, fOmissions: 0,
      fRTs: [200, 200, 200, 200, 200],

      // MEMORY: 입력 모두 정답 + 모든 시퀀스 완벽
      mShown: 6, mCorrect: 6, mPerfectSeqs: 2, mTotalSeqs: 2, mRTs: [100, 100],

      // COMPREHENSION: 모두 정답 + 전환 오류 0
      cTotal: 5, cCorrect: 5, cSwitchCount: 2, cSwitchFirstRTs: [200, 200],
      cSwitchErrors: 0, cSwitchAttempts: 4, cRTs: [200, 200],

      // JUDGMENT: 모두 성공
      jGoCount: 4, jGoHit: 4, jGoRTs: [300, 300, 300, 300],
      jNoGoCount: 3, jNoGoSuccess: 3, jDoubleCount: 2, jDoubleHit: 2, jImpulse: 0,

      // AGILITY: 손/발/동시 전부 성공
      aHandCount: 4, aHandHit: 4, aFootCount: 4, aFootHit: 4, aSimulCount: 2, aSimulHit: 2,
      aRTs: [250, 250],

      // ENDURANCE: 모두 적중 → score=100, maintain=1
      earlyHits: 5, earlyTotal: 5, earlyRTs: [200, 200],
      midHits: 5, midTotal: 5, midRTs: [200, 200],
      lateHits: 5, lateTotal: 5, lateRTs: [200, 200],
      earlyOmissions: 0, lateOmissions: 0,
    });

    const m = callBuildMetrics(engine) as {
      rhythm: { accuracy: number };
      memory: { sequenceAccuracy: number; perfectRecallRate: number };
      comprehension: { ruleAccuracy: number; switchErrorRate: number };
      focus: { targetHitRate: number; commissionErrorRate: number; omissionErrorRate: number };
      judgment: { goSuccessRate: number; noGoSuccessRate: number; doubleTapSuccessRate: number; impulseCount: number };
      agility: { footAccuracy: number; anchorOmissionRate: number; simultaneousSuccessRate: number };
      endurance: { earlyScore: number; midScore: number; lateScore: number; maintainRatio: number; drift: number; omissionIncrease: number };
    };

    expect(m.rhythm.accuracy).toBe(1);
    expect(m.focus.targetHitRate).toBe(1);
    expect(m.focus.commissionErrorRate).toBe(0);
    expect(m.focus.omissionErrorRate).toBe(0);
    expect(m.memory.sequenceAccuracy).toBe(1);
    expect(m.memory.perfectRecallRate).toBe(1);
    expect(m.comprehension.ruleAccuracy).toBe(1);
    expect(m.comprehension.switchErrorRate).toBe(0);
    expect(m.judgment.goSuccessRate).toBe(1);
    expect(m.judgment.noGoSuccessRate).toBe(1);
    expect(m.judgment.doubleTapSuccessRate).toBe(1);
    expect(m.judgment.impulseCount).toBe(0);
    expect(m.agility.footAccuracy).toBe(1);
    expect(m.agility.anchorOmissionRate).toBe(0); // 1 - 1 = 0
    expect(m.agility.simultaneousSuccessRate).toBe(1);

    expect(m.endurance.earlyScore).toBe(100);
    expect(m.endurance.midScore).toBe(100);
    expect(m.endurance.lateScore).toBe(100);
    expect(m.endurance.maintainRatio).toBe(1); // 100/100
    expect(m.endurance.drift).toBe(0); // earlyRTm == lateRTm == 200
    expect(m.endurance.omissionIncrease).toBe(0);
  });
});
