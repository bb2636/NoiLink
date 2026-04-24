/**
 * 가상 Pod 트레이닝 엔진
 *
 * - BPM 기반 tick 스케줄러
 * - 4개 가상 Pod의 점등/판정/입력 캡처
 * - 6대 모드 + RHYTHM 페이즈 + 종합(Composite) 5사이클 교차
 * - 종료 시 RawMetrics(서버 점수 산출 입력) 산출
 *
 * 본 파일은 명세서(2.2) 룰에 충실하게 단순화·테스트 가능 하도록 구현.
 * 점등 구조와 판정 결과만 캡처하면 6대 지표 모두 산출 가능.
 */

import type {
  Level,
  RawMetrics,
  TrainingMode,
} from '@noilink/shared';
import {
  COMPOSITE_TOTAL_MS,
  COGNITIVE_PHASE_MS,
  CTRL_START,
  CTRL_STOP,
  RHYTHM_PHASE_MS,
  SESSION_PHASE_COGNITIVE,
  SESSION_PHASE_RHYTHM,
  judgeRhythmError,
  logicColorToCode,
  rhythmStepsForBeat,
} from '@noilink/shared';
import { bleWriteControl, bleWriteLed, bleWriteSession } from '../native/bleBridge';

// ─────────────────────────────────────────────────────────────────────
// 색상/Pod 상태
// ─────────────────────────────────────────────────────────────────────

export type LogicColor = 'GREEN' | 'RED' | 'BLUE' | 'YELLOW' | 'WHITE';
export type PodFill = LogicColor | 'OFF';

export interface PodState {
  id: number;
  fill: PodFill;
  /** 입력을 받아야 하는 타겟 여부 (UI 글로우 강조용) */
  isTarget: boolean;
  /** 점등 시각 (RT 계산용) */
  litAt: number | null;
  /** 입력 마감 시각 */
  expiresAt: number | null;
  /** 현재 점등을 식별하는 monotonic id — BLE TOUCH/UI 입력 중복 처리 방지 */
  tickId: number;
}

// 의미 색 → 펌웨어 ColorCode 변환은 shared/training-spec.logicColorToCode 사용
// (단일 소스: LOGIC_TO_HARDWARE_COLOR 경유, MIXED는 사용 안 함)

export type EnginePhase = 'IDLE' | 'RHYTHM' | 'COGNITIVE' | 'DONE';

export interface EnginePhaseInfo {
  phase: EnginePhase;
  cognitiveMode?: TrainingMode;
  cycleIndex: number; // 0-base, composite에서 현재 사이클
  ruleColor?: LogicColor; // COMPREHENSION 규칙
}

export interface EngineConfig {
  mode: TrainingMode; // COMPOSITE 면 5사이클 진행, 그 외는 단일 모드
  bpm: number;
  level: Level;
  totalDurationMs: number;
  podCount: number; // 보통 4
  isComposite: boolean;
  onPodStates: (states: PodState[]) => void;
  onElapsedMs: (ms: number) => void;
  onPhaseChange: (info: EnginePhaseInfo) => void;
  onComplete: (metrics: Omit<RawMetrics, 'sessionId' | 'userId'>) => void;
}

// ─────────────────────────────────────────────────────────────────────
// 내부 누적기 (모드별 카운트)
// ─────────────────────────────────────────────────────────────────────

interface ModeAcc {
  // 공통
  ticks: number;
  taps: number;
  hits: number;
  rtSamples: number[];

  // RHYTHM
  rhythmTicks: number;
  rPerfect: number;
  rGood: number;
  rBad: number;
  rMiss: number;
  rOffsets: number[];

  // FOCUS
  fTargetCount: number;
  fTargetHits: number;
  fDistractorCount: number;
  fCommissions: number;
  fOmissions: number;
  fRTs: number[];

  // MEMORY
  mShown: number;      // 시퀀스 길이 합
  mCorrect: number;    // 정답 입력 수
  mPerfectSeqs: number; // 시퀀스 완벽 횟수
  mTotalSeqs: number;
  mRTs: number[];

  // COMPREHENSION
  cTotal: number;
  cCorrect: number;
  cSwitchCount: number;
  cSwitchFirstRTs: number[]; // 전환 직후 첫 정답 RT
  cSwitchErrors: number;
  cSwitchAttempts: number; // 전환 직후 1~3 tick 시도 수
  cRTs: number[];

  // JUDGMENT
  jGoCount: number;
  jGoHit: number;
  jGoRTs: number[];
  jNoGoCount: number;
  jNoGoSuccess: number; // 안 누름 성공
  jDoubleCount: number;
  jDoubleHit: number;
  jImpulse: number;

  // AGILITY (손/발)
  aHandCount: number;
  aHandHit: number;
  aFootCount: number;
  aFootHit: number;
  aSimulCount: number;
  aSimulHit: number;
  aRTs: number[];

  // ENDURANCE 구간 (Early/Mid/Late) — composite도 누적
  earlyHits: number;
  earlyTotal: number;
  earlyRTs: number[];
  midHits: number;
  midTotal: number;
  midRTs: number[];
  lateHits: number;
  lateTotal: number;
  lateRTs: number[];
  earlyOmissions: number;
  lateOmissions: number;
}

