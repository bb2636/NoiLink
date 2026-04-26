import { describe, it, expect } from 'vitest';
import {
  reactionTimeMs,
  driftRatio,
  switchCostMs,
  normLowerIsBetter,
  normHigherIsBetter,
  SESSION_MAX_MS,
  COMPOSITE_TOTAL_MS,
  RHYTHM_PHASE_MS,
  COGNITIVE_PHASE_MS,
  LOGIC_TO_HARDWARE_COLOR,
  logicColorToCode,
  mixedColorRateForLevel,
  defaultOnMsForLevel,
  beatMs,
  judgmentDoubleTapWindowMs,
  rhythmPatternForLevel,
  rhythmStepsForBeat,
  suggestNextSessionParams,
  scoreMemory,
  scoreComprehension,
  scoreFocus,
  scoreJudgment,
  scoreEndurance,
  ENDURANCE_LATE_MIN_SAMPLES,
  isEnduranceLateConfident,
  scoreAgilityMultitasking,
  partialThresholdForMode,
  MODE_PARTIAL_RESULT_THRESHOLDS,
  buildCompositePhasePlan,
  maintainRatio,
  freeModeYieldsScore,
  TRAINING_CATALOG,
  trainingCatalogById,
  MULTITASKING_API_MODE,
  ENDURANCE_EARLY_START_MS,
  ENDURANCE_EARLY_END_MS,
  ENDURANCE_LATE_START_MS,
  ENDURANCE_LATE_END_MS,
} from './training-spec.js';
import { COLOR_CODE } from './ble-protocol.js';

// ---------------------------------------------------------------------------
// 0. 측정 지표 헬퍼
// ---------------------------------------------------------------------------

describe('reactionTimeMs', () => {
  it('정상: t_input > t_on → 차이값', () => {
    expect(reactionTimeMs(100, 350)).toBe(250);
  });
  it('동시: t_input == t_on → 0', () => {
    expect(reactionTimeMs(500, 500)).toBe(0);
  });
  it('역전(잘못된 입력): t_input < t_on → 0 (음수 보호)', () => {
    expect(reactionTimeMs(500, 300)).toBe(0);
  });
  it('빈/0 입력: (0,0) → 0', () => {
    expect(reactionTimeMs(0, 0)).toBe(0);
  });
});

describe('driftRatio — (Late - Early) / Early', () => {
  it('Early <= 0 → 0 (분모 보호)', () => {
    expect(driftRatio(0, 500)).toBe(0);
    expect(driftRatio(-100, 500)).toBe(0);
  });
  it('Late > Early → 양수 비율', () => {
    expect(driftRatio(500, 600)).toBeCloseTo(0.2, 10);
  });
  it('Late < Early → 음수 비율 (개선)', () => {
    expect(driftRatio(500, 400)).toBeCloseTo(-0.2, 10);
  });
  it('Late == Early → 0 (변화 없음)', () => {
    expect(driftRatio(500, 500)).toBe(0);
  });
});

describe('switchCostMs', () => {
  it('first - changed > 0 → 그대로', () => {
    expect(switchCostMs({ ruleChangedAtMs: 1000, firstCorrectAtMs: 1500 })).toBe(500);
  });
  it('first < changed (잘못된 순서) → 0 (음수 보호)', () => {
    expect(switchCostMs({ ruleChangedAtMs: 1500, firstCorrectAtMs: 1000 })).toBe(0);
  });
  it('동시 → 0', () => {
    expect(switchCostMs({ ruleChangedAtMs: 500, firstCorrectAtMs: 500 })).toBe(0);
  });
  it('빈 입력(0,0) → 0', () => {
    expect(switchCostMs({ ruleChangedAtMs: 0, firstCorrectAtMs: 0 })).toBe(0);
  });
});

