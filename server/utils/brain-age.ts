import type { MetricsScore } from '@noilink/shared';

/** 클라이언트 `calculateBrainAge`와 동일한 규칙 */
export function computeBrainAge(metricsScore: MetricsScore, actualAge?: number): number {
  const scores = [
    metricsScore.memory,
    metricsScore.comprehension,
    metricsScore.focus,
    metricsScore.judgment,
    metricsScore.agility,
    metricsScore.endurance,
  ].filter((s): s is number => s !== undefined);

  if (scores.length === 0) {
    return actualAge ?? 30;
  }

  const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  let brainAge = Math.round(80 - (avgScore / 100) * 60);

  if (actualAge !== undefined) {
    const diff = brainAge - actualAge;
    if (Math.abs(diff) > 20) {
      brainAge = actualAge + Math.sign(diff) * 10;
    }
  }

  return Math.max(10, Math.min(100, brainAge));
}
