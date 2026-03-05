/**
 * 브레이니멀 타입 결정 로직
 * 기능 명세서 3.1절 구현
 */

import type {
  BrainimalType,
  MetricsScore,
} from '@noilink/shared';

/**
 * 최근 5회 유효 세션의 6대 지표 점수 집계
 */
interface AggregatedScores {
  memory: number;
  comprehension: number;
  focus: number;
  judgment: number;
  multitasking: number;
  endurance: number;
}

/**
 * 브레이니멀 타입별 가중치 테이블
 * 명세서 3.1절 기반
 */
interface BrainimalWeights {
  memory: number;
  comprehension: number;
  focus: number;
  judgment: number;
  multitasking: number;
  endurance: number;
}

const BRAINIMAL_WEIGHTS: Record<BrainimalType, BrainimalWeights> = {
  // 1. 집중하는 부엉이: FOCUS High & 오답/놓침 Low
  OWL_FOCUS: {
    memory: 0.1,
    comprehension: 0.1,
    focus: 0.5,
    judgment: 0.1,
    multitasking: 0.1,
    endurance: 0.1,
  },
  
  // 2. 판단력의 치타: JUDGMENT High & 오답 Low & 빠른 반응속도
  CHEETAH_JUDGMENT: {
    memory: 0.1,
    comprehension: 0.1,
    focus: 0.1,
    judgment: 0.5,
    multitasking: 0.1,
    endurance: 0.1,
  },
  
  // 3. 끈기있는 곰: ENDURANCE High & 후반 지연(Drift) Low
  BEAR_ENDURANCE: {
    memory: 0.1,
    comprehension: 0.1,
    focus: 0.1,
    judgment: 0.1,
    multitasking: 0.1,
    endurance: 0.5,
  },
  
  // 4. 명석한 돌고래: MEMORY High & COMPREHENSION High
  DOLPHIN_BRILLIANT: {
    memory: 0.4,
    comprehension: 0.4,
    focus: 0.05,
    judgment: 0.05,
    multitasking: 0.05,
    endurance: 0.05,
  },
  
  // 5. 전략적인 호랑이: MULTITASKING High & COMPREHENSION High
  TIGER_STRATEGIC: {
    memory: 0.1,
    comprehension: 0.4,
    focus: 0.1,
    judgment: 0.1,
    multitasking: 0.4,
    endurance: 0.1,
  },
  
  // 6. 균형적인 여우: 전체 평균 65↑ & 표준편차 Low
  FOX_BALANCED: {
    memory: 0.167,
    comprehension: 0.167,
    focus: 0.167,
    judgment: 0.167,
    multitasking: 0.167,
    endurance: 0.167,
  },
  
  // 7. 섬세한 고양이: MEMORY High & (반응기복 High OR 예민성 지표 High)
  CAT_DELICATE: {
    memory: 0.5,
    comprehension: 0.1,
    focus: 0.15,
    judgment: 0.1,
    multitasking: 0.05,
    endurance: 0.1,
  },
  
  // 8. 통찰력의 독수리: COMPREHENSION High & 전환속도 빠름 & 학습곡선 좋음
  EAGLE_INSIGHT: {
    memory: 0.1,
    comprehension: 0.5,
    focus: 0.1,
    judgment: 0.1,
    multitasking: 0.1,
    endurance: 0.1,
  },
  
  // 9. 대담한 사자: JUDGMENT High & 오답 High (충동형 성향)
  LION_BOLD: {
    memory: 0.1,
    comprehension: 0.1,
    focus: 0.1,
    judgment: 0.5,
    multitasking: 0.1,
    endurance: 0.1,
  },
  
  // 10. 사회적인 강아지: MULTITASKING High & 리듬감 Good
  DOG_SOCIAL: {
    memory: 0.1,
    comprehension: 0.1,
    focus: 0.1,
    judgment: 0.1,
    multitasking: 0.5,
    endurance: 0.1,
  },
  
  // 11. 침착한 코알라: 반응기복 Low & 오답 Low & 전환 느림 (안정 지향)
  KOALA_CALM: {
    memory: 0.15,
    comprehension: 0.15,
    focus: 0.2,
    judgment: 0.2,
    multitasking: 0.15,
    endurance: 0.15,
  },
  
  // 12. 창의적인 늑대: MEMORY High & MULTITASKING High & (기복 High OR 리듬 Good)
  WOLF_CREATIVE: {
    memory: 0.4,
    comprehension: 0.1,
    focus: 0.1,
    judgment: 0.1,
    multitasking: 0.4,
    endurance: 0.1,
  },
};

