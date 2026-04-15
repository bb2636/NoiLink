/**
 * 점수 계산 로직
 * 기능 명세서 7.2절 알고리즘 구현
 */

import { getNormConfig } from '../init-norm.js';
import type {
  RawMetrics,
  MetricsScore,
  RhythmRawMetrics,
  MemoryRawMetrics,
  ComprehensionRawMetrics,
  FocusRawMetrics,
  JudgmentRawMetrics,
  AgilityRawMetrics,
  EnduranceRawMetrics,
  NormConfig,
} from '@noilink/shared';

/**
 * Z-Score 변환
 */
function calculateZScore(value: number, mu: number, sigma: number): number {
  if (sigma === 0) return 0;
  return (value - mu) / sigma;
}

/**
 * T-Score 변환 (0~100 스케일)
 */
function calculateTScore(zScore: number): number {
  return Math.min(100, Math.max(0, 50 + (zScore * 10)));
}

/**
 * 리듬 Phase 점수 계산
 * 명세서 7.2절 ⓪ 리듬 페이즈 점수
 */
export function calculateRhythmScore(rhythm: RhythmRawMetrics): number {
  const { totalTicks, perfectCount, goodCount, badCount } = rhythm;
  
  if (totalTicks === 0) return 0;
  
  // 정확도 계산
  const accuracy = (
    (perfectCount * 1.0) + 
    (goodCount * 0.5) + 
    (badCount * 0.2)
  ) / totalTicks;
  
  // NormConfig에서 규준 가져오기 (리듬은 별도 규준이 없으므로 기본값 사용)
  // 실제로는 리듬 점수는 정확도 기반으로 직접 계산
  const zScore = calculateZScore(accuracy, 0.8, 0.15); // 기본 규준
  return calculateTScore(zScore);
}

/**
 * 기억력 점수 계산
 * 명세서 7.2절 ① 기억력
 * Note: 리듬 점수 미반영
 */
export async function calculateMemoryScore(
  memory: MemoryRawMetrics,
  rhythm?: RhythmRawMetrics
): Promise<number> {
  const normConfig = await getNormConfig();
  if (!normConfig) {
    throw new Error('NormConfig not found');
  }
  
  const { maxSpan, sequenceAccuracy } = memory;
  const { memory: memoryNorm } = normConfig;
  
  // Z-Score 계산
  const zMaxSpan = calculateZScore(maxSpan, memoryNorm.maxSpan.mu, memoryNorm.maxSpan.sigma);
  const zSeqAcc = calculateZScore(sequenceAccuracy, memoryNorm.sequenceAccuracy.mu, memoryNorm.sequenceAccuracy.sigma);
  
  // 가중 합산 (60% MaxSpan, 40% SequenceAccuracy)
  const zFinal = (zMaxSpan * 0.6) + (zSeqAcc * 0.4);
  
  return calculateTScore(zFinal);
}

/**
 * 이해력 점수 계산
 * 명세서 7.2절 ② 이해력
 * Logic: 인지 과제(80%) + 리듬감(20%)
 */
export async function calculateComprehensionScore(
  comprehension: ComprehensionRawMetrics,
  rhythm?: RhythmRawMetrics
): Promise<number> {
  const normConfig = await getNormConfig();
  if (!normConfig) {
    throw new Error('NormConfig not found');
  }
  
  const { avgReactionTime, learningSlope } = comprehension;
  const { comprehension: compNorm } = normConfig;
  
  // 인지 과제 Z-Score (반응속도는 낮을수록 좋으므로 부호 반전)
  const zRT = -calculateZScore(avgReactionTime, compNorm.reactionTime.mu, compNorm.reactionTime.sigma);
  const zSlope = calculateZScore(learningSlope, compNorm.learningSlope.mu, compNorm.learningSlope.sigma);
  
  // 가중 합산 (50% 반응속도, 50% 학습곡선)
  const zCognitive = (zRT * 0.5) + (zSlope * 0.5);
  
  // 리듬 점수 (20% 비중)
  const rhythmScore = rhythm ? calculateRhythmScore(rhythm) : 0;
  const zRhythm = calculateZScore(rhythmScore / 100, 0.8, 0.15); // 정규화
  
  // 최종 합산 (80% 인지, 20% 리듬)
  const zFinal = (zCognitive * 0.8) + (zRhythm * 0.2);
  
  return calculateTScore(zFinal);
}

