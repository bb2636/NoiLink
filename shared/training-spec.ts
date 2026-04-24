/**
 * 트레이닝 엔진 명세 (측정 지표, 공통 정책, 모드별 산식, 종합·자유 모드)
 * — UI/서버/기기 로직이 동일 기준을 참조하도록 단일 소스로 유지한다.
 */

import type { Level, LogicColor, HardwareColor, PhaseType, TrainingMode } from './types.js';

// =============================================================================
// 0. 측정 지표 (Metrics & Data) — 용어 정의
// =============================================================================

/** 명세의 핵심 원시·파생 지표 키 */
export type CoreMetricId =
  | 'RT'
  | 'RT_SD'
  | 'COMMISSION'
  | 'OMISSION'
  | 'DRIFT'
  | 'SWITCH_COST'
  | 'NORM';

/** 분석·유저: Brainimal 12유형은 types.BrainimalType, Streak/Confidence는 User 필드와 리포트에 반영 */

/** 자극 on → 입력까지 (ms) */
export function reactionTimeMs(tOnMs: number, tInputMs: number): number {
  return Math.max(0, tInputMs - tOnMs);
}

/** 드리프트: 초반 대비 후반 반응 지연율 (0~1+, 명세 ENDURANCE) */
export function driftRatio(earlyRtMean: number, lateRtMean: number): number {
  if (earlyRtMean <= 0) return 0;
  return (lateRtMean - earlyRtMean) / earlyRtMean;
}

/** 전환 비용: 규칙 변경 후 첫 정답까지 지연(ms) — COMPREHENSION/멀티태스킹 */
export type SwitchCostSample = { ruleChangedAtMs: number; firstCorrectAtMs: number };

export function switchCostMs(sample: SwitchCostSample): number {
  return Math.max(0, sample.firstCorrectAtMs - sample.ruleChangedAtMs);
}

/** Norm: 원시값 → 0~1 정규화(낮을수록 좋은 지표용) */
export function normLowerIsBetter(raw: number, mu: number, sigma: number): number {
  if (sigma <= 0) return 0.5;
  const z = (raw - mu) / sigma;
  return clamp01(0.5 - 0.15 * z);
}

