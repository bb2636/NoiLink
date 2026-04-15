/**
 * 브레이니멀 12타입 결정
 * 결정 트리(조건 우선) → 미매칭 시 가중 합산(argmax) Fallback
 */

import type { BrainimalType, MetricsScore } from '@noilink/shared';

const HIGH = 72;
const HIGH_STRONG = 74;
const MID = 60;
const LOW_ERR = 58;
const LOW_ERR_STRONG = 52;

interface AggregatedScores {
  memory: number;
  comprehension: number;
  focus: number;
  judgment: number;
  agility: number;
  endurance: number;
  rhythm: number;
}

interface BrainimalWeights {
  memory: number;
  comprehension: number;
  focus: number;
  judgment: number;
  agility: number;
  endurance: number;
}

const BRAINIMAL_WEIGHTS: Record<BrainimalType, BrainimalWeights> = {
  OWL_FOCUS: { memory: 0.1, comprehension: 0.1, focus: 0.5, judgment: 0.1, agility: 0.1, endurance: 0.1 },
  CHEETAH_JUDGMENT: { memory: 0.1, comprehension: 0.1, focus: 0.1, judgment: 0.5, agility: 0.1, endurance: 0.1 },
  BEAR_ENDURANCE: { memory: 0.1, comprehension: 0.1, focus: 0.1, judgment: 0.1, agility: 0.1, endurance: 0.5 },
  DOLPHIN_BRILLIANT: { memory: 0.4, comprehension: 0.4, focus: 0.05, judgment: 0.05, agility: 0.05, endurance: 0.05 },
  TIGER_STRATEGIC: { memory: 0.1, comprehension: 0.4, focus: 0.1, judgment: 0.1, agility: 0.4, endurance: 0.1 },
  FOX_BALANCED: {
    memory: 1 / 6,
    comprehension: 1 / 6,
    focus: 1 / 6,
    judgment: 1 / 6,
    agility: 1 / 6,
    endurance: 1 / 6,
  },
  CAT_DELICATE: { memory: 0.5, comprehension: 0.1, focus: 0.15, judgment: 0.1, agility: 0.05, endurance: 0.1 },
  EAGLE_INSIGHT: { memory: 0.1, comprehension: 0.5, focus: 0.1, judgment: 0.1, agility: 0.1, endurance: 0.1 },
  LION_BOLD: { memory: 0.1, comprehension: 0.1, focus: 0.1, judgment: 0.5, agility: 0.1, endurance: 0.1 },
  DOG_SOCIAL: { memory: 0.1, comprehension: 0.1, focus: 0.1, judgment: 0.1, agility: 0.5, endurance: 0.1 },
  KOALA_CALM: { memory: 0.15, comprehension: 0.15, focus: 0.2, judgment: 0.2, agility: 0.15, endurance: 0.15 },
  WOLF_CREATIVE: { memory: 0.4, comprehension: 0.1, focus: 0.1, judgment: 0.1, agility: 0.4, endurance: 0.1 },
};

function aggregateScores(scores: MetricsScore[]): AggregatedScores | null {
  if (scores.length === 0) return null;

  const sums = {
    memory: 0,
    comprehension: 0,
    focus: 0,
    judgment: 0,
    agility: 0,
    endurance: 0,
    rhythm: 0,
  };
  const counts = { ...sums };

  for (const score of scores) {
    if (score.memory !== undefined) {
      sums.memory += score.memory;
      counts.memory++;
    }
    if (score.comprehension !== undefined) {
      sums.comprehension += score.comprehension;
      counts.comprehension++;
    }
    if (score.focus !== undefined) {
      sums.focus += score.focus;
      counts.focus++;
    }
    if (score.judgment !== undefined) {
      sums.judgment += score.judgment;
      counts.judgment++;
    }
    if (score.agility !== undefined) {
      sums.agility += score.agility;
      counts.agility++;
    }
    if (score.endurance !== undefined) {
      sums.endurance += score.endurance;
      counts.endurance++;
    }
    if (score.rhythm !== undefined) {
      sums.rhythm += score.rhythm;
      counts.rhythm++;
    }
  }

  return {
    memory: counts.memory > 0 ? sums.memory / counts.memory : 0,
    comprehension: counts.comprehension > 0 ? sums.comprehension / counts.comprehension : 0,
    focus: counts.focus > 0 ? sums.focus / counts.focus : 0,
    judgment: counts.judgment > 0 ? sums.judgment / counts.judgment : 0,
    agility: counts.agility > 0 ? sums.agility / counts.agility : 0,
    endurance: counts.endurance > 0 ? sums.endurance / counts.endurance : 0,
    rhythm: counts.rhythm > 0 ? sums.rhythm / counts.rhythm : 0,
  };
}

