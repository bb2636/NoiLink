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
  BPM_MAX,
  BPM_MIN,
  COLOR_CODE,
  COMPOSITE_TOTAL_MS,
  COGNITIVE_PHASE_MS,
  CTRL_START,
  CTRL_STOP,
  RHYTHM_PHASE_MS,
  SESSION_PHASE_COGNITIVE,
  SESSION_PHASE_RHYTHM,
  defaultOnMsForLevel,
  judgeRhythmError,
  judgmentDoubleTapWindowMs,
  logicColorToCode,
  rhythmStepsForBeat,
} from '@noilink/shared';

import { bleWriteControl, bleWriteLed, bleWriteSession } from '../native/bleBridge';

/**
 * START(`aa 55`) 송신 직후 첫 LED 명령까지의 마진(ms).
 *
 * 사용자 NINA-B1 펌웨어 같은 NUS 계열은 START 처리에 시간이 필요한데, 이 마진이
 * 너무 짧으면 첫 LED 명령을 통째로 무시하고 본체가 멈춰 보일 수 있다. 디바이스
 * 화면의 점등 진단(`Device.tsx#handleTestBlink`)이 사용자 기기에서 정상 동작하는
 * 500ms 마진과 동일하게 둔다.
 *
 * 변경 시 `engine.test.ts` / `engine.pauseResume.test.ts` 의 첫 tick 대기 시간도
 * 함께 갱신해야 한다 — 두 곳 모두 본 상수를 import 해 사용한다.
 */
export const FIRST_TICK_DELAY_MS = 500;