/**
 * 점수 집계 (최근 5회 평균)
 */
function aggregateScores(scores: MetricsScore[]): AggregatedScores | null {
  if (scores.length === 0) return null;
  
  const sums = {
    memory: 0,
    comprehension: 0,
    focus: 0,
    judgment: 0,
    multitasking: 0,
    endurance: 0,
  };
  
  let counts = { ...sums };
  
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
    if (score.multitasking !== undefined) {
      sums.multitasking += score.multitasking;
      counts.multitasking++;
    }
    if (score.endurance !== undefined) {
      sums.endurance += score.endurance;
      counts.endurance++;
    }
  }
  
  return {
    memory: counts.memory > 0 ? sums.memory / counts.memory : 0,
    comprehension: counts.comprehension > 0 ? sums.comprehension / counts.comprehension : 0,
    focus: counts.focus > 0 ? sums.focus / counts.focus : 0,
    judgment: counts.judgment > 0 ? sums.judgment / counts.judgment : 0,
    multitasking: counts.multitasking > 0 ? sums.multitasking / counts.multitasking : 0,
    endurance: counts.endurance > 0 ? sums.endurance / counts.endurance : 0,
  };
}

/**
 * 표준편차 계산
 */
function calculateSD(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * 브레이니멀 타입 결정
 * 명세서 3.1절 로직
 */
export function determineBrainimalType(scores: MetricsScore[]): {
  type: BrainimalType | null;
  confidence: number;
} {
  // 최근 5회 유효 세션 필요
  if (scores.length < 3) {
    return { type: null, confidence: 0 };
  }
  
  const aggregated = aggregateScores(scores);
  if (!aggregated) {
    return { type: null, confidence: 0 };
  }
  
  // 각 브레이니멀 타입별 점수 계산
  const typeScores: Record<BrainimalType, number> = {} as any;
  
  for (const [type, weights] of Object.entries(BRAINIMAL_WEIGHTS)) {
    const weightedSum =
      (aggregated.memory * weights.memory) +
      (aggregated.comprehension * weights.comprehension) +
      (aggregated.focus * weights.focus) +
      (aggregated.judgment * weights.judgment) +
      (aggregated.multitasking * weights.multitasking) +
      (aggregated.endurance * weights.endurance);
    
    typeScores[type as BrainimalType] = weightedSum;
  }
  
  // 최고점 타입 찾기
  let maxScore = -Infinity;
  let bestType: BrainimalType | null = null;
  
  for (const [type, score] of Object.entries(typeScores)) {
    if (score > maxScore) {
      maxScore = score;
      bestType = type as BrainimalType;
    }
  }
  
  // 신뢰도 계산 (점수 차이 및 데이터 양 기반)
  const allScores = Object.values(typeScores);
  const scoreSD = calculateSD(allScores);
  const dataConfidence = Math.min(100, (scores.length / 5) * 100);
  const separationConfidence = Math.min(100, (scoreSD / 10) * 100);
  const confidence = (dataConfidence * 0.6) + (separationConfidence * 0.4);
  
  // 특수 조건 체크 (Decision Tree Fallback)
  if (bestType) {
    // 균형적인 여우: 전체 평균 65↑ & 표준편차 Low
    const avgScore = (
      aggregated.memory +
      aggregated.comprehension +
      aggregated.focus +
      aggregated.judgment +
      aggregated.multitasking +
      aggregated.endurance
    ) / 6;
    
    const scoreValues = [
      aggregated.memory,
      aggregated.comprehension,
      aggregated.focus,
      aggregated.judgment,
      aggregated.multitasking,
      aggregated.endurance,
    ];
    const sd = calculateSD(scoreValues);
    
    if (avgScore >= 65 && sd < 15) {
      bestType = 'FOX_BALANCED';
    }
  }
  
  return {
    type: bestType,
    confidence: Math.round(confidence),
  };
}
