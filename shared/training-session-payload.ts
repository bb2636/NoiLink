/**
 * 트레이닝 종료 후 서버 제출용 — 세션 Phase·RawMetrics(합성 품질 기반 합성 원시)
 * 실제 기기 연동 전까지 품질(q)은 터치·시간 등에서 유도한다.
 */

import type {
  Level,
  PhaseMeta,
  PhaseType,
  RawMetrics,
  RhythmRawMetrics,
  TrainingMode,
} from './types.js';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** 터치 수·진행 초로 대략적 수행 품질 0.25~1 */
export function inferQualityFromTaps(tapCount: number, durationSec: number): number {
  if (durationSec <= 0) return 0.5;
  const rate = tapCount / durationSec;
  const q = 0.35 + rate * 0.9;
  return clamp(q, 0.25, 1);
}

function rhythmBlock(q: number): RhythmRawMetrics {
  const totalTicks = 48;
  const perfect = Math.round(totalTicks * q * 0.42);
  const good = Math.round(totalTicks * q * 0.28);
  const bad = Math.max(0, Math.round(totalTicks * 0.15 * (1 - q * 0.5)));
  const miss = Math.max(0, totalTicks - perfect - good - bad);
  const acc = (perfect * 1 + good * 0.5 + bad * 0.2) / totalTicks;
  return {
    totalTicks,
    perfectCount: perfect,
    goodCount: good,
    badCount: bad,
    missCount: miss,
    accuracy: clamp(acc, 0, 1),
    avgOffset: Math.round(140 - q * 90),
    offsetSD: Math.round(70 - q * 45),
  };
}

export function buildSyntheticRawMetrics(input: {
  sessionId: string;
  userId: string;
  quality: number;
}): RawMetrics {
  const q = clamp(input.quality, 0.2, 1);
  const rhythm = rhythmBlock(q);

  return {
    sessionId: input.sessionId,
    userId: input.userId,
    touchCount: Math.round(30 + q * 120),
    hitCount: Math.round(25 + q * 100),
    rtMean: Math.round(720 - q * 380),
    rtSD: Math.round(130 - q * 70),
    createdAt: new Date().toISOString(),
    rhythm,
    memory: {
      maxSpan: Math.round(3 + q * 4),
      sequenceAccuracy: clamp(0.45 + q * 0.5, 0, 1),
      perfectRecallRate: clamp(0.4 + q * 0.55, 0, 1),
      avgReactionTime: Math.round(820 - q * 420),
    },
    comprehension: {
      avgReactionTime: Math.round(780 - q * 360),
      switchCost: Math.round(420 - q * 280),
      switchErrorRate: clamp(0.35 - q * 0.28, 0.02, 1),
      learningSlope: Math.round(-70 + q * 55),
      ruleAccuracy: clamp(0.5 + q * 0.45, 0, 1),
    },
    focus: {
      targetHitRate: clamp(0.48 + q * 0.48, 0, 1),
      commissionErrorRate: clamp(0.32 - q * 0.26, 0.02, 1),
      omissionErrorRate: clamp(0.28 - q * 0.22, 0.02, 1),
      avgReactionTime: Math.round(700 - q * 320),
      reactionTimeSD: Math.round(140 - q * 75),
      lapseCount: Math.max(0, Math.round(2.8 - q * 2.2)),
    },
    judgment: {
      noGoSuccessRate: clamp(0.55 + q * 0.42, 0, 1),
      goSuccessRate: clamp(0.52 + q * 0.45, 0, 1),
      doubleTapSuccessRate: clamp(0.48 + q * 0.48, 0, 1),
      avgGoReactionTime: Math.round(620 - q * 280),
      reactionTimeSD: Math.round(95 - q * 45),
      impulseCount: Math.max(0, Math.round(4 - q * 3.5)),
    },
    agility: {
      footAccuracy: clamp(0.5 + q * 0.45, 0, 1),
      anchorOmissionRate: clamp(0.28 - q * 0.22, 0.02, 1),
      simultaneousSuccessRate: clamp(0.45 + q * 0.5, 0, 1),
      switchCost: Math.round(380 - q * 260),
      syncError: Math.round(110 - q * 65),
      reactionTime: Math.round(480 - q * 220),
    },
    endurance: {
      earlyScore: Math.round(58 + q * 38),
      midScore: Math.round(55 + q * 36),
      lateScore: Math.round(52 + q * 40),
      maintainRatio: clamp(0.85 + q * 0.28, 0.3, 2),
      drift: clamp(0.22 - q * 0.18, 0, 1),
      earlyReactionTime: Math.round(640 - q * 300),
      lateReactionTime: Math.round(720 - q * 280),
      omissionIncrease: clamp(0.25 - q * 0.2, 0, 1),
    },
  };
}

export function buildTrainingPhases(input: {
  totalDurationMs: number;
  bpm: number;
  level: Level;
  mode: TrainingMode;
  isComposite: boolean;
  /** 0.25~1, 세션 종료 시점 품질 */
  quality: number;
}): PhaseMeta[] {
  const { totalDurationMs, bpm, level, mode, isComposite, quality } = input;
  const q = clamp(quality, 0.25, 1);
  const half = Math.floor(totalDurationMs / 2);
  const rhythmDur = isComposite ? Math.min(30_000, half) : Math.min(20_000, Math.floor(totalDurationMs * 0.35));
  const cogDur = Math.max(0, totalDurationMs - rhythmDur);
  const durSec = (d: number) => Math.max(1, d / 1000);

  const base = (type: PhaseType, start: number, dur: number, cognitiveMode?: TrainingMode): PhaseMeta => ({
    type,
    startTime: start,
    endTime: start + dur,
    duration: dur,
    mode: type === 'COGNITIVE' ? cognitiveMode ?? mode : undefined,
    bpm,
    level,
    tickCount: Math.max(1, Math.floor(dur / 1000)),
    hitCount: Math.max(
      0,
      Math.floor(durSec(dur) * (0.55 + q * 0.38))
    ),
    missCount: 0,
    rhythmScore: type === 'RHYTHM' ? Math.round(50 + q * 45) : undefined,
    rhythmGrades: { PERFECT: 4, GOOD: 8, BAD: 3, MISS: 1 },
  });

  if (isComposite && cogDur > 0) {
    return [
      base('RHYTHM', 0, rhythmDur),
      base('COGNITIVE', rhythmDur, cogDur, mode),
    ];
  }
  return [base('COGNITIVE', 0, totalDurationMs, mode)];
}