// BLE 송신용 BPM 안전벨트.
// 사용자가 0~59 같은 범위 밖 값으로 시작하더라도 펌웨어 스키마(60~200)를
// 위반해 native 가 ack 거부 → "내부 오류" 토스트가 뜨는 사고를 막는다.
// 화면 측(TrainingSetup)에서도 동일 범위로 입력을 막지만 엔진 자체에서도
// 한 번 더 가두는 것이 안전.
function clampBpmForBle(bpm: number): number {
  if (!Number.isFinite(bpm)) return BPM_MIN;
  const rounded = Math.round(bpm);
  if (rounded < BPM_MIN) return BPM_MIN;
  if (rounded > BPM_MAX) return BPM_MAX;
  return rounded;
}

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

  // RECOVERY (BLE 단절 → 자동 재연결 회복 구간)
  /** 누적 회복 구간 길이(ms) — 채점에서 제외된 시간 */
  recoveryMs: number;
  /**
   * 회복 구간별 타임라인.
   * - startedAt: 세션 시작으로부터 경과한 ms (사용자가 "언제 끊겼는지" 가늠 가능).
   * - durationMs: 해당 구간의 길이 (현재 진행 중인 구간은 endRecoveryWindow 호출 전까지 0).
   * 횟수는 `recoveryWindows.length` 로 노출한다 (Task #36).
   */
  recoveryWindows: { startedAt: number; durationMs: number }[];
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
    recoveryMs: 0, recoveryWindows: [],
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
  /** BLE 단절 → 자동 재연결 회복 중 여부. 채점에서 새 자극을 잠시 멈춘다. */
  private inRecoveryWindow = false;
  /** 현재 회복 구간의 시작 시각(Date.now). 종료 시 누적해 acc.recoveryMs 에 더한다. */
  private recoveryEnteredAt = 0;

  // ── 일시정지(pause/resume) 지원 ──
  // 점등-전용 트레이닝 화면(TrainingBlinkPlay)이 사용자의 명시적 "일시정지" 요청을
  // 처리하기 위한 진입점. 회복 구간(beginRecoveryWindow)과는 의미가 달라 분리:
  //   - 회복: BLE 끊김으로 채점 제외 시간을 누적하지만 phase clock 은 계속 흐른다.
  //   - 일시정지: phase clock 자체가 멈추고, 재개 시 같은 지점에서 이어진다.
  /** 사용자 일시정지 중 여부. true 일 때는 모든 timer/RAF 가 멈춰 있다. */
  private isPaused = false;
  /** 일시정지 진입 시각(Date.now). resume 시 dt 계산에 사용. */
  private pausedAt = 0;
  /** 현재 진행 중인 phase(또는 단일 모드의 전체 세션) 시작 시각(Date.now). resume 시 dt 만큼 보정. */
  private currentPhaseStartedAt = 0;
  /** 현재 phase 의 총 길이 ms. resume 시 남은 시간을 계산해 fireTick 을 다시 발사. */
  private currentPhaseDurationMs = 0;
  /** 현재 phase 가 자연 종료될 때 호출할 콜백(다음 plan 진입). 단일 모드는 null. */
  private currentPhaseOnEnd: (() => void) | null = null;
  /** 현재 phase 의 fireTick 함수 — pause 후 resume 시 다시 setTimeout 으로 발사한다. */
  private currentTickFire: (() => void) | null = null;
  /** 현재 phase 의 beat 간격(ms). resume 시 다음 fireTick 까지의 setTimeout 지연. */
  private currentBeatMs = 0;
  /**
   * 현재 phase 가 schedule 기반 자극(MEMORY SHOW/RECALL 시퀀스)에 의존하는지 여부.
   *
   * - FOCUS/JUDGMENT/AGILITY/COMPREHENSION/RHYTHM 은 매 박자마다 호출되는
   *   `fireTick` 안에서 자극을 점등하므로, pause 가 `pendingTimers` 를 비워도
   *   resume 시 `currentTickFire` 만 setTimeout 으로 다시 예약하면 다음 박자부터
   *   정상 자극이 이어진다.
   * - MEMORY phase 는 SHOW/RECALL 의 모든 점등·전환 콜백이 `schedule()` →
   *   `pendingTimers` 에 등록되며 `fireTick` 자체는 점등을 만들지 않는다.
   *   pause 가 그 timer 들을 일괄 cancel 하면 resume 시 SHOW/RECALL 자극이 통째로
   *   사라진다(현재 사이클이 phase 종료까지 무자극으로 흐른다).
   *   → resume 에서 이 플래그가 true 면 잔여시간만큼 `startTickLoop` 를 다시
   *     호출해 phase 자체를 재시작한다 (시퀀스가 새로 뽑히되 phase 종료 시각은
   *     원래대로 유지).
   */
  private currentPhaseScheduleBased = false;

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
          bpm: clampBpmForBle(this.cfg.bpm),
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
        bpm: clampBpmForBle(this.cfg.bpm),
        level: this.cfg.level,
        phase: SESSION_PHASE_COGNITIVE,
        durationSec: Math.round(this.cfg.totalDurationMs / 1000),
      });
      bleWriteControl(CTRL_START);
      this.cfg.onPhaseChange({ phase: 'COGNITIVE', cognitiveMode: this.currentCognitiveMode, cycleIndex: 0 });
      this.startTickLoop(this.cfg.totalDurationMs);
    }

    // elapsed 표시용 RAF
    this.startElapsedRaf();
  }

  /**
   * 전체 세션 elapsed RAF 루프를 시작한다. start() 와 resume() 둘 다에서 호출되며,
   * 일시정지 중(isPaused=true) 또는 destroyed 면 즉시 멈춘다.
   * - elapsed = Date.now() - this.startedAt (resume 이 startedAt 을 dt 만큼 뒤로 미루면
   *   진행률이 일시정지 시간만큼 멈춘 것처럼 보인다)
   * - elapsed >= totalDurationMs 도달 시 complete() 호출.
   */
  private startElapsedRaf(): void {
    const tickElapsed = () => {
      if (this.destroyed || this.isPaused) {
        this.rafId = null;
        return;
      }
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
      // 회복 구간이 열려 있으면 누적 시간을 마감해 메트릭에서 누락되지 않게 한다.
      // (destroy 직후에도 누군가 buildMetrics 를 직접 호출할 수 있으므로 안전망)
      if (this.inRecoveryWindow) this.endRecoveryWindow();
      // 중도 취소(언마운트/백그라운드 등) — 펌웨어 STOP 인지 시점에 의존하지 않도록
      // 1) 켜져 있던 Pod에 LED OFF 프레임을 먼저 보내 즉시 소등을 보장하고,
      // 2) 그 다음 CONTROL_STOP을 보낸다.
      // bleWriteLed/bleWriteControl는 네이티브 미연결(웹/Replit)에서는 자동 no-op.
      for (const p of this.pods) {
        if (p.fill !== 'OFF') {
          this.bleOffPod(p.id, p.tickId);
        }
      }
      bleWriteControl(CTRL_STOP);
    }
    this.destroyed = true;
    if (this.rafId) window.cancelAnimationFrame(this.rafId);
    if (this.tickTimer) window.clearTimeout(this.tickTimer);
    if (this.phaseTimer) window.clearTimeout(this.phaseTimer);
    this.pendingTimers.forEach((t) => window.clearTimeout(t));
    this.pendingTimers = [];
  }

  /**
   * 세션을 정상 종료(complete)와 동일한 경로로 즉시 마감한다.
   * - 켜져 있던 Pod LED OFF + CONTROL_STOP 송신
   * - 누적된 메트릭으로 buildMetrics() 호출 → onComplete 통보 (호출 측이 결과 화면으로 이동)
   *
   * 자연 종료(시간 경과)는 여전히 내부 RAF가 complete()를 부르고, 본 메서드는 백그라운드
   * 진입처럼 외부에서 즉시 마감해야 하는 케이스 전용 진입점이다. 이미 종료된 엔진에는
   * no-op (complete 안의 destroyed 가드).
   */
  endNow(): void {
    this.complete();
  }

  /**
   * BLE 단절 → 자동 재연결 회복 구간 시작을 엔진에 알린다.
   *
   * 정책:
   *   - 회복 중에는 새 자극을 점등하지 않는다 (LED 프레임이 디바이스에 도달하지
   *     않을 가능성이 높고, 사용자도 입력할 수 없으므로).
   *   - 분모(타겟 카운트 등)/누락(omission)이 발생하지 않아 점수에 불이익이
   *     쌓이지 않는다.
   *   - 켜져 있던 Pod는 즉시 OFF 처리해 화면을 정리한다 (BLE OFF 프레임은
   *     소켓 단절 시 도달 보장이 없지만 UI 상태는 일관되게 유지).
   *
   * 같은 회복 구간이 여러 신호로 중복 통보되어도 최초 호출 시점만 유지한다
   * (멱등). 엔진이 이미 종료됐으면 no-op.
   */
  beginRecoveryWindow(): void {
    if (this.destroyed || this.inRecoveryWindow) return;
    this.inRecoveryWindow = true;
    this.recoveryEnteredAt = Date.now();
    // 결과 화면 타임라인용 — 시작 시각은 세션 시작으로부터의 경과 ms 로 기록.
    // 종료(endRecoveryWindow) 시점에 마지막 항목의 durationMs 를 채워 넣는다.
    const elapsedAtStart = Math.max(0, this.recoveryEnteredAt - this.startedAt);
    this.acc.recoveryWindows.push({ startedAt: elapsedAtStart, durationMs: 0 });
    // 켜져 있던 자극은 정리 — 사용자가 채점되지 않을 점등을 입력하려 시도하지
    // 않게 한다. allOff 가 자체적으로 BLE OFF 프레임을 송신.
    this.allOff();
  }

  /**
   * 회복 구간 종료(재연결 성공 또는 그레이스 만료) 알림.
   * - 누적 회복 시간을 acc.recoveryMs 에 더한다 → buildMetrics 가 채점 제외 시간으로 노출.
   * - 직전 beginRecoveryWindow 가 push 한 segment 의 durationMs 를 채워 결과 화면이
   *   "언제/얼마나" 끊겼는지 보여줄 수 있게 한다 (Task #36).
   * - 회복 중이 아니면 no-op (멱등).
   */
  endRecoveryWindow(): void {
    if (this.destroyed || !this.inRecoveryWindow) return;
    const dur = Math.max(0, Date.now() - this.recoveryEnteredAt);
    this.acc.recoveryMs += dur;
    const last = this.acc.recoveryWindows[this.acc.recoveryWindows.length - 1];
    if (last) last.durationMs = dur;
    this.inRecoveryWindow = false;
    this.recoveryEnteredAt = 0;
  }

  /**
   * 외부(트레이닝 화면)에서 BLE 단절 빈도/누적 시간을 조회하기 위한 스냅샷.
   * - windows: 지금까지 시작된 회복 구간의 총 횟수(현재 구간 포함).
   * - totalMs: 종료된 구간들의 누적 시간 + 현재 진행 중 구간의 경과 시간.
   * 화면은 이 값으로 "단절이 너무 잦다"는 부드러운 안내(토스트)를 1회 띄우는
   * 임계치 판정에 사용한다 (Task #38).
   */
  getRecoveryStats(): { windows: number; totalMs: number } {
    const ongoing = this.inRecoveryWindow
      ? Math.max(0, Date.now() - this.recoveryEnteredAt)
      : 0;
    return {
      windows: this.acc.recoveryWindows.length,
      totalMs: this.acc.recoveryMs + ongoing,
    };
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
        bpm: clampBpmForBle(this.cfg.bpm),
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
    // 내부 tick 주기 계산도 BPM 안전벨트(60~200)를 거친 값으로. cfg.bpm 이
    // 어떤 경로로든 0/Infinity/NaN 으로 들어오면 60_000/bpm 가 NaN 이 되어
    // tick 루프가 멈춘다. Math.max(120, …) 가 NaN 을 잡지 못하므로 입력
    // 단계에서 clamp 해 두는 것이 안전.
    const beatMs = Math.max(120, Math.round(60_000 / clampBpmForBle(this.cfg.bpm)));
    const tickInterval = beatMs; // 1 beat = 1 tick
    // pause/resume 시 보정/재시작에 사용 — 클로저 const 가 아닌 인스턴스 필드로 보존.
    this.currentPhaseStartedAt = Date.now();
    this.currentPhaseDurationMs = durationMs;
    this.currentPhaseOnEnd = onPhaseEnd ?? null;
    this.currentBeatMs = beatMs;
    const segIsRhythm =
      (this.cfg.isComposite || this.cfg.mode === 'COMPOSITE') &&
      this.compositePlan[this.currentPlanIdx]?.type === 'RHYTHM';
    // pause/resume 정합성 — MEMORY phase 만 schedule 기반(SHOW/RECALL 콜백이
    // pendingTimers 에 모두 들어간다). 그 외는 fireTick 안에서 매 박자 점등.
    this.currentPhaseScheduleBased =
      !segIsRhythm && this.currentCognitiveMode === 'MEMORY';

    // MEMORY는 SHOW 단계 먼저 → RECALL
    if (!segIsRhythm && this.currentCognitiveMode === 'MEMORY') {
      this.memoryQueue = [];
      this.memoryReplay = [];
      this.memoryPhase = 'SHOW';
      const seqLen = clamp(this.cfg.level + 2, 3, 6);
      this.acc.mTotalSeqs += 1;
      this.acc.mShown += seqLen;
      // 시퀀스 보여주기: tickInterval 마다 하나씩 (destroy 시 정리)
      // 명세 A.MEMORY: Lv1~2 는 연속 동일 Pod 금지 (학습 진입 부담 완화)
      const banConsecutive = this.cfg.level <= 2;
      let prevPod = -1;
      // 첫 점등은 START(aa 55) 이후 FIRST_TICK_DELAY_MS 만큼 기다린다 — 다른 모드의
      // fireTick 첫 호출과 같은 마진을 부여해, NUS 계열 펌웨어가 START 처리 도중
      // 들어온 LED 프레임을 잃어버리지 않도록 한다(handleTestBlink 와 동일 정책).
      for (let i = 0; i < seqLen; i++) {
        let podId = Math.floor(Math.random() * this.cfg.podCount);
        if (banConsecutive && this.cfg.podCount > 1 && podId === prevPod) {
          podId = (podId + 1) % this.cfg.podCount;
        }
        prevPod = podId;
        this.memoryQueue.push(podId);
        this.schedule(() => {
          this.lightSinglePod(podId, 'GREEN', tickInterval * 0.6);
        }, FIRST_TICK_DELAY_MS + i * tickInterval);
      }
      // SHOW 끝나면 RECALL로 전환 (모든 Pod WHITE 신호)
      const showEnd = FIRST_TICK_DELAY_MS + seqLen * tickInterval;
      this.schedule(() => {
        this.memoryPhase = 'RECALL';
        this.memoryRecallStartedAt = Date.now();
        this.memoryLastTapAt = 0;
        this.allOff();
        // WHITE 입력 신호 — Pod별 monotonic tickId 부여 + BLE 점등
        // 명세 A.MEMORY: Recall 입력 시간 = on_ms + 250ms (시퀀스 길이만큼 누적)
        const onMsPerStep = defaultOnMsForLevel(this.cfg.level) + 250;
        const recallWindow = onMsPerStep * seqLen;
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
      // phaseStart/durationMs/onPhaseEnd 는 인스턴스 필드를 사용한다 — pause/resume 가
      // currentPhaseStartedAt 을 dt 만큼 뒤로 미루면 elapsedInPhase 가 자연스럽게 보정된다.
      const elapsedInPhase = Date.now() - this.currentPhaseStartedAt;
      if (elapsedInPhase >= this.currentPhaseDurationMs) {
        this.allOff();
        if (this.currentPhaseOnEnd) this.currentPhaseOnEnd();
        return;
      }
      // BLE 단절 회복 중에는 새 자극을 점등하지 않는다 (Task #27).
      // tick 스케줄러는 계속 돌아 회복이 끝나는 즉시 다음 박부터 다시 점등.
      // 자연 종료(시간 경과)는 위 elapsedInPhase 가드에서 처리되므로 채점 제외
      // 시간만큼 세션이 길어지지 않는다 (회복 중에도 phase clock 은 흘러간다).
      if (this.inRecoveryWindow) {
        this.tickTimer = window.setTimeout(fireTick, tickInterval);
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
    // pause 후 resume 시 같은 fireTick 을 재호출할 수 있도록 인스턴스 필드에 보존.
    this.currentTickFire = fireTick;
    // 첫 tick은 살짝 딜레이(준비). 디바이스 점등 진단의 START→LED 마진과 동일하게 두어
    // NUS 계열 펌웨어가 START(`aa 55`) 를 처리할 충분한 시간을 보장한다.
    this.tickTimer = window.setTimeout(fireTick, FIRST_TICK_DELAY_MS);
  }

  // ───── 일시정지 / 재개 ────────────────────────────────────────────────
  /**
   * 사용자의 명시적 "일시정지" 요청. 점등을 즉시 멈추고 모든 timer/RAF 를 cancel 한다.
   * - LED OFF 프레임 송신 후 CONTROL_STOP 으로 펌웨어에도 정지를 알린다.
   * - phase clock 은 멈추므로 재개 시 같은 지점에서 이어진다.
   * - 회복 구간이 열려 있었다면 누적을 마감한다(채점 제외 시간 정합성 유지).
   * - 이미 destroyed/isPaused 면 no-op (멱등).
   */
  pause(): void {
    if (this.destroyed || this.isPaused) return;
    if (this.inRecoveryWindow) this.endRecoveryWindow();
    // 켜져 있던 LED 모두 OFF (BLE OFF 프레임 송신 포함).
    this.allOff();
    // 모든 timer/RAF cancel — destroy 와 달리 destroyed=true 로 만들지 않는다.
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.tickTimer) {
      window.clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.phaseTimer) {
      window.clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }
    this.pendingTimers.forEach((t) => window.clearTimeout(t));
    this.pendingTimers = [];
    // 펌웨어에 정지 통보 — 재개 시 다시 START 를 보낼 것이다.
    bleWriteControl(CTRL_STOP);
    this.pausedAt = Date.now();
    this.isPaused = true;
  }

  /**
   * 일시정지에서 복귀. pause 동안 흐른 시간(dt)만큼 시간 기준점들을 뒤로 미뤄
   * 마치 그 시간이 흐르지 않은 것처럼 보이게 한다.
   * - startedAt, currentPhaseStartedAt, memoryRecallStartedAt, memoryLastTapAt,
   *   switchedAt, lastTapAt.ts 모두 +dt.
   * - 펌웨어에 START 재송신, RAF/tick 루프 재시작.
   * - 남은 phase 시간이 0 이하이면 즉시 onPhaseEnd 또는 complete 호출.
   * - 호출 전 destroyed/!isPaused 이면 no-op.
   */
  resume(): void {
    if (this.destroyed || !this.isPaused) return;
    const dt = Math.max(0, Date.now() - this.pausedAt);
    this.startedAt += dt;
    if (this.currentPhaseStartedAt > 0) this.currentPhaseStartedAt += dt;
    if (this.memoryRecallStartedAt > 0) this.memoryRecallStartedAt += dt;
    if (this.memoryLastTapAt > 0) this.memoryLastTapAt += dt;
    if (this.switchedAt > 0) this.switchedAt += dt;
    if (this.lastTapAt) this.lastTapAt.ts += dt;
    this.isPaused = false;
    this.pausedAt = 0;
    // 펌웨어 재시작 — pause 시점에 STOP 을 보냈으므로 다시 START 가 필요하다.
    bleWriteControl(CTRL_START);
    // elapsed RAF 재시작.
    this.startElapsedRaf();
    // 자극 루프 재개 — 남은 phase 시간이 양수면 다음 fireTick 을 setTimeout 으로 발사.
    if (this.currentTickFire && this.currentPhaseDurationMs > 0) {
      const elapsedInPhase = Date.now() - this.currentPhaseStartedAt;
      const remaining = this.currentPhaseDurationMs - elapsedInPhase;
      if (remaining <= 0) {
        // 일시정지 사이에 phase 가 자연 종료될 시간(= dt 가 매우 클 때)에 도달.
        // onPhaseEnd 가 등록돼 있으면 다음 plan 으로, 아니면 complete.
        const onEnd = this.currentPhaseOnEnd;
        if (onEnd) onEnd();
        else this.complete();
        return;
      }
      // MEMORY 처럼 schedule 기반 phase 는 pendingTimers 가 통째로 끊겨 SHOW/RECALL
      // 자극이 사라진 상태이므로, 단순 fireTick 재예약으로는 자극이 복구되지 않는다.
      // → 잔여시간만큼 phase 자체를 재시작해 SHOW 시퀀스부터 다시 흘려보낸다.
      //   phase 종료 시각은 그대로 유지되고, MEMORY 카운트 누적은 점등-전용 모드에서
      //   채점 의미가 없으므로 무시한다.
      if (this.currentPhaseScheduleBased) {
        const onEnd = this.currentPhaseOnEnd ?? undefined;
        this.startTickLoop(remaining, onEnd);
        return;
      }
      // 다음 fireTick 까지의 지연은 한 박자 정도로 두어 즉시 깜박이지 않게 한다.
      const delay = Math.max(120, Math.min(this.currentBeatMs || 350, 350));
      this.tickTimer = window.setTimeout(this.currentTickFire, delay);
    }
  }

  /** 외부 화면(테스트/디버그용)에서 현재 일시정지 상태를 조회. */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  // ───── 모드별 tick 점등 ─────────────────────────────────────────────
  private fireRhythmTick(beatMs: number): void {
    // 기획 v2.0: 레벨별 RHYTHM 패턴 (rhythmStepsForBeat) 사용
    const steps = rhythmStepsForBeat(this.cfg.level, this.rhythmStep);
    this.rhythmStep += 1;
    if (steps.length === 0) return; // 쉬는 박
    // Lv4/Lv5는 한 박 안에 정박(offset 0)과 8분 뒷박(offset 0.5)을 함께 점등한다.
    // 점등 길이를 박의 40%로 제한해 두 점등 사이(0.40→0.50)와 뒷박 종료 후 다음 박
    // 정박 시작 사이(0.90→1.00)에 각각 ~10%의 안전 마진을 확보한다. 빠른 BPM에서도
    // 타이머 지터(±수 ms)가 누적될 때 두 점등이 겹치거나 한쪽이 사라져 보이는 일을
    // 막아 박자감을 유지한다. 80ms 하한은 시인성 보정용이며 지원 BPM 범위(60~140)에서는
    // 항상 40% 비율을 만족한다 (BPM ≤ 187.5 까지 안전).
    // 관련 정책: shared/training-spec.rhythmStepsForBeat 의 "점등 지속시간 정책".
    const onMs = Math.max(80, beatMs * 0.40);
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
    // 명세 C.FOCUS: Lv3+ 는 타겟+방해 동시 점등 (방해 자극 속에서 타겟만 선택)
    const allowSimul = this.cfg.level >= 3 && this.cfg.podCount >= 2;
    if (allowSimul && Math.random() < 0.3) {
      // 타겟 1 + 방해 1 동시 점등 (서로 다른 Pod)
      const tPod = Math.floor(Math.random() * this.cfg.podCount);
      let dPod = Math.floor(Math.random() * this.cfg.podCount);
      if (dPod === tPod) dPod = (dPod + 1) % this.cfg.podCount;
      const distractor: LogicColor = Math.random() < 0.5 ? 'RED' : 'YELLOW';
      this.acc.fTargetCount += 1;
      this.acc.fDistractorCount += 1;
      this.recordIntervalCount('total', this.elapsedMs(), 1);
      this.lightTwoPods(tPod, 'BLUE', dPod, distractor, beatMs * 0.9, true);
      return;
    }
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
  /**
   * 디바이스 LED 단일 Pod 즉시 소등 송신.
   * onMs=0 + colorCode=OFF 컨벤션 (정본: docs/firmware/led-off-convention.md)
   * - 펌웨어가 잔여 onMs를 무시하고 LED를 즉시 끈다.
   * - tickId는 마지막 점등의 tickId를 그대로 사용해 펌웨어가 같은 점등에
   *   대한 OFF임을 식별할 수 있게 한다(0이면 새 tickId 발급).
   */
  private bleOffPod(podId: number, lastTickId: number): void {
    const tickId = lastTickId > 0 ? lastTickId : this.nextTickId();
    // OFF 프레임은 손실되면 잔상이 남으므로 ack 보장(withResponse) 모드로 송신.
    // 일반 점등 프레임은 저지연 우선이라 기본 'auto'를 유지한다.
    bleWriteLed({
      tickId,
      pod: podId,
      colorCode: COLOR_CODE.OFF,
      onMs: 0,
      mode: 'withResponse',
    });
  }

  private allOff(): void {
    // 켜져 있던 Pod 각각에 대해 디바이스 LED OFF 프레임 송신.
    // (이미 OFF인 Pod에는 보내지 않아 BLE 트래픽을 줄인다.)
    for (const p of this.pods) {
      if (p.fill !== 'OFF') {
        this.bleOffPod(p.id, p.tickId);
      }
    }
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
   * @returns true: 입력이 실제로 채점에 반영됨 / false: stale/중복/소등 상태로 무시됨
   *          (UI 카운터 증분 여부 판단용)
   */
  handleTap(podId: number, opts?: { deltaMs?: number; tickId?: number }): boolean {
    if (this.destroyed) return false;
    const now = Date.now();
    const pod = this.pods.find(p => p.id === podId);
    if (!pod || pod.fill === 'OFF') return false;

    // BLE에서 명시 tickId가 왔는데 현재 pod의 점등 tickId와 다르면 stale (구 tick의 지연 입력) → drop.
    // UI tap은 tickId 미지정이므로 항상 현재 pod.tickId 기준으로 처리.
    if (opts?.tickId && opts.tickId > 0 && pod.tickId > 0 && opts.tickId !== pod.tickId) {
      return false; // stale BLE TOUCH
    }
    // 중복 처리 차단 — UI(브릿지된 클릭) + BLE TOUCH 동시 도착 케이스
    const expectedTickId = pod.tickId > 0 ? pod.tickId : (opts?.tickId ?? 0);
    if (expectedTickId > 0) {
      const key = `${podId}:${expectedTickId}`;
      if (this.consumedTickIds.has(key)) return false;
      this.consumedTickIds.add(key);
      // 장시간 세션에서 무한히 자라지 않도록 상한(8192) 초과 시 가장 오래된 키부터 prune
      if (this.consumedTickIds.size > 8192) {
        const it = this.consumedTickIds.values().next();
        if (!it.done) this.consumedTickIds.delete(it.value);
      }
    }

    const elapsedTotal = this.elapsedMs();

    const segIsRhythm =
      (this.cfg.isComposite || this.cfg.mode === 'COMPOSITE') &&
      this.compositePlan[this.currentPlanIdx]?.type === 'RHYTHM';

    if (segIsRhythm) {
      this.handleRhythmTap(pod, now, opts?.deltaMs);
      return true;
    }

    // 더블탭 처리 (JUDGMENT YELLOW)
    // 명세 D.JUDGMENT: 더블탭 윈도우 = min(700ms, 0.9*beat_ms)
    let isDoubleTap = false;
    const dblWindowMs = judgmentDoubleTapWindowMs(this.cfg.bpm);
    if (this.lastTapAt && this.lastTapAt.podId === podId && (now - this.lastTapAt.ts) <= dblWindowMs) {
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
    return true;
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
    // 다음 점등을 위해 끄기 — 화면 UI와 디바이스 LED를 동기 소등
    this.bleOffPod(pod.id, pod.tickId);
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
    const isHit = expected === pod.id;
    if (isHit) {
      this.acc.mCorrect += 1;
    }
    // 실제 RT: 첫 입력은 RECALL 시작 시각 대비, 이후는 직전 입력 대비 시간
    const refTs = this.memoryLastTapAt || this.memoryRecallStartedAt || now;
    const rt = Math.max(0, now - refTs);
    if (rt > 0) this.acc.mRTs.push(rt);
    this.memoryLastTapAt = now;
    // 명세 A.MEMORY: Lv3+ 는 오입력 시 즉시 해당 사이클 실패
    if (!isHit && this.cfg.level >= 3) {
      this.memoryPhase = 'SHOW';
      this.memoryReplay = [];
      this.memoryQueue = [];
      this.allOff();
      return;
    }
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
    // 종료 시점에 회복 구간이 열려 있으면 마감해 누적 시간이 메트릭에 반영되게 한다.
    if (this.inRecoveryWindow) this.endRecoveryWindow();
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
        // 부분 저장 시 Late 구간(200~300s) 표본이 1~2개에 그칠 수 있어
        // 결과 화면이 신뢰도 안내를 띄우고, 점수 산식이 Late 의존 항을 제외할 수 있게
        // 표본 수를 함께 노출한다 (Task #54).
        lateSampleCount: a.lateRTs.length,
      },
      recovery: {
        excludedMs: Math.max(0, Math.round(a.recoveryMs)),
        windows: a.recoveryWindows.length,
        // 결과 화면(Result.tsx)이 회복 구간 타임라인/평균/최장 끊김을 보여주기
        // 위해 세그먼트 배열을 함께 노출 (Task #36). 정수 ms 로 정규화한다.
        segments: a.recoveryWindows.map((w) => ({
          startedAt: Math.max(0, Math.round(w.startedAt)),
          durationMs: Math.max(0, Math.round(w.durationMs)),
        })),
      },
    };
  }
}

export const TOTAL_COMPOSITE_MS = COMPOSITE_TOTAL_MS;
