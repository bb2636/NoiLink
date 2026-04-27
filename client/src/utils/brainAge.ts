/**
 * 뇌지컬 나이 계산 유틸리티
 * 6대 지표 점수를 기반으로 뇌지컬 나이를 계산
 */

import type { MetricsScore } from '@noilink/shared';

/**
 * 뇌지컬 나이 계산
 * 6대 지표의 평균 점수를 기반으로 나이를 역산
 * 
 * @param metricsScore 6대 지표 점수
 * @param actualAge 실제 나이 (선택사항)
 * @returns 뇌지컬 나이
 */
export function calculateBrainAge(
  metricsScore: MetricsScore,
  actualAge?: number
): number {
  const scores = [
    metricsScore.memory,
    metricsScore.comprehension,
    metricsScore.focus,
    metricsScore.judgment,
    metricsScore.agility,
    metricsScore.endurance,
  ].filter((s): s is number => s !== undefined);

  if (scores.length === 0) {
    return actualAge || 30; // 기본값
  }

  const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

  // 점수를 나이로 변환 (100점 = 20세, 0점 = 80세)
  // 선형 변환: age = 80 - (score / 100) * 60
  const brainAge = Math.round(80 - (avgScore / 100) * 60);

  // 실제 나이가 있으면 보정
  if (actualAge) {
    const diff = brainAge - actualAge;
    // 차이가 크면 실제 나이에 더 가깝게 조정
    if (Math.abs(diff) > 20) {
      return actualAge + Math.sign(diff) * 10;
    }
  }

  return Math.max(10, Math.min(100, brainAge)); // 10~100세 범위 제한
}