function emptyAcc(): ModeAcc {
  return {
    ticks: 0, taps: 0, hits: 0, rtSamples: [],
    rhythmTicks: 0, rPerfect: 0, rGood: 0, rBad: 0, rMiss: 0, rOffsets: [],
    fTargetCount: 0, fTargetHits: 0, fDistractorCount: 0, fCommissions: 0, fOmissions: 0, fRTs: [],
    mShown: 0, mCorrect: 0, mPerfectSeqs: 0, mTotalSeqs: 0, mRTs: [],
    cTotal: 0, cCorrect: 0, cSwitchCount: 0, cSwitchFirstRTs: [], cSwitchErrors: 0, cSwitchAttempts: 0, cRTs: [],
    jGoCount: 0, jGoHit: 0, jGoRTs: [], jNoGoCount: 0, jNoGoSuccess: 0, jDoubleCount: 0, jDoubleHit: 0, jImpulse: 0,
    aHandCount: 0, aHandHit: 0, aFootCount: 0, aFootHit: 0, aSimulCount: 0, aSimulHit: 0, aRTs: [],
    earlyHits: 0, earlyTotal: 0, earlyRTs: [],
    midHits: 0, midTotal: 0, midRTs: [],
    lateHits: 0, lateTotal: 0, lateRTs: [],
    earlyOmissions: 0, lateOmissions: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// 통계 헬퍼
// ─────────────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─────────────────────────────────────────────────────────────────────
// 엔진
// ─────────────────────────────────────────────────────────────────────

const COGNITIVE_MODES_FOR_COMPOSITE: TrainingMode[] = [
  'MEMORY', 'COMPREHENSION', 'FOCUS', 'JUDGMENT', 'AGILITY',
];

export class TrainingEngine {
  private cfg: EngineConfig;
  private acc: ModeAcc = emptyAcc();
  private pods: PodState[] = [];
  private startedAt = 0;
  private rafId: number | null = null;
  private tickTimer: number | null = null;
  private phaseTimer: number | null = null;
  private compositePlan: { type: 'RHYTHM' | 'COGNITIVE'; cognitiveMode?: TrainingMode; durationMs: number }[] = [];
  private currentPlanIdx = 0;
  private currentCognitiveMode: TrainingMode = 'FOCUS';
  private currentRule: LogicColor = 'GREEN';
  private rhythmStep = 0;
  private memoryQueue: number[] = []; // 현재 보여줄 시퀀스
  private memoryReplay: number[] = []; // 사용자가 입력한 시퀀스
  private memoryPhase: 'SHOW' | 'RECALL' = 'SHOW';
  private memoryRecallStartedAt = 0;
  private memoryLastTapAt = 0;
  private pendingTimers: number[] = []; // destroy 시 정리 대상
  private lastTapAt: { podId: number; ts: number } | null = null; // 더블탭 감지
  private switchPendingFirst = false; // COMPREHENSION 전환 직후 첫 입력 측정
  private switchedAt = 0;
  private destroyed = false;
  /** monotonic tick id — BLE LED/TOUCH 매칭과 중복 입력 차단에 사용 */
  private tickIdCounter = 0;
  /** 이미 처리된 (pod, tickId) — UI tap과 BLE TOUCH가 모두 와도 1회만 */
  private consumedTickIds = new Set<string>();
  /** -1: 아직 한 번도 송신 안 됨 (첫 세그먼트에서 무조건 writeSession 보내기 위함) */
  private currentBlePhase: -1 | 0 | 1 = -1;

  constructor(cfg: EngineConfig) {
    this.cfg = cfg;
    this.pods = Array.from({ length: cfg.podCount }, (_, i) => ({
      id: i, fill: 'OFF', isTarget: false, litAt: null, expiresAt: null, tickId: 0,
    }));
  }

  private nextTickId(): number {
    this.tickIdCounter = (this.tickIdCounter + 1) >>> 0;
    if (this.tickIdCounter === 0) this.tickIdCounter = 1;
    return this.tickIdCounter;
  }

  start(): void {
    this.startedAt = Date.now();
    this.acc = emptyAcc();
    this.consumedTickIds.clear();

    // BLE 세션 메타 + START (네이티브 셸이 아니면 자동 no-op)
    // 정책:
    //   1) 항상 writeSession을 먼저 보내고 그 다음 writeControl(START) — 펌웨어가
    //      세션 메타를 받은 상태에서 시작하도록 보장.
    //   2) durationSec는 "현재 활성 세그먼트(페이즈)의 길이"로 일관 송신.
    //   3) COMPOSITE는 첫 세그먼트의 페이즈/길이를 start()에서 한 번 보내고,
    //      이후 페이즈가 바뀔 때만 runNextPlan에서 재송신 (currentBlePhase 비교).
    const isComp = this.cfg.isComposite || this.cfg.mode === 'COMPOSITE';

    if (isComp) {
      this.buildCompositePlan();
      const first = this.compositePlan[0];
      if (first) {
        const firstPhase = first.type === 'RHYTHM' ? SESSION_PHASE_RHYTHM : SESSION_PHASE_COGNITIVE;
        this.currentBlePhase = firstPhase;
        bleWriteSession({
          bpm: this.cfg.bpm,
          level: this.cfg.level,
          phase: firstPhase,
          durationSec: Math.round(first.durationMs / 1000),
        });
      }
      bleWriteControl(CTRL_START);
      this.runNextPlan();
    } else {
      this.currentCognitiveMode = this.cfg.mode === 'FREE' ? 'FOCUS' : this.cfg.mode;
      this.currentBlePhase = SESSION_PHASE_COGNITIVE;
      bleWriteSession({
        bpm: this.cfg.bpm,
        level: this.cfg.level,
        phase: SESSION_PHASE_COGNITIVE,
        durationSec: Math.round(this.cfg.totalDurationMs / 1000),
      });
      bleWriteControl(CTRL_START);
      this.cfg.onPhaseChange({ phase: 'COGNITIVE', cognitiveMode: this.currentCognitiveMode, cycleIndex: 0 });
      this.startTickLoop(this.cfg.totalDurationMs);
    }

    // elapsed 표시용 RAF
    const tickElapsed = () => {
      if (this.destroyed) return;
      const e = Date.now() - this.startedAt;
      this.cfg.onElapsedMs(Math.min(this.cfg.totalDurationMs, e));
      if (e >= this.cfg.totalDurationMs) {
        this.complete();
        return;
      }
      this.rafId = window.requestAnimationFrame(tickElapsed);
    };
    this.rafId = window.requestAnimationFrame(tickElapsed);
  }

  destroy(): void {
    if (!this.destroyed) {
      // 중도 취소(언마운트 등) — STOP 송신 (bleWriteControl는 native 미연결 시 자동 no-op)
      bleWriteControl(CTRL_STOP);
    }
    this.destroyed = true;
    if (this.rafId) window.cancelAnimationFrame(this.rafId);
    if (this.tickTimer) window.clearTimeout(this.tickTimer);
    if (this.phaseTimer) window.clearTimeout(this.phaseTimer);
    this.pendingTimers.forEach((t) => window.clearTimeout(t));
    this.pendingTimers = [];
  }

  private schedule(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      this.pendingTimers = this.pendingTimers.filter((t) => t !== id);
      if (this.destroyed) return;
      fn();
    }, ms);
    this.pendingTimers.push(id);
  }

  // ───── Composite 플랜 (5사이클 RHYTHM↔COGNITIVE) ────────────────────
  private buildCompositePlan(): void {
    const total = this.cfg.totalDurationMs;
    // 가능한 사이클 수: 페이즈 길이로 나눔
    const cycleMs = RHYTHM_PHASE_MS + COGNITIVE_PHASE_MS;
    const cycles = Math.max(1, Math.floor(total / cycleMs));
    const plan: typeof this.compositePlan = [];
    for (let c = 0; c < cycles; c++) {
      plan.push({ type: 'RHYTHM', durationMs: RHYTHM_PHASE_MS });
      const cmode = COGNITIVE_MODES_FOR_COMPOSITE[c % COGNITIVE_MODES_FOR_COMPOSITE.length];
      plan.push({ type: 'COGNITIVE', durationMs: COGNITIVE_PHASE_MS, cognitiveMode: cmode });
    }
    // 잔여 시간을 마지막 페이즈에 합산
    const used = cycles * cycleMs;
    if (used < total && plan.length > 0) {
      plan[plan.length - 1].durationMs += (total - used);
    }
    this.compositePlan = plan;
    this.currentPlanIdx = 0;
  }

  private runNextPlan(): void {
    if (this.destroyed) return;
    if (this.currentPlanIdx >= this.compositePlan.length) {
      this.complete();
      return;
    }
    const seg = this.compositePlan[this.currentPlanIdx];
    const cycle = Math.floor(this.currentPlanIdx / 2);
    if (seg.type === 'RHYTHM') {
      this.cfg.onPhaseChange({ phase: 'RHYTHM', cycleIndex: cycle });
    } else {
      this.currentCognitiveMode = seg.cognitiveMode || 'FOCUS';
      this.cfg.onPhaseChange({ phase: 'COGNITIVE', cognitiveMode: this.currentCognitiveMode, cycleIndex: cycle });
    }
    // 페이즈 전환(또는 첫 세그먼트)을 펌웨어에도 알린다.
    // currentBlePhase=-1(미송신)이거나 페이즈가 바뀐 경우 모두 재송신.
    const blePhase = seg.type === 'RHYTHM' ? SESSION_PHASE_RHYTHM : SESSION_PHASE_COGNITIVE;
    if (blePhase !== this.currentBlePhase) {
      this.currentBlePhase = blePhase;
      bleWriteSession({
        bpm: this.cfg.bpm,
        level: this.cfg.level,
        phase: blePhase,
        durationSec: Math.round(seg.durationMs / 1000),
      });
    }
    this.startTickLoop(seg.durationMs, () => {
      this.currentPlanIdx += 1;
      this.runNextPlan();
    });
  }

  // ───── tick 루프 ────────────────────────────────────────────────────
  private startTickLoop(durationMs: number, onPhaseEnd?: () => void): void {
    const beatMs = Math.max(120, Math.round(60_000 / this.cfg.bpm));
    const tickInterval = beatMs; // 1 beat = 1 tick
    const phaseStart = Date.now();
    const segIsRhythm =
      (this.cfg.isComposite || this.cfg.mode === 'COMPOSITE') &&
      this.compositePlan[this.currentPlanIdx]?.type === 'RHYTHM';

    // MEMORY는 SHOW 단계 먼저 → RECALL
    if (!segIsRhythm && this.currentCognitiveMode === 'MEMORY') {
      this.memoryQueue = [];
      this.memoryReplay = [];
      this.memoryPhase = 'SHOW';
      const seqLen = clamp(this.cfg.level + 2, 3, 6);
      this.acc.mTotalSeqs += 1;
      this.acc.mShown += seqLen;
      // 시퀀스 보여주기: tickInterval 마다 하나씩 (destroy 시 정리)
      for (let i = 0; i < seqLen; i++) {
        const podId = Math.floor(Math.random() * this.cfg.podCount);
        this.memoryQueue.push(podId);
        this.schedule(() => {
          this.lightSinglePod(podId, 'GREEN', tickInterval * 0.6);
        }, i * tickInterval);
      }
      // SHOW 끝나면 RECALL로 전환 (모든 Pod WHITE 신호)
      const showEnd = seqLen * tickInterval;
      this.schedule(() => {
        this.memoryPhase = 'RECALL';
        this.memoryRecallStartedAt = Date.now();
        this.memoryLastTapAt = 0;
        this.allOff();
        // WHITE 입력 신호 — Pod별 monotonic tickId 부여 + BLE 점등
        const recallWindow = tickInterval * seqLen;
        const now = Date.now();
        this.pods = this.pods.map(p => {
          const tickId = this.nextTickId();
          bleWriteLed({ tickId, pod: p.id, colorCode: logicColorToCode('WHITE'), onMs: recallWindow });
          return { ...p, fill: 'WHITE', isTarget: true, litAt: now, expiresAt: now + recallWindow, tickId };
        });
        this.cfg.onPodStates(this.pods);
      }, showEnd);
    }

    // COMPREHENSION 시작 시 규칙 결정
    if (!segIsRhythm && this.currentCognitiveMode === 'COMPREHENSION') {
      this.currentRule = Math.random() < 0.5 ? 'GREEN' : 'BLUE';
    }

    const fireTick = () => {
      if (this.destroyed) return;
      const elapsedInPhase = Date.now() - phaseStart;
      if (elapsedInPhase >= durationMs) {
        this.allOff();
        if (onPhaseEnd) onPhaseEnd();
        return;
      }
      this.acc.ticks += 1;

      if (segIsRhythm) {
        this.fireRhythmTick(beatMs);
      } else {
        switch (this.currentCognitiveMode) {
          case 'FOCUS':
          case 'ENDURANCE':
            this.fireFocusTick(beatMs);
            break;
          case 'COMPREHENSION':
            this.fireComprehensionTick(beatMs, durationMs, elapsedInPhase);
            break;
          case 'JUDGMENT':
            this.fireJudgmentTick(beatMs);
            break;
          case 'AGILITY':
            this.fireAgilityTick(beatMs);
            break;
          case 'MEMORY':
            // SHOW/RECALL은 위에서 별도 스케줄
            break;
          default:
            this.fireFocusTick(beatMs);
        }
      }

      this.tickTimer = window.setTimeout(fireTick, tickInterval);
    };
    // 첫 tick은 살짝 딜레이(준비)
    this.tickTimer = window.setTimeout(fireTick, 350);
  }

  // ───── 모드별 tick 점등 ─────────────────────────────────────────────
  private fireRhythmTick(beatMs: number): void {
    // 기획 v2.0: 레벨별 RHYTHM 패턴 (rhythmStepsForBeat) 사용
    const steps = rhythmStepsForBeat(this.cfg.level, this.rhythmStep);
    this.rhythmStep += 1;
    if (steps.length === 0) return; // 쉬는 박
    const onMs = Math.max(120, beatMs * 0.45);
    for (const step of steps) {
      const delay = Math.round(beatMs * step.offsetRatio);
      this.schedule(() => {
        this.acc.rhythmTicks += 1;
        if (step.pods.length === 1) {
          this.lightSinglePod(step.pods[0], 'GREEN', onMs, true);
        } else if (step.pods.length === 2) {
          this.lightTwoPods(step.pods[0], 'GREEN', step.pods[1], 'GREEN', onMs, true);
        } else {
          // 3개 이상 동시는 사양상 없지만 안전 처리
          step.pods.forEach((p) => this.lightSinglePod(p, 'GREEN', onMs, true));
        }
      }, delay);
    }
  }

  private fireFocusTick(beatMs: number): void {
    // 60% 타겟(BLUE), 40% 방해(RED/YELLOW)
    const isTarget = Math.random() < 0.6;
    const color: LogicColor = isTarget ? 'BLUE' : (Math.random() < 0.5 ? 'RED' : 'YELLOW');
    const podId = Math.floor(Math.random() * this.cfg.podCount);
    if (isTarget) {
      this.acc.fTargetCount += 1;
      this.recordIntervalCount('total', this.elapsedMs(), 1);
    } else {
      this.acc.fDistractorCount += 1;
    }
    this.lightSinglePod(podId, color, beatMs * 0.9, isTarget);
  }

  private fireComprehensionTick(beatMs: number, totalMs: number, elapsedInPhase: number): void {
    // 일정 확률로 규칙 전환 (페이즈당 1~3회)
    const switchProb = 1.5 / Math.max(4, totalMs / beatMs);
    if (this.acc.cSwitchCount < 3 && Math.random() < switchProb && elapsedInPhase > beatMs * 2) {
      this.currentRule = this.currentRule === 'GREEN' ? 'BLUE' : 'GREEN';
      this.acc.cSwitchCount += 1;
      this.switchPendingFirst = true;
      this.switchedAt = Date.now();
      // WHITE 전환 경고 → 다음 tick에 점등
      this.flashAll('WHITE', 250);
      return;
    }
    // 규칙 색을 정답으로, 반대색이나 RED를 방해로
    const colors: LogicColor[] = [this.currentRule, this.currentRule === 'GREEN' ? 'BLUE' : 'GREEN', 'RED'];
    const c = rand(colors);
    const podId = Math.floor(Math.random() * this.cfg.podCount);
    const isTarget = c === this.currentRule;
    if (isTarget) this.acc.cTotal += 1;
    this.lightSinglePod(podId, c, beatMs * 0.9, isTarget);
  }

  private fireJudgmentTick(beatMs: number): void {
    // GREEN(GO 1탭) / RED(NO-GO 안누름) / YELLOW(DOUBLE 2탭)
    const r = Math.random();
    const c: LogicColor = r < 0.5 ? 'GREEN' : r < 0.8 ? 'RED' : 'YELLOW';
    const podId = Math.floor(Math.random() * this.cfg.podCount);
    if (c === 'GREEN') this.acc.jGoCount += 1;
    else if (c === 'RED') this.acc.jNoGoCount += 1;
    else this.acc.jDoubleCount += 1;
    // RED는 isTarget=false (누르면 안 됨)
    this.lightSinglePod(podId, c, beatMs * 1.1, c !== 'RED');
  }

  private fireAgilityTick(beatMs: number): void {
    // GREEN=손(아무 Pod), BLUE=오른발(Pod0), YELLOW=왼발(Pod3) — 동시 이벤트는 Lv4+
    const allowSimul = this.cfg.level >= 4;
    const r = Math.random();
    if (allowSimul && r < 0.25) {
      // 동시: GREEN + BLUE
      this.acc.aSimulCount += 1;
      this.acc.aHandCount += 1;
      this.acc.aFootCount += 1;
      this.lightTwoPods(1, 'GREEN', 0, 'BLUE', beatMs * 1.0, true);
      return;
    }
    if (r < 0.5) {
      this.acc.aHandCount += 1;
      const podId = Math.floor(Math.random() * this.cfg.podCount);
      this.lightSinglePod(podId, 'GREEN', beatMs * 0.9, true);
    } else {
      this.acc.aFootCount += 1;
      const c: LogicColor = Math.random() < 0.5 ? 'BLUE' : 'YELLOW';
      const podId = c === 'BLUE' ? 0 : 3;
      this.lightSinglePod(podId, c, beatMs * 0.9, true);
    }
  }

  // ───── 점등 헬퍼 ────────────────────────────────────────────────────
  private allOff(): void {
    this.pods = this.pods.map(p => ({ ...p, fill: 'OFF', isTarget: false, litAt: null, expiresAt: null, tickId: 0 }));
    this.cfg.onPodStates(this.pods);
  }

  private flashAll(color: LogicColor, ms: number): void {
    // 입력을 받지 않는 시각 신호이므로 BLE는 동기 송신만 (tickId는 부여하지만 consume 추적 X)
    this.pods = this.pods.map(p => {
      const tickId = this.nextTickId();
      bleWriteLed({ tickId, pod: p.id, colorCode: logicColorToCode(color), onMs: ms });
      return { ...p, fill: color, isTarget: false, litAt: null, expiresAt: null, tickId: 0 };
    });
    this.cfg.onPodStates(this.pods);
    this.schedule(() => this.allOff(), ms);
  }

  private lightSinglePod(podId: number, color: LogicColor, windowMs: number, isTarget = true): void {
    const now = Date.now();
    const expiresAt = now + windowMs;
    const tickId = this.nextTickId();
    bleWriteLed({ tickId, pod: podId, colorCode: logicColorToCode(color), onMs: Math.min(0xffff, Math.round(windowMs)) });
    this.pods = this.pods.map(p =>
      p.id === podId
        ? { ...p, fill: color, isTarget, litAt: now, expiresAt, tickId }
        : { ...p, fill: 'OFF', isTarget: false, litAt: null, expiresAt: null, tickId: 0 }
    );
    this.cfg.onPodStates(this.pods);
    this.schedule(() => {
      // 타겟이었는데 미응답 → omission
      const p = this.pods.find(x => x.id === podId);
      if (p && p.litAt === now && p.fill === color) {
        if (isTarget) this.recordOmission(color);
        this.allOff();
      }
    }, windowMs);
  }

  private lightTwoPods(idA: number, colorA: LogicColor, idB: number, colorB: LogicColor, windowMs: number, isTarget = true): void {
    const now = Date.now();
    const expiresAt = now + windowMs;
    const tickIdA = this.nextTickId();
    const tickIdB = this.nextTickId();
    const onMsClamped = Math.min(0xffff, Math.round(windowMs));
    bleWriteLed({ tickId: tickIdA, pod: idA, colorCode: logicColorToCode(colorA), onMs: onMsClamped });
    bleWriteLed({ tickId: tickIdB, pod: idB, colorCode: logicColorToCode(colorB), onMs: onMsClamped });
    this.pods = this.pods.map(p => {
      if (p.id === idA) return { ...p, fill: colorA, isTarget, litAt: now, expiresAt, tickId: tickIdA };
      if (p.id === idB) return { ...p, fill: colorB, isTarget, litAt: now, expiresAt, tickId: tickIdB };
      return { ...p, fill: 'OFF', isTarget: false, litAt: null, expiresAt: null, tickId: 0 };
    });
    this.cfg.onPodStates(this.pods);
    this.schedule(() => this.allOff(), windowMs);
  }

  // ───── 입력 처리 ────────────────────────────────────────────────────
  /**
   * 입력 처리. opts.deltaMs는 펌웨어가 측정한 (실제 입력 시각 - 점등 목표 시각) 값.
   * 동일한 (pod, tickId) 입력이 UI tap과 BLE TOUCH 양쪽에서 와도 1회만 처리한다.
   */
  handleTap(podId: number, opts?: { deltaMs?: number; tickId?: number }): void {
    if (this.destroyed) return;
    const now = Date.now();
    const pod = this.pods.find(p => p.id === podId);
    if (!pod || pod.fill === 'OFF') return;

    // BLE에서 명시 tickId가 왔는데 현재 pod의 점등 tickId와 다르면 stale (구 tick의 지연 입력) → drop.
    // UI tap은 tickId 미지정이므로 항상 현재 pod.tickId 기준으로 처리.
    if (opts?.tickId && opts.tickId > 0 && pod.tickId > 0 && opts.tickId !== pod.tickId) {
      return; // stale BLE TOUCH
    }
    // 중복 처리 차단 — UI(브릿지된 클릭) + BLE TOUCH 동시 도착 케이스
    const expectedTickId = pod.tickId > 0 ? pod.tickId : (opts?.tickId ?? 0);
    if (expectedTickId > 0) {
      const key = `${podId}:${expectedTickId}`;
      if (this.consumedTickIds.has(key)) return;
      this.consumedTickIds.add(key);
    }

    const elapsedTotal = this.elapsedMs();

    const segIsRhythm =
      (this.cfg.isComposite || this.cfg.mode === 'COMPOSITE') &&
      this.compositePlan[this.currentPlanIdx]?.type === 'RHYTHM';

    if (segIsRhythm) {
      this.handleRhythmTap(pod, now, opts?.deltaMs);
      return;
    }

    // 더블탭 처리 (JUDGMENT YELLOW)
    let isDoubleTap = false;
    if (this.lastTapAt && this.lastTapAt.podId === podId && (now - this.lastTapAt.ts) <= 600) {
      isDoubleTap = true;
      this.lastTapAt = null;
    } else {
      this.lastTapAt = { podId, ts: now };
    }

    switch (this.currentCognitiveMode) {
      case 'FOCUS':
      case 'ENDURANCE':
        this.handleFocusTap(pod, now, elapsedTotal, opts?.deltaMs);
        break;
      case 'COMPREHENSION':
        this.handleComprehensionTap(pod, now, elapsedTotal, opts?.deltaMs);
        break;
      case 'JUDGMENT':
        this.handleJudgmentTap(pod, now, isDoubleTap, opts?.deltaMs);
        break;
      case 'AGILITY':
        this.handleAgilityTap(pod, now, opts?.deltaMs);
        break;
      case 'MEMORY':
        this.handleMemoryTap(pod, now);
        break;
    }
    // tap 처리 후 끄기 (RHYTHM 외)
    this.allOff();
  }

  /** RT (ms) — BLE deltaMs가 있으면 점등 onMs 기준 절댓값(=실제 RT 근사), 없으면 wall-clock 차이 */
  private rtFromTap(pod: PodState, now: number, deltaMs?: number): number {
    if (typeof deltaMs === 'number' && Number.isFinite(deltaMs)) {
      return Math.max(0, Math.abs(deltaMs));
    }
    return pod.litAt ? Math.max(0, now - pod.litAt) : 500;
  }

  private handleRhythmTap(pod: PodState, now: number, deltaMs?: number): void {
    // BLE TOUCH가 펌웨어 자체 측정을 제공하면 그 값을 |errMs|로 사용 (드리프트 누적 없음)
    let offset: number;
    if (typeof deltaMs === 'number' && Number.isFinite(deltaMs)) {
      offset = Math.abs(deltaMs);
    } else {
      const t = pod.litAt ?? now;
      offset = Math.abs(now - t);
    }
    this.acc.rOffsets.push(offset);
    // 펌웨어와 동일한 임계값으로 등급 판정 (shared/ble-protocol.judgeRhythmError)
    const grade = judgeRhythmError(offset);
    if (grade === 'PERFECT') this.acc.rPerfect += 1;
    else if (grade === 'GOOD') this.acc.rGood += 1;
    else if (grade === 'BAD') this.acc.rBad += 1;
    else this.acc.rMiss += 1;
    // 다음 점등을 위해 끄기
    this.pods = this.pods.map(p => p.id === pod.id ? { ...p, fill: 'OFF', isTarget: false, litAt: null, expiresAt: null, tickId: 0 } : p);
    this.cfg.onPodStates(this.pods);
  }

  private handleFocusTap(pod: PodState, now: number, elapsedTotal: number, deltaMs?: number): void {
    const rt = this.rtFromTap(pod, now, deltaMs);
    if (pod.fill === 'BLUE' && pod.isTarget) {
      this.acc.fTargetHits += 1;
      this.acc.fRTs.push(rt);
      this.recordIntervalHit('hit', elapsedTotal, rt);
    } else {
      this.acc.fCommissions += 1;
    }
  }

  private handleComprehensionTap(pod: PodState, now: number, elapsedTotal: number, deltaMs?: number): void {
    const rt = this.rtFromTap(pod, now, deltaMs);
    const isCorrect = pod.fill === this.currentRule;
    if (isCorrect) {
      this.acc.cCorrect += 1;
      this.acc.cRTs.push(rt);
      if (this.switchPendingFirst) {
        this.acc.cSwitchFirstRTs.push(now - this.switchedAt);
        this.switchPendingFirst = false;
      }
      this.recordIntervalHit('hit', elapsedTotal, rt);
    } else {
      if (this.switchPendingFirst) this.acc.cSwitchErrors += 1;
    }
    this.acc.cSwitchAttempts += 1;
  }

  private handleJudgmentTap(pod: PodState, now: number, isDoubleTap: boolean, deltaMs?: number): void {
    const rt = this.rtFromTap(pod, now, deltaMs);
    if (pod.fill === 'GREEN') {
      this.acc.jGoHit += 1;
      this.acc.jGoRTs.push(rt);
    } else if (pod.fill === 'RED') {
      this.acc.jImpulse += 1; // 누르면 안 되는데 누름
    } else if (pod.fill === 'YELLOW') {
      if (isDoubleTap) this.acc.jDoubleHit += 1;
    }
  }

  private handleAgilityTap(pod: PodState, now: number, deltaMs?: number): void {
    const rt = this.rtFromTap(pod, now, deltaMs);
    this.acc.aRTs.push(rt);
    if (pod.fill === 'GREEN') this.acc.aHandHit += 1;
    else if (pod.fill === 'BLUE' || pod.fill === 'YELLOW') this.acc.aFootHit += 1;
    // 동시 이벤트 케이스: 다른 Pod도 켜져 있으면 simul 성공
    const other = this.pods.find(p => p.id !== pod.id && p.fill !== 'OFF');
    if (other) this.acc.aSimulHit += 1;
  }

  private handleMemoryTap(pod: PodState, now: number): void {
    if (this.memoryPhase !== 'RECALL') return;
    this.memoryReplay.push(pod.id);
    const idx = this.memoryReplay.length - 1;
    const expected = this.memoryQueue[idx];
    if (expected === pod.id) {
      this.acc.mCorrect += 1;
    }
    // 실제 RT: 첫 입력은 RECALL 시작 시각 대비, 이후는 직전 입력 대비 시간
    const refTs = this.memoryLastTapAt || this.memoryRecallStartedAt || now;
    const rt = Math.max(0, now - refTs);
    if (rt > 0) this.acc.mRTs.push(rt);
    this.memoryLastTapAt = now;
    if (this.memoryReplay.length >= this.memoryQueue.length) {
      const allOk = this.memoryReplay.every((p, i) => p === this.memoryQueue[i]);
      if (allOk) this.acc.mPerfectSeqs += 1;
      this.memoryPhase = 'SHOW';
      this.memoryReplay = [];
      this.memoryQueue = [];
    }
  }

  private recordOmission(color: LogicColor): void {
    if (this.currentCognitiveMode === 'FOCUS' || this.currentCognitiveMode === 'ENDURANCE') {
      if (color === 'BLUE') this.acc.fOmissions += 1;
    }
    if (this.currentCognitiveMode === 'JUDGMENT' && color === 'RED') {
      // RED 미응답 = 억제 성공
      this.acc.jNoGoSuccess += 1;
    }
    // 구간 omission
    const e = this.elapsedMs();
    const total = this.cfg.totalDurationMs;
    if (e < total * 0.34) this.acc.earlyOmissions += 1;
    else if (e > total * 0.66) this.acc.lateOmissions += 1;
  }

  private recordIntervalCount(_kind: 'total', elapsedMs: number, n: number): void {
    const total = this.cfg.totalDurationMs;
    if (elapsedMs < total * 0.34) this.acc.earlyTotal += n;
    else if (elapsedMs < total * 0.66) this.acc.midTotal += n;
    else this.acc.lateTotal += n;
  }

  private recordIntervalHit(_kind: 'hit', elapsedMs: number, rt: number): void {
    const total = this.cfg.totalDurationMs;
    if (elapsedMs < total * 0.34) {
      this.acc.earlyHits += 1;
      this.acc.earlyRTs.push(rt);
    } else if (elapsedMs < total * 0.66) {
      this.acc.midHits += 1;
      this.acc.midRTs.push(rt);
    } else {
      this.acc.lateHits += 1;
      this.acc.lateRTs.push(rt);
    }
  }

  // ───── 종료/메트릭 산출 ─────────────────────────────────────────────
  private elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  private complete(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.rafId) window.cancelAnimationFrame(this.rafId);
    if (this.tickTimer) window.clearTimeout(this.tickTimer);
    if (this.phaseTimer) window.clearTimeout(this.phaseTimer);
    this.allOff();
    // BLE 정상 종료 (bleWriteControl는 native 미연결 시 자동 no-op)
    bleWriteControl(CTRL_STOP);
    this.cfg.onPhaseChange({ phase: 'DONE', cycleIndex: 0 });
    this.cfg.onComplete(this.buildMetrics());
  }

  private buildMetrics(): Omit<RawMetrics, 'sessionId' | 'userId'> {
    const a = this.acc;

    // RHYTHM
    const totalRhythm = Math.max(1, a.rhythmTicks);
    const rhythmAccuracy = clamp(
      (a.rPerfect + a.rGood * 0.5 + a.rBad * 0.2) / totalRhythm,
      0, 1
    );

    // FOCUS
    const totalTargets = Math.max(1, a.fTargetCount);
    const totalDistractors = Math.max(1, a.fDistractorCount);
    const fHitRate = a.fTargetHits / totalTargets;
    const fCommissionRate = a.fCommissions / totalDistractors;
    const fOmissionRate = (a.fTargetCount - a.fTargetHits) / totalTargets;

    // MEMORY
    const mShown = Math.max(1, a.mShown);
    const seqAcc = a.mCorrect / mShown;
    const mTotalSeqs = Math.max(1, a.mTotalSeqs);
    const perfectRecall = a.mPerfectSeqs / mTotalSeqs;

    // COMPREHENSION
    const cTotal = Math.max(1, a.cTotal);
    const ruleAcc = a.cCorrect / cTotal;
    const switchRT = a.cSwitchFirstRTs.length > 0 ? mean(a.cSwitchFirstRTs) : 500;
    const switchAttempts = Math.max(1, a.cSwitchAttempts);
    const switchErrRate = a.cSwitchErrors / switchAttempts;

    // JUDGMENT
    const goRate = a.jGoCount > 0 ? a.jGoHit / a.jGoCount : 0;
    const noGoRate = a.jNoGoCount > 0 ? a.jNoGoSuccess / a.jNoGoCount : 0;
    const dblRate = a.jDoubleCount > 0 ? a.jDoubleHit / a.jDoubleCount : 0;

    // AGILITY
    const handRate = a.aHandCount > 0 ? a.aHandHit / a.aHandCount : 0;
    const footRate = a.aFootCount > 0 ? a.aFootHit / a.aFootCount : 0;
    const simulRate = a.aSimulCount > 0 ? a.aSimulHit / a.aSimulCount : 0;
    const anchorOmit = clamp(1 - handRate, 0, 1);

    // ENDURANCE (구간 점수)
    const earlyAcc = a.earlyTotal > 0 ? a.earlyHits / a.earlyTotal : 0;
    const midAcc = a.midTotal > 0 ? a.midHits / a.midTotal : 0;
    const lateAcc = a.lateTotal > 0 ? a.lateHits / a.lateTotal : 0;
    const earlyRTm = mean(a.earlyRTs) || 500;
    const lateRTm = mean(a.lateRTs) || 500;
    const earlyScore = Math.round(clamp(earlyAcc * 100, 0, 100));
    const midScore = Math.round(clamp(midAcc * 100, 0, 100));
    const lateScore = Math.round(clamp(lateAcc * 100, 0, 100));
    const maintain = earlyScore > 0 ? lateScore / earlyScore : 0;
    const drift = earlyRTm > 0 ? clamp((lateRTm - earlyRTm) / earlyRTm, 0, 1) : 0;

    // 통합 RT/SD
    const allRTs = [...a.fRTs, ...a.cRTs, ...a.jGoRTs, ...a.aRTs, ...a.mRTs];
    const rtMean = allRTs.length > 0 ? Math.round(mean(allRTs)) : 500;
    const rtSD = allRTs.length > 1 ? Math.round(sd(allRTs)) : 0;
    const totalTaps = a.fTargetHits + a.fCommissions + a.cCorrect + a.jGoHit + a.jDoubleHit + a.aHandHit + a.aFootHit + a.mCorrect;

    return {
      touchCount: totalTaps + a.rPerfect + a.rGood + a.rBad,
      hitCount: a.fTargetHits + a.cCorrect + a.jGoHit + a.jDoubleHit + a.jNoGoSuccess + a.aHandHit + a.aFootHit + a.mCorrect,
      rtMean,
      rtSD,
      createdAt: new Date().toISOString(),
      rhythm: {
        totalTicks: a.rhythmTicks,
        perfectCount: a.rPerfect,
        goodCount: a.rGood,
        badCount: a.rBad,
        missCount: a.rMiss,
        accuracy: rhythmAccuracy,
        avgOffset: Math.round(mean(a.rOffsets)),
        offsetSD: Math.round(sd(a.rOffsets)),
      },
      memory: {
        maxSpan: this.cfg.level + 2,
        sequenceAccuracy: clamp(seqAcc, 0, 1),
        perfectRecallRate: clamp(perfectRecall, 0, 1),
        avgReactionTime: Math.round(mean(a.mRTs) || 500),
      },
      comprehension: {
        avgReactionTime: Math.round(mean(a.cRTs) || 500),
        switchCost: Math.round(switchRT),
        switchErrorRate: clamp(switchErrRate, 0, 1),
        learningSlope: 0,
        ruleAccuracy: clamp(ruleAcc, 0, 1),
      },
      focus: {
        targetHitRate: clamp(fHitRate, 0, 1),
        commissionErrorRate: clamp(fCommissionRate, 0, 1),
        omissionErrorRate: clamp(fOmissionRate, 0, 1),
        avgReactionTime: Math.round(mean(a.fRTs) || 500),
        reactionTimeSD: Math.round(sd(a.fRTs)),
        lapseCount: 0,
      },
      judgment: {
        noGoSuccessRate: clamp(noGoRate, 0, 1),
        goSuccessRate: clamp(goRate, 0, 1),
        doubleTapSuccessRate: clamp(dblRate, 0, 1),
        avgGoReactionTime: Math.round(mean(a.jGoRTs) || 500),
        reactionTimeSD: Math.round(sd(a.jGoRTs)),
        impulseCount: a.jImpulse,
      },
      agility: {
        footAccuracy: clamp(footRate, 0, 1),
        anchorOmissionRate: clamp(anchorOmit, 0, 1),
        simultaneousSuccessRate: clamp(simulRate, 0, 1),
        switchCost: 250,
        syncError: 80,
        reactionTime: Math.round(mean(a.aRTs) || 500),
      },
      endurance: {
        earlyScore,
        midScore,
        lateScore,
        maintainRatio: clamp(maintain, 0, 2),
        drift,
        earlyReactionTime: Math.round(earlyRTm),
        lateReactionTime: Math.round(lateRTm),
        omissionIncrease: Math.max(0, a.lateOmissions - a.earlyOmissions),
      },
    };
  }
}

export const TOTAL_COMPOSITE_MS = COMPOSITE_TOTAL_MS;