/**
 * 집중력 점수 계산
 * 명세서 7.2절 ③ 집중력
 * Logic: 주의 집중(80%) + 리듬감(20%)
 */
export async function calculateFocusScore(
  focus: FocusRawMetrics,
  rhythm?: RhythmRawMetrics
): Promise<number> {
  const normConfig = await getNormConfig();
  if (!normConfig) {
    throw new Error('NormConfig not found');
  }
  
  const { reactionTimeSD, lapseCount } = focus;
  const { focus: focusNorm } = normConfig;
  
  // 인지 과제 Z-Score (낮을수록 좋으므로 부호 반전)
  const zSD = -calculateZScore(reactionTimeSD, focusNorm.reactionTimeSD.mu, focusNorm.reactionTimeSD.sigma);
  const zLapse = -calculateZScore(lapseCount, focusNorm.lapseCount.mu, focusNorm.lapseCount.sigma);
  
  // 가중 합산 (70% 표준편차, 30% 멍때림)
  const zCognitive = (zSD * 0.7) + (zLapse * 0.3);
  
  // 리듬 점수 (20% 비중)
  const rhythmScore = rhythm ? calculateRhythmScore(rhythm) : 0;
  const zRhythm = calculateZScore(rhythmScore / 100, 0.8, 0.15);
  
  // 최종 합산 (80% 인지, 20% 리듬)
  const zFinal = (zCognitive * 0.8) + (zRhythm * 0.2);
  
  return calculateTScore(zFinal);
}

/**
 * 판단력 점수 계산
 * 명세서 7.2절 ④ 판단력
 * Logic: 충동 억제(80%) + 리듬감(20%)
 */
export async function calculateJudgmentScore(
  judgment: JudgmentRawMetrics,
  rhythm?: RhythmRawMetrics
): Promise<number> {
  const normConfig = await getNormConfig();
  if (!normConfig) {
    throw new Error('NormConfig not found');
  }
  
  const { noGoSuccessRate, avgGoReactionTime } = judgment;
  const { judgment: judgeNorm } = normConfig;
  
  // 인지 과제 Z-Score
  const zNoGo = calculateZScore(noGoSuccessRate, judgeNorm.noGoAccuracy.mu, judgeNorm.noGoAccuracy.sigma);
  const zGoRT = -calculateZScore(avgGoReactionTime, judgeNorm.goReactionTime.mu, judgeNorm.goReactionTime.sigma);
  
  // 가중 합산 (80% 억제, 20% GO 속도)
  const zCognitive = (zNoGo * 0.8) + (zGoRT * 0.2);
  
  // 리듬 점수 (20% 비중)
  const rhythmScore = rhythm ? calculateRhythmScore(rhythm) : 0;
  const zRhythm = calculateZScore(rhythmScore / 100, 0.8, 0.15);
  
  // 최종 합산 (80% 인지, 20% 리듬)
  const zFinal = (zCognitive * 0.8) + (zRhythm * 0.2);
  
  return calculateTScore(zFinal);
}

/**
 * 순발력 점수 계산
 * 명세서 7.2절 ⑤ 순발력 (기존 멀티태스킹)
 * Logic: 전환 능력(80%) + 리듬감(20%)
 */
