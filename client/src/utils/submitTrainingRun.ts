import type { Level, MetricsScore, RawMetrics, TrainingMode } from '@noilink/shared';
import {
  buildSyntheticRawMetrics,
  buildTrainingPhases,
  inferQualityFromTaps,
} from '@noilink/shared';
import api from './api';

function avgMetricScore(m: MetricsScore): number | undefined {
  const vals = [
    m.memory,
    m.comprehension,
    m.focus,
    m.judgment,
    m.agility,
    m.endurance,
  ].filter((v): v is number => typeof v === 'number');
  if (vals.length === 0) return undefined;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * 세션 저장 → (점수 모드) 원시 메트릭 산출·저장 → 서버가 세션 score·리포트 갱신
 *
 * `engineMetrics` 가 있으면 게임 엔진이 실제 측정한 값으로 제출,
 * 없으면 종전처럼 합성 값으로 제출(자유 모드/엔진 미사용 케이스용).
 */
export async function submitCompletedTraining(input: {
  userId: string;
  mode: TrainingMode;
  bpm: number;
  level: Level;
  totalDurationSec: number;
  yieldsScore: boolean;
  isComposite: boolean;
  tapCount: number;
  /** 게임 엔진이 산출한 실제 원시 메트릭(있으면 우선) */
  engineMetrics?: Omit<RawMetrics, 'sessionId' | 'userId'>;
}): Promise<{ sessionId: string; displayScore?: number; error?: string }> {
  const durationMs = input.totalDurationSec * 1000;
  const q = inferQualityFromTaps(input.tapCount, input.totalDurationSec);
  const phases = buildTrainingPhases({
    totalDurationMs: durationMs,
    bpm: input.bpm,
    level: input.level,
    mode: input.mode,
    isComposite: input.isComposite,
    quality: q,
  });

  const sessionRes = await api.createSession({
    userId: input.userId,
    mode: input.mode,
    bpm: input.bpm,
    level: input.level,
    duration: durationMs,
    isComposite: input.mode === 'COMPOSITE' || input.isComposite,
    isValid: true,
    phases,
  });

  if (!sessionRes.success || !sessionRes.data?.id) {
    return {
      sessionId: '',
      error: sessionRes.error || '세션 저장 실패',
    };
  }

  const sessionId = sessionRes.data.id as string;

  if (!input.yieldsScore || input.mode === 'FREE') {
    return { sessionId };
  }

  const raw: RawMetrics = input.engineMetrics
    ? { ...input.engineMetrics, sessionId, userId: input.userId }
    : buildSyntheticRawMetrics({ sessionId, userId: input.userId, quality: q });
  const calcRes = await api.calculateMetrics(raw);
  if (!calcRes.success || !calcRes.data) {
    return {
      sessionId,
      error: calcRes.error || '지표 계산 실패',
    };
  }

  return {
    sessionId,
    displayScore: avgMetricScore(calcRes.data as MetricsScore),
  };
}