function calculateSD(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function hexagonValues(a: AggregatedScores): number[] {
  return [a.memory, a.comprehension, a.focus, a.judgment, a.agility, a.endurance];
}

function memoryVolatility(scores: MetricsScore[]): number {
  const mems = scores.map((s) => s.memory).filter((v): v is number => v !== undefined && !Number.isNaN(v));
  return calculateSD(mems);
}

function weightedArgmax(aggregated: AggregatedScores): BrainimalType {
  let best: BrainimalType = 'FOX_BALANCED';
  let bestSum = -Infinity;
  for (const type of Object.keys(BRAINIMAL_WEIGHTS) as BrainimalType[]) {
    const w = BRAINIMAL_WEIGHTS[type];
    const sum =
      aggregated.memory * w.memory +
      aggregated.comprehension * w.comprehension +
      aggregated.focus * w.focus +
      aggregated.judgment * w.judgment +
      aggregated.agility * w.agility +
      aggregated.endurance * w.endurance;
    if (sum > bestSum) {
      bestSum = sum;
      best = type;
    }
  }
  return best;
}

/**
 * 명세 3.1 결정 트리 (우선순위 순)
 * — 원시 오답/RT 미보유 시: 집중·판단 점수 패턴으로 프록시
 */
function decideByTree(scores: MetricsScore[], a: AggregatedScores): BrainimalType | null {
  const hex = hexagonValues(a);
  const hexMean = hex.reduce((x, y) => x + y, 0) / 6;
  const hexSd = calculateSD(hex);
  const memVol = memoryVolatility(scores);
  const rhythm = a.rhythm > 0 ? a.rhythm : 62;

  // 9. 대담한 사자: 판단 점수는 높으나 집중(오답·누락 프록시)은 낮음 → 충동형
  if (a.judgment >= HIGH && a.focus < LOW_ERR) {
    return 'LION_BOLD';
  }

  // 1. 집중하는 부엉이: 집중 우세 + 오답/누락 낮음 프록시(집중 점수 높음)
  if (a.focus >= HIGH_STRONG && a.focus >= a.judgment + 2 && a.focus >= a.memory + 2 && a.focus >= MID) {
    return 'OWL_FOCUS';
  }

  // 2. 판단력의 치타: 판단 높음 + 오답 낮음 + 반응(순발) 동반 우수
  if (a.judgment >= HIGH_STRONG && a.focus >= MID && a.judgment >= a.agility - 3) {
    return 'CHEETAH_JUDGMENT';
  }

  // 3. 끈기있는 곰: 지구력 높음 + 리듬·유지 안정(드리프트 낮음 프록시: 리듬 점수 양호)
  if (a.endurance >= HIGH && rhythm >= 56 && a.endurance >= hexMean - 2) {
    return 'BEAR_ENDURANCE';
  }

  // 4. 명석한 돌고래
  if (a.memory >= HIGH && a.comprehension >= HIGH) {
    return 'DOLPHIN_BRILLIANT';
  }

  // 5. 전략적인 호랑이: 멀티(AGILITY) + 이해력
  if (a.agility >= HIGH && a.comprehension >= HIGH) {
    return 'TIGER_STRATEGIC';
  }

  // 8. 통찰력의 독수리: 이해 우세 + 전환·학습(순발 동반) 양호
  if (a.comprehension >= HIGH_STRONG && a.agility >= MID + 4 && a.comprehension >= a.memory + 4) {
    return 'EAGLE_INSIGHT';
  }

  // 10. 사회적인 강아지: 멀티 + 리듬감 Good
  if (a.agility >= HIGH && rhythm >= 62) {
    return 'DOG_SOCIAL';
  }

  // 7. 섬세한 고양이: 기억 우세 + (기억 기복 OR 예민성=집중 변동 프록시)
  if (a.memory >= HIGH && (memVol >= 9 || a.focus < MID + 5)) {
    return 'CAT_DELICATE';
  }

  // 12. 창의적인 늑대: 기억 + 멀티 + (기복 OR 리듬 Good)
  if (a.memory >= HIGH - 2 && a.agility >= HIGH - 2 && (memVol >= 8 || rhythm >= 63)) {
    return 'WOLF_CREATIVE';
  }

  // 11. 침착한 코알라: 육각형 기복 낮음 + 오답 낮음 프록시 + 이해력이 최고치는 아님(전환 느림 프록시)
  if (hexSd < 11 && hexMean >= MID && a.comprehension <= 68 && a.focus >= MID - 2 && a.judgment >= MID - 2) {
    return 'KOALA_CALM';
  }

  // 6. 균형적인 여우: 평균 65↑ & 육각형 산포 낮음
  if (hexMean >= 65 && hexSd < 14) {
    return 'FOX_BALANCED';
  }

  return null;
}

function separationConfidence(typeScores: Record<BrainimalType, number>): number {
  const vals = Object.values(typeScores);
  const sd = calculateSD(vals);
  return Math.min(100, (sd / 12) * 100);
}

export function determineBrainimalType(scores: MetricsScore[]): {
  type: BrainimalType | null;
  confidence: number;
} {
  if (scores.length < 3) {
    return { type: null, confidence: 0 };
  }

  const aggregated = aggregateScores(scores);
  if (!aggregated) {
    return { type: null, confidence: 0 };
  }

  const typeScores = {} as Record<BrainimalType, number>;
  for (const type of Object.keys(BRAINIMAL_WEIGHTS) as BrainimalType[]) {
    const w = BRAINIMAL_WEIGHTS[type];
    typeScores[type] =
      aggregated.memory * w.memory +
      aggregated.comprehension * w.comprehension +
      aggregated.focus * w.focus +
      aggregated.judgment * w.judgment +
      aggregated.agility * w.agility +
      aggregated.endurance * w.endurance;
  }

  const treeType = decideByTree(scores, aggregated);
  const fallbackType = weightedArgmax(aggregated);
  const bestType = treeType ?? fallbackType;

  const dataConfidence = Math.min(100, (scores.length / 5) * 100);
  const sep = separationConfidence(typeScores);
  const treeBoost = treeType ? 8 : 0;
  const confidence = Math.round(Math.min(100, dataConfidence * 0.55 + sep * 0.35 + treeBoost));

  return { type: bestType, confidence };
}