export async function calculateAgilityScore(
  agility: AgilityRawMetrics,
  rhythm?: RhythmRawMetrics
): Promise<number> {
  const normConfig = await getNormConfig();
  if (!normConfig) {
    throw new Error('NormConfig not found');
  }
  
  const { switchCost, footAccuracy } = agility;
  const { agility: agilityNorm } = normConfig;

  // 명세 7.2 ⑤: Z_cognitive = (Z_inv(Cost) * 0.7) + (Z(ACC_switch) * 0.3)
  const zCost = -calculateZScore(switchCost, agilityNorm.switchCost.mu, agilityNorm.switchCost.sigma);
  const zAcc = calculateZScore(footAccuracy, agilityNorm.switchAccuracy.mu, agilityNorm.switchAccuracy.sigma);
  const zCognitive = zCost * 0.7 + zAcc * 0.3;
  
  // 리듬 점수 (20% 비중)
  const rhythmScore = rhythm ? calculateRhythmScore(rhythm) : 0;
  const zRhythm = calculateZScore(rhythmScore / 100, 0.8, 0.15);
  
  // 최종 합산 (80% 인지, 20% 리듬)
  const zFinal = (zCognitive * 0.8) + (zRhythm * 0.2);
  
  return calculateTScore(zFinal);
}

/**
 * 지구력 점수 계산
 * 명세서 7.2절 ⑥ 지구력
 * Logic: 유지력(80%) + 리듬감(20%)
 */
export async function calculateEnduranceScore(
  endurance: EnduranceRawMetrics,
  rhythm?: RhythmRawMetrics
): Promise<number> {
  const normConfig = await getNormConfig();
  if (!normConfig) {
    throw new Error('NormConfig not found');
  }
  
  const { maintainRatio } = endurance;
  const { endurance: endNorm } = normConfig;
  
  // 인지 과제 Z-Score (유지비율은 높을수록 좋음)
  const zRatio = calculateZScore(maintainRatio, endNorm.maintainRatio.mu, endNorm.maintainRatio.sigma);
  
  // 리듬 점수 (20% 비중)
  const rhythmScore = rhythm ? calculateRhythmScore(rhythm) : 0;
  const zRhythm = calculateZScore(rhythmScore / 100, 0.8, 0.15);
  
  // 최종 합산 (80% 인지, 20% 리듬)
  const zFinal = (zRatio * 0.8) + (zRhythm * 0.2);
  
  return calculateTScore(zFinal);
}

/**
 * 전체 메트릭 점수 계산
 * RawMetrics를 기반으로 6대 지표 점수 산출
 */
export async function calculateAllMetrics(rawMetrics: RawMetrics): Promise<MetricsScore> {
  const rhythm = rawMetrics.rhythm;
  
  const scores: MetricsScore = {
    sessionId: rawMetrics.sessionId,
    userId: rawMetrics.userId,
    createdAt: new Date().toISOString(),
  };
  
  // 리듬 점수 (공통)
  if (rhythm) {
    scores.rhythm = calculateRhythmScore(rhythm);
  }
  
  // 기억력
  if (rawMetrics.memory) {
    scores.memory = await calculateMemoryScore(rawMetrics.memory, rhythm);
  }
  
  // 이해력
  if (rawMetrics.comprehension) {
    scores.comprehension = await calculateComprehensionScore(rawMetrics.comprehension, rhythm);
  }
  
  // 집중력
  if (rawMetrics.focus) {
    scores.focus = await calculateFocusScore(rawMetrics.focus, rhythm);
  }
  
  // 판단력
  if (rawMetrics.judgment) {
    scores.judgment = await calculateJudgmentScore(rawMetrics.judgment, rhythm);
  }
  
  // 순발력 (기존 멀티태스킹)
  if (rawMetrics.agility) {
    scores.agility = await calculateAgilityScore(rawMetrics.agility, rhythm);
  }
  
  // 지구력
  if (rawMetrics.endurance) {
    scores.endurance = await calculateEnduranceScore(rawMetrics.endurance, rhythm);
  }
  
  return scores;
}