describe('normLowerIsBetter / normHigherIsBetter — sigma 보호 및 방향성', () => {
  it('sigma <= 0 → 0.5 (분모 보호; 양쪽 동일)', () => {
    expect(normLowerIsBetter(100, 50, 0)).toBe(0.5);
    expect(normLowerIsBetter(100, 50, -1)).toBe(0.5);
    expect(normHigherIsBetter(100, 50, 0)).toBe(0.5);
    expect(normHigherIsBetter(100, 50, -1)).toBe(0.5);
  });
  it('raw == mu → 0.5 (양쪽 동일)', () => {
    expect(normLowerIsBetter(50, 50, 10)).toBe(0.5);
    expect(normHigherIsBetter(50, 50, 10)).toBe(0.5);
  });
  it('lowerIsBetter: raw < mu → 0.5 위로', () => {
    expect(normLowerIsBetter(40, 50, 10)).toBeCloseTo(0.65, 10);
  });
  it('lowerIsBetter: raw > mu → 0.5 아래로', () => {
    expect(normLowerIsBetter(60, 50, 10)).toBeCloseTo(0.35, 10);
  });
  it('higherIsBetter: raw > mu → 0.5 위로', () => {
    expect(normHigherIsBetter(60, 50, 10)).toBeCloseTo(0.65, 10);
  });
  it('higherIsBetter: raw < mu → 0.5 아래로', () => {
    expect(normHigherIsBetter(40, 50, 10)).toBeCloseTo(0.35, 10);
  });
  it('극단값 clamp: 결과는 항상 [0,1]', () => {
    expect(normLowerIsBetter(10000, 0, 1)).toBe(0);
    expect(normLowerIsBetter(-10000, 0, 1)).toBe(1);
    expect(normHigherIsBetter(10000, 0, 1)).toBe(1);
    expect(normHigherIsBetter(-10000, 0, 1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 1. 공통 정책 — 상수·테이블 잠금
// ---------------------------------------------------------------------------

describe('공통 정책 상수 잠금', () => {
  it('SESSION_MAX_MS = 300_000 (5분)', () => {
    expect(SESSION_MAX_MS).toBe(300_000);
  });
  it('COMPOSITE_TOTAL_MS = 300_000', () => {
    expect(COMPOSITE_TOTAL_MS).toBe(300_000);
  });
  it('RHYTHM_PHASE_MS = 30_000 (30초)', () => {
    expect(RHYTHM_PHASE_MS).toBe(30_000);
  });
  it('COGNITIVE_PHASE_MS = 30_000 (30초)', () => {
    expect(COGNITIVE_PHASE_MS).toBe(30_000);
  });
});

describe('LOGIC_TO_HARDWARE_COLOR — 의미 색 ↔ 하드웨어 매핑', () => {
  it('GREEN→G, RED→R, BLUE→B, YELLOW→RG, WHITE→RGB', () => {
    expect(LOGIC_TO_HARDWARE_COLOR).toEqual({
      GREEN: 'G',
      RED: 'R',
      BLUE: 'B',
      YELLOW: 'RG',
      WHITE: 'RGB',
    });
  });
});

describe('logicColorToCode — 펌웨어 ColorCode 매핑', () => {
  it('GREEN → COLOR_CODE.GREEN', () => {
    expect(logicColorToCode('GREEN')).toBe(COLOR_CODE.GREEN);
  });
  it('RED → COLOR_CODE.RED', () => {
    expect(logicColorToCode('RED')).toBe(COLOR_CODE.RED);
  });
  it('BLUE → COLOR_CODE.BLUE', () => {
    expect(logicColorToCode('BLUE')).toBe(COLOR_CODE.BLUE);
  });
  it('YELLOW → COLOR_CODE.YELLOW (RG 합성)', () => {
    expect(logicColorToCode('YELLOW')).toBe(COLOR_CODE.YELLOW);
  });
  it('WHITE → COLOR_CODE.WHITE (RGB 합성)', () => {
    expect(logicColorToCode('WHITE')).toBe(COLOR_CODE.WHITE);
  });
});

describe('mixedColorRateForLevel — Lv1=0% ~ Lv5=35% 선형', () => {
  it('Lv1 → 0', () => {
    expect(mixedColorRateForLevel(1)).toBe(0);
  });
  it('Lv2 → 0.0875', () => {
    expect(mixedColorRateForLevel(2)).toBeCloseTo(0.0875, 10);
  });
  it('Lv3 → 0.175', () => {
    expect(mixedColorRateForLevel(3)).toBeCloseTo(0.175, 10);
  });
  it('Lv4 → 0.2625', () => {
    expect(mixedColorRateForLevel(4)).toBeCloseTo(0.2625, 10);
  });
  it('Lv5 → 0.35', () => {
    expect(mixedColorRateForLevel(5)).toBeCloseTo(0.35, 10);
  });
  it('단조 증가 (Lv↑ → 비율↑)', () => {
    let prev = -Infinity;
    for (const lv of [1, 2, 3, 4, 5] as const) {
      const v = mixedColorRateForLevel(lv);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('defaultOnMsForLevel — 난이도별 점등 지속시간 테이블', () => {
  // 표 값이 바뀌면 사용자가 체감하는 난이도가 그대로 어긋난다 → 정확 잠금.
  it('Lv1=520, Lv2=480, Lv3=440, Lv4=400, Lv5=360 (40ms 간격)', () => {
    expect(defaultOnMsForLevel(1)).toBe(520);
    expect(defaultOnMsForLevel(2)).toBe(480);
    expect(defaultOnMsForLevel(3)).toBe(440);
    expect(defaultOnMsForLevel(4)).toBe(400);
    expect(defaultOnMsForLevel(5)).toBe(360);
  });
  it('단조 감소 (Lv↑ → 점등 짧음)', () => {
    let prev = Infinity;
    for (const lv of [1, 2, 3, 4, 5] as const) {
      const v = defaultOnMsForLevel(lv);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('beatMs — BPM → 한 박 ms (BPM 하한 40 clamp)', () => {
  it('60 BPM → 1000ms', () => {
    expect(beatMs(60)).toBe(1000);
  });
  it('120 BPM → 500ms', () => {
    expect(beatMs(120)).toBe(500);
  });
  it('40 BPM (하한) → 1500ms', () => {
    expect(beatMs(40)).toBe(1500);
  });
  it('20 BPM → 1500ms (40으로 clamp)', () => {
    expect(beatMs(20)).toBe(1500);
  });
  it('0 BPM → 1500ms (40으로 clamp)', () => {
    expect(beatMs(0)).toBe(1500);
  });
});

describe('judgmentDoubleTapWindowMs — min(700, 0.9 × beat_ms)', () => {
  it('느린 BPM: 60 → 700 (상한)', () => {
    // 0.9 * 1000 = 900 → min(700, 900) = 700
    expect(judgmentDoubleTapWindowMs(60)).toBe(700);
  });
  it('70 BPM → 700 (여전히 상한)', () => {
    // 0.9 * (60000/70) ≈ 771 → min = 700
    expect(judgmentDoubleTapWindowMs(70)).toBe(700);
  });
  it('120 BPM → 450 (= 0.9 × 500)', () => {
    expect(judgmentDoubleTapWindowMs(120)).toBeCloseTo(450, 6);
  });
  it('140 BPM → 0.9 × (60000/140) ≈ 385.71', () => {
    expect(judgmentDoubleTapWindowMs(140)).toBeCloseTo(385.7142857, 5);
  });
});

// ---------------------------------------------------------------------------
// 1.5 리듬 패턴
// ---------------------------------------------------------------------------

describe('rhythmPatternForLevel', () => {
  it('Lv1 → L1_4_4_SEQUENTIAL_LAST', () => {
    expect(rhythmPatternForLevel(1)).toBe('L1_4_4_SEQUENTIAL_LAST');
  });
  it('Lv2 → L2_4_4_SEQUENTIAL_LAST', () => {
    expect(rhythmPatternForLevel(2)).toBe('L2_4_4_SEQUENTIAL_LAST');
  });
  it('Lv3 → L3_2_4_SEQUENTIAL', () => {
    expect(rhythmPatternForLevel(3)).toBe('L3_2_4_SEQUENTIAL');
  });
  it('Lv4 → L4_2_4_EXTRA_8TH_P2P3', () => {
    expect(rhythmPatternForLevel(4)).toBe('L4_2_4_EXTRA_8TH_P2P3');
  });
  it('Lv5 → L5_2_4_EXTRA_8TH_P0P1_P2P3', () => {
    expect(rhythmPatternForLevel(5)).toBe('L5_2_4_EXTRA_8TH_P0P1_P2P3');
  });
});

describe('rhythmStepsForBeat — Lv별 한 박 점등 시퀀스', () => {
  it('Lv1: tickIndex 0..3 → P0,P1,P2,P3 순차 (offsetRatio=0)', () => {
    expect(rhythmStepsForBeat(1, 0)).toEqual([{ pods: [0], offsetRatio: 0 }]);
    expect(rhythmStepsForBeat(1, 1)).toEqual([{ pods: [1], offsetRatio: 0 }]);
    expect(rhythmStepsForBeat(1, 2)).toEqual([{ pods: [2], offsetRatio: 0 }]);
    expect(rhythmStepsForBeat(1, 3)).toEqual([{ pods: [3], offsetRatio: 0 }]);
  });
  it('Lv1: tickIndex가 4를 넘어가도 mod 4 순환', () => {
    expect(rhythmStepsForBeat(1, 4)).toEqual([{ pods: [0], offsetRatio: 0 }]);
    expect(rhythmStepsForBeat(1, 7)).toEqual([{ pods: [3], offsetRatio: 0 }]);
  });
  it('Lv2: 동일 패턴 (Lv1과 같은 시퀀스)', () => {
    expect(rhythmStepsForBeat(2, 0)).toEqual([{ pods: [0], offsetRatio: 0 }]);
    expect(rhythmStepsForBeat(2, 5)).toEqual([{ pods: [1], offsetRatio: 0 }]);
  });

  it('Lv3: 0,2 박만 점등 (1,3 박은 빈 배열)', () => {
    expect(rhythmStepsForBeat(3, 0)).toEqual([{ pods: [0], offsetRatio: 0 }]);
    expect(rhythmStepsForBeat(3, 1)).toEqual([]);
    expect(rhythmStepsForBeat(3, 2)).toEqual([{ pods: [1], offsetRatio: 0 }]);
    expect(rhythmStepsForBeat(3, 3)).toEqual([]);
  });

  it('Lv4: 0,2 박은 정박 + 8분 뒷박, 1,3 박은 빈 배열', () => {
    expect(rhythmStepsForBeat(4, 0)).toEqual([
      { pods: [0], offsetRatio: 0 },
      { pods: [2], offsetRatio: 0.5 },
    ]);
    expect(rhythmStepsForBeat(4, 1)).toEqual([]);
    expect(rhythmStepsForBeat(4, 2)).toEqual([
      { pods: [1], offsetRatio: 0 },
      { pods: [3], offsetRatio: 0.5 },
    ]);
    expect(rhythmStepsForBeat(4, 3)).toEqual([]);
  });

  it('Lv5: 0,2 박에 P0/P1·P2/P3 동시 점등 + 8분 뒷박 교차', () => {
    expect(rhythmStepsForBeat(5, 0)).toEqual([
      { pods: [0, 1], offsetRatio: 0 },
      { pods: [2, 3], offsetRatio: 0.5 },
    ]);
    expect(rhythmStepsForBeat(5, 2)).toEqual([
      { pods: [2, 3], offsetRatio: 0 },
      { pods: [0, 1], offsetRatio: 0.5 },
    ]);
    expect(rhythmStepsForBeat(5, 1)).toEqual([]);
    expect(rhythmStepsForBeat(5, 3)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. 자동 난이도
// ---------------------------------------------------------------------------

describe('suggestNextSessionParams — 80↑ 상승, 60↓ 하강, 그 외 유지', () => {
  it('80점 이상 → BPM +5, Level +1', () => {
    const r = suggestNextSessionParams({ previousScore: 80, currentBpm: 100, currentLevel: 3 });
    expect(r.bpmDelta).toBe(5);
    expect(r.levelDelta).toBe(1);
    expect(r.suggestedBpm).toBe(105);
    expect(r.suggestedLevel).toBe(4);
    expect(r.reason).toMatch(/우수|80/);
  });
  it('100점도 동일 (≥80 카테고리)', () => {
    const r = suggestNextSessionParams({ previousScore: 100, currentBpm: 70, currentLevel: 1 });
    expect(r.suggestedBpm).toBe(75);
    expect(r.suggestedLevel).toBe(2);
  });

  it('60점 미만 → BPM -5, Level 유지', () => {
    const r = suggestNextSessionParams({ previousScore: 50, currentBpm: 100, currentLevel: 3 });
    expect(r.bpmDelta).toBe(-5);
    expect(r.levelDelta).toBe(0);
    expect(r.suggestedBpm).toBe(95);
    expect(r.suggestedLevel).toBe(3);
    expect(r.reason).toMatch(/보완|60/);
  });

  it('60~79점 (중간 구간) → 변화 없음', () => {
    const r = suggestNextSessionParams({ previousScore: 60, currentBpm: 100, currentLevel: 3 });
    expect(r.bpmDelta).toBe(0);
    expect(r.levelDelta).toBe(0);
    expect(r.suggestedBpm).toBe(100);
    expect(r.suggestedLevel).toBe(3);
    expect(r.reason).toMatch(/유지|중간/);
  });
  it('79점도 중간 구간', () => {
    const r = suggestNextSessionParams({ previousScore: 79, currentBpm: 80, currentLevel: 2 });
    expect(r.bpmDelta).toBe(0);
    expect(r.levelDelta).toBe(0);
  });

  it('BPM 상한 200 clamp (95↑ 시도 → 200)', () => {
    const r = suggestNextSessionParams({ previousScore: 90, currentBpm: 200, currentLevel: 3 });
    expect(r.suggestedBpm).toBe(200);
  });
  it('BPM 하한 60 clamp (60에서 -5 시도 → 60)', () => {
    const r = suggestNextSessionParams({ previousScore: 30, currentBpm: 60, currentLevel: 3 });
    expect(r.suggestedBpm).toBe(60);
  });

  it('Level 상한 5 clamp (Lv5에서 +1 → 5)', () => {
    const r = suggestNextSessionParams({ previousScore: 95, currentBpm: 100, currentLevel: 5 });
    expect(r.suggestedLevel).toBe(5);
  });
  it('Level 하한 1 clamp는 60↓에선 발생 안 함 (levelDelta=0)', () => {
    const r = suggestNextSessionParams({ previousScore: 0, currentBpm: 100, currentLevel: 1 });
    expect(r.suggestedLevel).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. 점수 산식 (모드별)
// ---------------------------------------------------------------------------

describe('scoreMemory — 60·25·10 가중', () => {
  it('완벽 입력 (acc=1, recall=1, RT 빠름): 87', () => {
    // nRt = clamp01(0.5 - 0.15*((300-600)/150)) = clamp01(0.5 + 0.3) = 0.8
    // 60 + 25 + 10*(1-0.8) = 87
    expect(
      scoreMemory({
        sequenceAccuracy: 1,
        perfectRecallRate: 1,
        avgReactionTime: 300,
        rtNormMu: 600,
        rtNormSigma: 150,
      }),
    ).toBe(87);
  });
  it('빈 입력 (모두 0, sigma=0) → 5 (RT 항만 0.5)', () => {
    expect(
      scoreMemory({
        sequenceAccuracy: 0,
        perfectRecallRate: 0,
        avgReactionTime: 0,
        rtNormMu: 0,
        rtNormSigma: 0,
      }),
    ).toBe(5);
  });
});

describe('scoreComprehension — 40·35·15·10 가중', () => {
  it('빈 입력 → 17.5 (switch 항만 1-0.5=0.5)', () => {
    expect(
      scoreComprehension({
        ruleAccuracy: 0,
        switchCostMs: 0,
        switchCostNormMu: 0,
        switchCostNormSigma: 0,
        switchErrorRate: 0,
        learningCurve01: 0,
      }),
    ).toBeCloseTo(35 * 0.5 + 15 * 1, 10);
  });
  it('우수 입력 (acc=1, switch 빠름, error 없음, 학습 1) → 72', () => {
    // nSw = clamp01(0.5 - 0.15*((100-300)/100)) = clamp01(0.5 + 0.3) = 0.8
    // 40 + 35*(1-0.8) + 15 + 10 = 40 + 7 + 15 + 10 = 72
    expect(
      scoreComprehension({
        ruleAccuracy: 1,
        switchCostMs: 100,
        switchCostNormMu: 300,
        switchCostNormSigma: 100,
        switchErrorRate: 0,
        learningCurve01: 1,
      }),
    ).toBeCloseTo(72, 10);
  });
});

describe('scoreFocus — 35·25·20·10·10 가중', () => {
  it('완벽 입력 (hit=1, error=0, RT/SD μ 매칭) → 90', () => {
    // nRt=nSd=0.5 → 35 + 25 + 20 + 10*0.5 + 10*0.5 = 90
    expect(
      scoreFocus({
        targetHitRate: 1,
        commissionErrorRate: 0,
        omissionErrorRate: 0,
        avgReactionTime: 0,
        reactionTimeSD: 0,
        rtNormMu: 0,
        rtNormSigma: 0,
        rtSdNormMu: 0,
        rtSdNormSigma: 0,
      }),
    ).toBe(90);
  });
});

describe('scoreJudgment — 프로파일 보정 (충동 0.85, 우유부단 0.9)', () => {
  const baseInput = {
    noGoSuccessRate: 1,
    goSuccessRate: 1,
    doubleTapSuccessRate: 1,
    avgReactionTime: 0,
    reactionTimeSD: 0,
    rtNormMu: 0,
    rtNormSigma: 0,
    rtSdNormMu: 0,
    rtSdNormSigma: 0,
  };
  // baseScore = 45 + 25 + 15 + 10*0.5 + 5*0.5 = 92.5

  it('DEFAULT (혹은 미지정) → 보정 없음 (92.5)', () => {
    expect(scoreJudgment(baseInput)).toBe(92.5);
    expect(scoreJudgment({ ...baseInput, profile: 'DEFAULT' })).toBe(92.5);
  });
  it('IMPULSE → × 0.85 (78.625)', () => {
    expect(scoreJudgment({ ...baseInput, profile: 'IMPULSE' })).toBeCloseTo(78.625, 10);
  });
  it('INDECISIVE → × 0.9 (83.25)', () => {
    expect(scoreJudgment({ ...baseInput, profile: 'INDECISIVE' })).toBeCloseTo(83.25, 10);
  });
});

describe('scoreEndurance — 40·20·15·15·10 가중 + drift/omission clamp', () => {
  it('완벽 입력 → 100', () => {
    expect(
      scoreEndurance({
        maintainRatio: 1,
        drift01: 0,
        omissionIncrease01: 0,
        lateStability01: 1,
        lateSpeed01: 1,
      }),
    ).toBe(100);
  });
  it('drift/omission 1 초과 입력은 1로 clamp', () => {
    // 입력이 모두 1이지만 drift=2, omission=2 → clamp01 → 1
    // 40 + 20*(1-1) + 15*(1-1) + 15 + 10 = 65
    expect(
      scoreEndurance({
        maintainRatio: 1,
        drift01: 2,
        omissionIncrease01: 2,
        lateStability01: 1,
        lateSpeed01: 1,
      }),
    ).toBe(65);
  });
  it('빈 입력 → 35 (drift/omission 1-0=1 항)', () => {
    expect(
      scoreEndurance({
        maintainRatio: 0,
        drift01: 0,
        omissionIncrease01: 0,
        lateStability01: 0,
        lateSpeed01: 0,
      }),
    ).toBe(35);
  });

  // Task #54: Late 표본이 임계 이상이면 lateSampleCount 가 있어도 기존 산식과 같다.
  it('Late 표본 충분(임계 이상) → 기존 산식과 동일 결과', () => {
    const baseInput = {
      maintainRatio: 1,
      drift01: 0,
      omissionIncrease01: 0,
      lateStability01: 1,
      lateSpeed01: 1,
    };
    expect(scoreEndurance(baseInput)).toBe(100);
    expect(
      scoreEndurance({ ...baseInput, lateSampleCount: ENDURANCE_LATE_MIN_SAMPLES }),
    ).toBe(100);
    expect(
      scoreEndurance({ ...baseInput, lateSampleCount: ENDURANCE_LATE_MIN_SAMPLES + 100 }),
    ).toBe(100);
  });

  // Task #54: Late 표본이 임계 미만이면 Late 의존 항(maintainRatio/lateStability/lateSpeed)
  // 을 점수에서 제외하고, drift/omissionIncrease 의 35점 만점을 100점으로 재정규화한다.
  it('Late 표본 부족 → Late 의존 항 제외 + drift/omission 재정규화', () => {
    // drift01=0, omissionIncrease01=0 → 남은 35점 만점 → 100점으로 스케일.
    expect(
      scoreEndurance({
        maintainRatio: 1,
        drift01: 0,
        omissionIncrease01: 0,
        lateStability01: 1,
        lateSpeed01: 1,
        lateSampleCount: 1,
      }),
    ).toBeCloseTo(100, 10);

    // 같은 신뢰 부족 케이스에서 maintainRatio/lateStability/lateSpeed 값이 무엇이어도
    // 점수가 변하지 않아야 한다 — 진짜로 Late 의존 항이 제외됐다는 회귀 보호.
    expect(
      scoreEndurance({
        maintainRatio: 0,
        drift01: 0,
        omissionIncrease01: 0,
        lateStability01: 0,
        lateSpeed01: 0,
        lateSampleCount: 0,
      }),
    ).toBeCloseTo(100, 10);

    // drift01=1 → 20*(1-1)=0 / omissionIncrease01=1 → 15*(1-1)=0 → 0점.
    expect(
      scoreEndurance({
        maintainRatio: 1,
        drift01: 1,
        omissionIncrease01: 1,
        lateStability01: 1,
        lateSpeed01: 1,
        lateSampleCount: 0,
      }),
    ).toBeCloseTo(0, 10);

    // drift01=0.5 → 20*0.5=10, omissionIncrease01=0 → 15 → 25점 만점 35 → 100/35*25
    expect(
      scoreEndurance({
        maintainRatio: 1,
        drift01: 0.5,
        omissionIncrease01: 0,
        lateStability01: 1,
        lateSpeed01: 1,
        lateSampleCount: 2,
      }),
    ).toBeCloseTo((100 / 35) * 25, 10);
  });

  // Task #54: lateSampleCount 미존재(undefined) 면 기존 동작과 동일해 하위호환을 유지한다.
  it('lateSampleCount 미존재 → 기존 5항 가중 그대로 적용 (하위 호환)', () => {
    expect(
      scoreEndurance({
        maintainRatio: 1,
        drift01: 0,
        omissionIncrease01: 0,
        lateStability01: 1,
        lateSpeed01: 1,
        // lateSampleCount 의도적으로 생략
      }),
    ).toBe(100);
  });
});

// Task #54: Late 표본 신뢰도 임계 헬퍼
describe('isEnduranceLateConfident — Late 구간 표본 신뢰 임계', () => {
  it('임계값(ENDURANCE_LATE_MIN_SAMPLES) 이상이면 true', () => {
    expect(isEnduranceLateConfident(ENDURANCE_LATE_MIN_SAMPLES)).toBe(true);
    expect(isEnduranceLateConfident(ENDURANCE_LATE_MIN_SAMPLES + 1)).toBe(true);
    expect(isEnduranceLateConfident(1000)).toBe(true);
  });
  it('임계값 미만이면 false', () => {
    expect(isEnduranceLateConfident(0)).toBe(false);
    expect(isEnduranceLateConfident(1)).toBe(false);
    expect(isEnduranceLateConfident(ENDURANCE_LATE_MIN_SAMPLES - 1)).toBe(false);
  });
  it('임계값은 1보다 커야 의미 있다 (1~2 표본도 부족 판정 대상)', () => {
    expect(ENDURANCE_LATE_MIN_SAMPLES).toBeGreaterThan(2);
  });
});

describe('scoreAgilityMultitasking — 30·20·20·10·10 가중 (멀티태스킹)', () => {
  it('완벽 입력 → 80 (norm 항 sigma=0 → 0.5 적용)', () => {
    // nSw=nSync=0.5 → 30 + 20 + 20 + 10*0.5 + 10*0.5 = 80
    expect(
      scoreAgilityMultitasking({
        footAccuracy: 1,
        anchorOmissionRate: 0,
        simultaneousSuccessRate: 1,
        switchCostMs: 0,
        syncErrorMs: 0,
        switchNormMu: 0,
        switchNormSigma: 0,
        syncNormMu: 0,
        syncNormSigma: 0,
      }),
    ).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// 4. 종합 트레이닝 Phase 시퀀스
// ---------------------------------------------------------------------------

describe('buildCompositePhasePlan — 5사이클 RHYTHM↔COGNITIVE 교차', () => {
  it('총 10개 페이즈를 반환', () => {
    expect(buildCompositePhasePlan(1).length).toBe(10);
  });

  it('짝수 인덱스는 RHYTHM, 홀수 인덱스는 COGNITIVE', () => {
    const plan = buildCompositePhasePlan(42);
    for (let i = 0; i < 10; i += 2) {
      expect(plan[i].type).toBe('RHYTHM');
      expect(plan[i].cognitiveMode).toBeUndefined();
    }
    for (let i = 1; i < 10; i += 2) {
      expect(plan[i].type).toBe('COGNITIVE');
      expect(plan[i].cognitiveMode).toBeDefined();
    }
  });

  it('모든 페이즈 길이 = 30_000 ms', () => {
    const plan = buildCompositePhasePlan(7);
    for (const p of plan) {
      expect(p.durationMs).toBe(30_000);
    }
  });

  it('합계 = 300_000 ms (= COMPOSITE_TOTAL_MS)', () => {
    const plan = buildCompositePhasePlan(0);
    const total = plan.reduce((s, p) => s + p.durationMs, 0);
    expect(total).toBe(COMPOSITE_TOTAL_MS);
  });

  it('seed 동일 → 결과 동일 (결정적 RNG)', () => {
    const a = buildCompositePhasePlan(123);
    const b = buildCompositePhasePlan(123);
    expect(a).toEqual(b);
  });

  it('모든 cognitiveMode 는 6대 인지 과제 중 하나', () => {
    const allowed = new Set([
      'MEMORY',
      'COMPREHENSION',
      'FOCUS',
      'JUDGMENT',
      'AGILITY',
      'ENDURANCE',
    ]);
    const plan = buildCompositePhasePlan(99);
    for (const p of plan) {
      if (p.type === 'COGNITIVE') {
        expect(allowed.has(p.cognitiveMode!)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. 지구력 구간
// ---------------------------------------------------------------------------

describe('지구력 구간 상수', () => {
  it('Early=0~100s, Late=200~300s', () => {
    expect(ENDURANCE_EARLY_START_MS).toBe(0);
    expect(ENDURANCE_EARLY_END_MS).toBe(100_000);
    expect(ENDURANCE_LATE_START_MS).toBe(200_000);
    expect(ENDURANCE_LATE_END_MS).toBe(300_000);
  });
});

describe('maintainRatio = late / early', () => {
  it('정상: late=80, early=100 → 0.8', () => {
    expect(maintainRatio(100, 80)).toBe(0.8);
  });
  it('early <= 0 → 0 (분모 보호)', () => {
    expect(maintainRatio(0, 80)).toBe(0);
    expect(maintainRatio(-5, 80)).toBe(0);
  });
  it('late=early → 1 (유지)', () => {
    expect(maintainRatio(50, 50)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 6. 자유 트레이닝
// ---------------------------------------------------------------------------

describe('freeModeYieldsScore', () => {
  it('자유 모드는 점수 산출하지 않음 (false)', () => {
    expect(freeModeYieldsScore()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. 트레이닝 카탈로그
// ---------------------------------------------------------------------------

describe('TRAINING_CATALOG / trainingCatalogById', () => {
  it('총 9개 항목', () => {
    expect(TRAINING_CATALOG.length).toBe(9);
  });
  it('id가 모두 유일', () => {
    const ids = TRAINING_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('각 id로 trainingCatalogById 조회 가능', () => {
    for (const e of TRAINING_CATALOG) {
      expect(trainingCatalogById[e.id]).toBe(e);
    }
  });
  it('COMPOSITE/MEMORY/FREE 필수 항목 포함', () => {
    expect(trainingCatalogById['COMPOSITE'].apiMode).toBe('COMPOSITE');
    expect(trainingCatalogById['MEMORY'].apiMode).toBe('MEMORY');
    expect(trainingCatalogById['FREE'].apiMode).toBe('FREE');
  });
  it('RANDOM 은 AGILITY API 모드로 매핑 (UI=aux)', () => {
    expect(trainingCatalogById['RANDOM'].apiMode).toBe('AGILITY');
    expect(trainingCatalogById['RANDOM'].kind).toBe('aux');
  });
  it('MULTITASKING_API_MODE = AGILITY (멀티태스킹 표기 ↔ API)', () => {
    expect(MULTITASKING_API_MODE).toBe('AGILITY');
  });
});

// ---------------------------------------------------------------------------
// 8. 부분 결과 저장 임계값 (모드별) — Task #24
// ---------------------------------------------------------------------------

describe('partialThresholdForMode / MODE_PARTIAL_RESULT_THRESHOLDS', () => {
  it('ENDURANCE 는 0.9 (Late 구간 점수 보장)', () => {
    expect(partialThresholdForMode('ENDURANCE')).toBe(0.9);
    expect(MODE_PARTIAL_RESULT_THRESHOLDS.ENDURANCE).toBe(0.9);
  });
  it('FOCUS / JUDGMENT 는 0.6 (자극 균질, 표본 충분)', () => {
    expect(partialThresholdForMode('FOCUS')).toBe(0.6);
    expect(partialThresholdForMode('JUDGMENT')).toBe(0.6);
  });
  it('COMPOSITE 는 0.8 (5사이클 중 4사이클)', () => {
    expect(partialThresholdForMode('COMPOSITE')).toBe(0.8);
  });
  it('MEMORY / COMPREHENSION / AGILITY / FREE 는 기본 0.8', () => {
    expect(partialThresholdForMode('MEMORY')).toBe(0.8);
    expect(partialThresholdForMode('COMPREHENSION')).toBe(0.8);
    expect(partialThresholdForMode('AGILITY')).toBe(0.8);
    expect(partialThresholdForMode('FREE')).toBe(0.8);
  });
  it('모든 모드의 임계값이 0~1 범위 안에 있다', () => {
    for (const v of Object.values(MODE_PARTIAL_RESULT_THRESHOLDS)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