/** Norm: 원시값 → 0~1 정규화(높을수록 좋은 지표용) */
export function normHigherIsBetter(raw: number, mu: number, sigma: number): number {
  if (sigma <= 0) return 0.5;
  const z = (raw - mu) / sigma;
  return clamp01(0.5 + 0.15 * z);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// =============================================================================
// 1. 공통 정책
// =============================================================================

/** 세션 최대 길이 (ms) — 종합 5분(300s) 기준 자동 종료 */
export const SESSION_MAX_MS = 300_000;

/** 종합 트레이닝 총 시간 (300s = 5분, 기획서 v2.0) */
export const COMPOSITE_TOTAL_MS = 300_000;

/** 리듬 페이즈 길이 (30s × 5사이클 = 150s) */
export const RHYTHM_PHASE_MS = 30_000;

/** 인지 페이즈 길이 (30s × 5사이클 = 150s) */
export const COGNITIVE_PHASE_MS = 30_000;

/**
 * 의미 색 → 물리 LED 매핑 (명세 2.1)
 * GREEN, RED, BLUE, YELLOW, WHITE → G, R, B, RG, RGB
 */
export const LOGIC_TO_HARDWARE_COLOR: Record<LogicColor, HardwareColor> = {
  GREEN: 'G',
  RED: 'R',
  BLUE: 'B',
  YELLOW: 'RG',
  WHITE: 'RGB',
};

/** 레벨별 혼합색 사용률: Lv1 0% ~ Lv5 35% */
export function mixedColorRateForLevel(level: Level): number {
  return ((level - 1) / 4) * 0.35;
}

/** 난이도에 따른 점등 지속시간(ms) — 기획 튜닝 값(명세 범위 내에서 조정) */
export function defaultOnMsForLevel(level: Level): number {
  const table: Record<Level, number> = { 1: 520, 2: 480, 3: 440, 4: 400, 5: 360 };
  return table[level];
}

/** 박당 ms (BPM 기준) */
export function beatMs(bpm: number): number {
  return 60000 / Math.max(40, bpm);
}

/** 판단력(GO/NO-GO/더블탭): 더블탭 유효 윈도우 = min(700ms, 0.9*beat_ms) */
export function judgmentDoubleTapWindowMs(bpm: number): number {
  return Math.min(700, 0.9 * beatMs(bpm));
}

/** 리듬 패턴 변종 (명세 2.1 리듬 페이즈) */
export type RhythmPatternKind =
  | 'L1_4_4_SEQUENTIAL_LAST'
  | 'L2_4_4_SEQUENTIAL_LAST'
  | 'L3_2_4_SEQUENTIAL'
  | 'L4_2_4_EXTRA_8TH_P2P3'
  | 'L5_2_4_EXTRA_8TH_P0P1_P2P3';

export function rhythmPatternForLevel(level: Level): RhythmPatternKind {
  if (level <= 1) return 'L1_4_4_SEQUENTIAL_LAST';
  if (level === 2) return 'L2_4_4_SEQUENTIAL_LAST';
  if (level === 3) return 'L3_2_4_SEQUENTIAL';
  if (level === 4) return 'L4_2_4_EXTRA_8TH_P2P3';
  return 'L5_2_4_EXTRA_8TH_P0P1_P2P3';
}

/**
 * 한 박(beat) 안에서 점등할 Pod 시퀀스.
 * - tickIndex: 페이즈 시작부터 0,1,2…
 * - 반환: 각 step은 동시에 점등할 Pod id 배열, offsetRatio는 박자 안에서의 시작 시점(0=정박, 0.5=8분 뒷박)
 * 모든 step은 isTarget=true 이며 클라이언트가 점등 → BLE LED 송신을 함께 한다.
 */
export interface RhythmStep {
  pods: number[];
  /** beat 길이 대비 시작 시점 (0.0 ~ 1.0). 0.5는 8분 뒷박 */
  offsetRatio: number;
}

export function rhythmStepsForBeat(level: Level, tickIndex: number): RhythmStep[] {
  const kind = rhythmPatternForLevel(level);
  switch (kind) {
    case 'L1_4_4_SEQUENTIAL_LAST':
    case 'L2_4_4_SEQUENTIAL_LAST': {
      // 4/4 순차: P0→P1→P2→P3, 마지막(P3) 박은 강조(타겟 동일하나 UI에서 강조 가능)
      const pod = tickIndex % 4;
      return [{ pods: [pod], offsetRatio: 0 }];
    }
    case 'L3_2_4_SEQUENTIAL': {
      // 2/4 순차: P0→P1 반복 (혹은 P2→P3 교대) — 4박 중 2박만 점등
      const pos = tickIndex % 4;
      if (pos === 0) return [{ pods: [0], offsetRatio: 0 }];
      if (pos === 2) return [{ pods: [1], offsetRatio: 0 }];
      return [];
    }
    case 'L4_2_4_EXTRA_8TH_P2P3': {
      // 2/4 + 8분 뒷박에 P2,P3 추가 (각 박마다)
      const pos = tickIndex % 4;
      if (pos === 0) return [
        { pods: [0], offsetRatio: 0 },
        { pods: [2], offsetRatio: 0.5 },
      ];
      if (pos === 2) return [
        { pods: [1], offsetRatio: 0 },
        { pods: [3], offsetRatio: 0.5 },
      ];
      return [];
    }
    case 'L5_2_4_EXTRA_8TH_P0P1_P2P3': {
      // 2/4 + 8분 뒷박: P0/P1 또는 P2/P3 동시 점등
      const pos = tickIndex % 4;
      if (pos === 0) return [
        { pods: [0, 1], offsetRatio: 0 },
        { pods: [2, 3], offsetRatio: 0.5 },
      ];
      if (pos === 2) return [
        { pods: [2, 3], offsetRatio: 0 },
        { pods: [0, 1], offsetRatio: 0.5 },
      ];
      return [];
    }
  }
}

// =============================================================================
// 2. 자동 난이도 (Auto-Setup)
// =============================================================================

export interface SessionSuggestionInput {
  previousScore: number;
  currentBpm: number;
  currentLevel: Level;
}

export interface SessionSuggestionResult {
  suggestedBpm: number;
  suggestedLevel: Level;
  bpmDelta: number;
  levelDelta: number;
  reason: string;
}

const BPM_MIN = 60;
const BPM_MAX = 200;

/**
 * 직전 세션 점수 기반 BPM·레벨 제안 (80↑: BPM+5, L+1 / 60↓: BPM-5)
 * 사용자는 시작 전 수동으로 수정 가능.
 */
export function suggestNextSessionParams(input: SessionSuggestionInput): SessionSuggestionResult {
  let bpmDelta = 0;
  let levelDelta = 0;
  let reason = '직전 성과가 중간 구간입니다. 현재 설정을 유지해 보세요.';

  if (input.previousScore >= 80) {
    bpmDelta = 5;
    levelDelta = 1;
    reason = '직전 세션 우수(80점 이상): BPM +5, 레벨 +1 제안.';
  } else if (input.previousScore < 60) {
    bpmDelta = -5;
    reason = '직전 세션 보완 필요(60점 미만): BPM -5 제안.';
  }

  const suggestedBpm = clamp(input.currentBpm + bpmDelta, BPM_MIN, BPM_MAX);
  const suggestedLevel = clampLevel((input.currentLevel + levelDelta) as number);

  return {
    suggestedBpm,
    suggestedLevel,
    bpmDelta,
    levelDelta,
    reason,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function clampLevel(n: number): Level {
  return clamp(Math.round(n), 1, 5) as Level;
}

// =============================================================================
// 3. 점수 산식 (모드별) — norm 항은 μ, σ를 넘겨 튜닝
// =============================================================================

export interface MemoryScoreInput {
  sequenceAccuracy: number;
  perfectRecallRate: number;
  avgReactionTime: number;
  rtNormMu: number;
  rtNormSigma: number;
}

export function scoreMemory(i: MemoryScoreInput): number {
  const nRt = normLowerIsBetter(i.avgReactionTime, i.rtNormMu, i.rtNormSigma);
  return (
    60 * i.sequenceAccuracy +
    25 * i.perfectRecallRate +
    10 * (1 - nRt)
  );
}

export interface ComprehensionScoreInput {
  ruleAccuracy: number;
  switchCostMs: number;
  switchCostNormMu: number;
  switchCostNormSigma: number;
  switchErrorRate: number;
  learningCurve01: number;
}

export function scoreComprehension(i: ComprehensionScoreInput): number {
  const nSwitch = normLowerIsBetter(i.switchCostMs, i.switchCostNormMu, i.switchCostNormSigma);
  return (
    40 * i.ruleAccuracy +
    35 * (1 - nSwitch) +
    15 * (1 - i.switchErrorRate) +
    10 * i.learningCurve01
  );
}

export interface FocusScoreInput {
  targetHitRate: number;
  commissionErrorRate: number;
  omissionErrorRate: number;
  avgReactionTime: number;
  reactionTimeSD: number;
  rtNormMu: number;
  rtNormSigma: number;
  rtSdNormMu: number;
  rtSdNormSigma: number;
}

export function scoreFocus(i: FocusScoreInput): number {
  const nRt = normLowerIsBetter(i.avgReactionTime, i.rtNormMu, i.rtNormSigma);
  const nSd = normLowerIsBetter(i.reactionTimeSD, i.rtSdNormMu, i.rtSdNormSigma);
  return (
    35 * i.targetHitRate +
    25 * (1 - i.commissionErrorRate) +
    20 * (1 - i.omissionErrorRate) +
    10 * (1 - nRt) +
    10 * (1 - nSd)
  );
}

export type JudgmentProfile = 'DEFAULT' | 'IMPULSE' | 'INDECISIVE';

export interface JudgmentScoreInput {
  noGoSuccessRate: number;
  goSuccessRate: number;
  doubleTapSuccessRate: number;
  avgReactionTime: number;
  reactionTimeSD: number;
  rtNormMu: number;
  rtNormSigma: number;
  rtSdNormMu: number;
  rtSdNormSigma: number;
  profile?: JudgmentProfile;
}

/** 충동형 0.85, 우유부단형 0.90 보정 */
export function scoreJudgment(i: JudgmentScoreInput): number {
  let s =
    45 * i.noGoSuccessRate +
    25 * i.goSuccessRate +
    15 * i.doubleTapSuccessRate +
    10 * (1 - normLowerIsBetter(i.avgReactionTime, i.rtNormMu, i.rtNormSigma)) +
    5 * (1 - normLowerIsBetter(i.reactionTimeSD, i.rtSdNormMu, i.rtSdNormSigma));

  if (i.profile === 'IMPULSE') s *= 0.85;
  if (i.profile === 'INDECISIVE') s *= 0.9;
  return s;
}

export interface EnduranceScoreInput {
  maintainRatio: number;
  drift01: number;
  omissionIncrease01: number;
  lateStability01: number;
  lateSpeed01: number;
}

export function scoreEndurance(i: EnduranceScoreInput): number {
  return (
    40 * i.maintainRatio +
    20 * (1 - clamp01(i.drift01)) +
    15 * (1 - clamp01(i.omissionIncrease01)) +
    15 * i.lateStability01 +
    10 * i.lateSpeed01
  );
}

export interface AgilityScoreInput {
  footAccuracy: number;
  anchorOmissionRate: number;
  simultaneousSuccessRate: number;
  switchCostMs: number;
  syncErrorMs: number;
  switchNormMu: number;
  switchNormSigma: number;
  syncNormMu: number;
  syncNormSigma: number;
}

/** 명세 F: 멀티태스킹 (API 모드명은 AGILITY 유지) */
export function scoreAgilityMultitasking(i: AgilityScoreInput): number {
  const nSw = normLowerIsBetter(i.switchCostMs, i.switchNormMu, i.switchNormSigma);
  const nSync = normLowerIsBetter(i.syncErrorMs, i.syncNormMu, i.syncNormSigma);
  return (
    30 * i.footAccuracy +
    20 * (1 - i.anchorOmissionRate) +
    20 * i.simultaneousSuccessRate +
    10 * (1 - nSw) +
    10 * (1 - nSync)
  );
}

// =============================================================================
// 4. 종합 트레이닝 Phase 시퀀스
// =============================================================================

export interface PlannedPhase {
  type: PhaseType;
  durationMs: number;
  /** COGNITIVE일 때 수행할 인지 과제 모드 */
  cognitiveMode?: TrainingMode;
}

const COGNITIVE_MODES: TrainingMode[] = [
  'MEMORY',
  'COMPREHENSION',
  'FOCUS',
  'JUDGMENT',
  'AGILITY',
  'ENDURANCE',
];

/**
 * 300초: Rhythm(30s) ↔ Cognitive(30s) 교차, 5사이클.
 * 각 인지 페이즈는 6대 과제 중 하나를 무작위 배정(시드 가능).
 */
export function buildCompositePhasePlan(seed = Date.now()): PlannedPhase[] {
  const rng = mulberry32(seed);
  const phases: PlannedPhase[] = [];
  for (let c = 0; c < 5; c++) {
    phases.push({ type: 'RHYTHM', durationMs: RHYTHM_PHASE_MS });
    const cognitiveMode = COGNITIVE_MODES[Math.floor(rng() * COGNITIVE_MODES.length)];
    phases.push({
      type: 'COGNITIVE',
      durationMs: COGNITIVE_PHASE_MS,
      cognitiveMode,
    });
  }
  return phases;
}

function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// 5. 지구력 구간 (종합 모드 Early/Mid/Late)
// =============================================================================

export const ENDURANCE_EARLY_START_MS = 0;
export const ENDURANCE_EARLY_END_MS = 100_000;
export const ENDURANCE_LATE_START_MS = 200_000;
export const ENDURANCE_LATE_END_MS = 300_000;

/** Maintain = Late점수 / Early점수, Drift = (Late_RT - Early_RT) / Early_RT */
export function maintainRatio(earlyScore: number, lateScore: number): number {
  if (earlyScore <= 0) return 0;
  return lateScore / earlyScore;
}

// =============================================================================
// 6. 자유 트레이닝 (측정·랭킹만)
// =============================================================================

export type FreeSequenceStyle = 'BLAZEPOD_LIKE_SEQUENCE';

export interface FreeTrainingSettings {
  selectedPodIds: string[];
  sequenceStyle: FreeSequenceStyle;
  /** 단색 또는 멀티 컬러 시퀀스 */
  palette: LogicColor[];
  /** null 이면 무제한 타이머 */
  timeLimitMs: number | null;
}

/** 자유 모드는 점수 산출 없음; 합계 시간·스트릭에만 반영 */
export function freeModeYieldsScore(): boolean {
  return false;
}

// =============================================================================
// 7. 트레이닝 카탈로그 (앱 목록 공통 메타)
// =============================================================================

export type TrainingCatalogId =
  | 'COMPOSITE'
  | 'MEMORY'
  | 'COMPREHENSION'
  | 'FOCUS'
  | 'JUDGMENT'
  | 'AGILITY'
  | 'ENDURANCE'
  | 'RANDOM'
  | 'FREE';

export interface TrainingCatalogEntry {
  id: TrainingCatalogId;
  title: string;
  desc: string;
  apiMode: TrainingMode;
  /** UI/라우팅 분류 */
  kind: 'composite' | 'cognitive' | 'agility' | 'endurance' | 'aux' | 'free';
}

export const TRAINING_CATALOG: readonly TrainingCatalogEntry[] = [
  {
    id: 'COMPOSITE',
    title: '종합 트레이닝',
    desc: '리듬·인지 페이즈 교차(300초). 6대 지표를 순환합니다.',
    apiMode: 'COMPOSITE',
    kind: 'composite',
  },
  {
    id: 'MEMORY',
    title: '기억력',
    desc: 'Show → Recall 순서 기억. 점수: 순서·재현·반응속도.',
    apiMode: 'MEMORY',
    kind: 'cognitive',
  },
  {
    id: 'COMPREHENSION',
    title: '이해력',
    desc: '규칙 전환(초록↔파랑) 적응. 전환 비용·오류·학습곡선 반영.',
    apiMode: 'COMPREHENSION',
    kind: 'cognitive',
  },
  {
    id: 'FOCUS',
    title: '집중력',
    desc: '방해 자극 속 타겟(BLUE)만 선택. Commission / Omission 반영.',
    apiMode: 'FOCUS',
    kind: 'cognitive',
  },
  {
    id: 'JUDGMENT',
    title: '판단력',
    desc: 'GO / NO-GO / DOUBLE TAP. 더블탭 윈도우는 BPM 연동.',
    apiMode: 'JUDGMENT',
    kind: 'cognitive',
  },
  {
    id: 'AGILITY',
    title: '멀티태스킹',
    desc: '손·발 채널 동시 수행. API 모드 AGILITY(순발/멀티).',
    apiMode: 'AGILITY',
    kind: 'agility',
  },
  {
    id: 'ENDURANCE',
    title: '지구력',
    desc: '수행 유지·Drift·구간(Early/Mid/Late) 분석.',
    apiMode: 'ENDURANCE',
    kind: 'endurance',
  },
  {
    id: 'RANDOM',
    title: '랜덤',
    desc: '가변 난이도·자극 패턴(순발·적응 중심).',
    apiMode: 'AGILITY',
    kind: 'aux',
  },
  {
    id: 'FREE',
    title: '자유 트레이닝',
    desc: '규칙·점수 없이 연습. 합계 시간·스트릭에만 반영.',
    apiMode: 'FREE',
    kind: 'free',
  },
] as const;

export const trainingCatalogById = Object.fromEntries(
  TRAINING_CATALOG.map((e) => [e.id, e])
) as Record<TrainingCatalogId, TrainingCatalogEntry>;

/** 멀티태스킹 표기 ↔ API */
export const MULTITASKING_API_MODE: TrainingMode = 'AGILITY';
