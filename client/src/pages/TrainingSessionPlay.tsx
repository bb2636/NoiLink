/**
 * 트레이닝 진행 화면 — 가상 Pod 게임 엔진 기반
 *
 * - 4개 가상 Pod 그리드, BPM 박자에 맞춰 점등
 * - 모드별 룰(FOCUS/MEMORY/COMPREHENSION/JUDGMENT/AGILITY/ENDURANCE/COMPOSITE/RHYTHM/FREE) 실시간 진행
 * - 종료 시 엔진이 산출한 원시 메트릭을 서버로 제출
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import ConfirmModal from '../components/ConfirmModal/ConfirmModal';
import PodGrid from '../components/PodGrid/PodGrid';
import SuccessBanner from '../components/SuccessBanner/SuccessBanner';
import type { Level, NativeToWebMessage, RawMetrics, Session, TrainingMode } from '@noilink/shared';
import { SESSION_MAX_MS, partialThresholdForMode, resolveBleStabilityThresholds } from '@noilink/shared';
import api from '../utils/api';
import { submitCompletedTrainingWithRetry } from '../utils/submitTrainingRun';
import { createPendingLocalId, enqueuePendingRun } from '../utils/pendingTrainingRuns';
import { reportBleAbortFireAndForget } from '../utils/reportBleAbort';
import { TrainingEngine, type EnginePhaseInfo, type PodState } from '../training/engine';
import { bleReconnectNow, bleSubscribeCharacteristic, bleUnsubscribeCharacteristic } from '../native/bleBridge';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { subscribeAckErrorBanner } from '../native/nativeAckErrors';
import { isBleUnstableForAbort, type TrainingAbortReason } from './trainingAbortReason';

/**
 * 백그라운드 중단 시 부분 결과 저장을 제안하는 진행률 임계값은 모드별로 다르다.
 * 단일 출처는 `shared/training-spec` 의 `partialThresholdForMode(mode)` 이며,
 * 본 화면은 그 값을 그대로 참조한다. 모드별 사유 요약:
 *  - ENDURANCE 0.90: Late 구간(200~300s)이 점수의 핵심이라 90% 미만은 표본이 비어 의미 없음.
 *  - FOCUS / JUDGMENT 0.60: 자극이 균질해 60%만 진행해도 표본이 충분.
 *  - COMPOSITE 0.80: 5사이클 중 4사이클(=80%) 이상이어야 6대 지표가 어느 정도 순환.
 *  - 그 외 (MEMORY/COMPREHENSION/AGILITY/FREE) 0.80 기본값.
 */

/**
 * BLE 단절이 잦을 때 사용자에게 환경 점검을 부드럽게 권하는 토스트의 임계값 (Task #38).
 * 회복 구간이 시작/종료되는 흐름은 이미 채점에서 제외되지만, 사용자에게는 별도
 * 안내가 없어 "기기가 이상하다"는 인상만 남는다. 다음 두 임계 중 하나만 충족해도
 * 한 세션에 한 번 토스트를 띄운다:
 *  - 회복 구간 누적 횟수 ≥ windowThreshold
 *  - 회복 구간 누적 시간 ≥ msThreshold
 * 임계값은 `@noilink/shared`의 `resolveBleStabilityThresholds()` 가 사용자/디바이스
 * 컨텍스트로 결정하며 (Task #44), 결과 화면 회복 배너와 동일한 노란 톤
 * (#3A2A00 / #FFD66B) + 동일한 어휘("기기 연결" / "거리·간섭")로 일관된 경험을 준다.
 */

/**
 * 재연결 진행 상황 스냅샷 — 네이티브의 ble.reconnect 페이로드 + 수신 시각.
 * receivedAt 은 nextDelayMs 만료까지 남은 시간을 카운트다운하는 데 사용한다.
 */
type ReconnectInfo = {
  attempt: number;
  maxAttempts: number;
  nextDelayMs?: number;
  receivedAt: number;
};

export type TrainingRunState = {
  catalogId: string;
  apiMode: TrainingMode;
  userId: string;
  title: string;
  totalDurationSec: number;
  bpm: number;
  level: Level;
  yieldsScore: boolean;
  isComposite: boolean;
};

const PHASE_LABEL: Record<string, string> = {
  IDLE: '준비',
  RHYTHM: '리듬 유지',
  COGNITIVE: '인지 과제',
  DONE: '완료',
};

const COG_LABEL: Record<TrainingMode, string> = {
  MEMORY: '기억력',
  COMPREHENSION: '이해력',
  FOCUS: '집중력',
  JUDGMENT: '판단력',
  AGILITY: '순발력',
  ENDURANCE: '지구력',
  COMPOSITE: '종합',
  FREE: '자유',
};

export default function TrainingSessionPlay() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as TrainingRunState | null;

  const totalSec = state ? Math.min(state.totalDurationSec, SESSION_MAX_MS / 1000) : 0;
  const totalMs = totalSec * 1000;

  const [pods, setPods] = useState<PodState[]>(
    Array.from({ length: 4 }, (_, i) => ({
      id: i, fill: 'OFF', isTarget: false, litAt: null, expiresAt: null, tickId: 0,
    }))
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [phaseInfo, setPhaseInfo] = useState<EnginePhaseInfo>({ phase: 'IDLE', cycleIndex: 0 });
  const [tapCount, setTapCount] = useState(0);
  const [engineMetrics, setEngineMetrics] = useState<Omit<RawMetrics, 'sessionId' | 'userId'> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 백그라운드 중단이 임계값 이상에서 발생했을 때만 띄우는 "부분 결과 저장" 모달.
  // partialProgressPct는 모달에 노출하는 안내용 진행률(반올림된 정수 %).
  const [partialFinishOpen, setPartialFinishOpen] = useState(false);
  const [partialProgressPct, setPartialProgressPct] = useState(0);

  const engineRef = useRef<TrainingEngine | null>(null);
  const submitLock = useRef(false);
  // finalizeNow는 visibilitychange/pagehide 콜백 안에서 호출되므로 React 클로저가
  // 캡처한 elapsedMs가 stale할 수 있다. 가장 최근 진행 시간을 ref로 동기 추적해
  // 임계값 판정에 사용한다.
  const elapsedMsRef = useRef(0);

  // BLE 단절 → 재연결 그레이스 기간. 짧은 신호 단절(예: 2~3초)에서는 즉시 종료하지 않고
  // 임시 안내만 띄운다. 네이티브의 자동 재연결 백오프는 1s/2s/4s 총 ~7s 이므로
  // 그보다 약간 긴 안전 타임아웃(8s)을 두고, 그 안에 'connected'가 다시 오면 그대로 진행한다.
  // 'retry-failed' 사유로 최종 실패가 통보되면 즉시 종료한다.
  const BLE_RECONNECT_GRACE_MS = 8000;
  const [bleReconnecting, setBleReconnecting] = useState(false);
  // 네이티브가 보내는 ble.reconnect 페이로드(시도 회수/총 시도/다음 시도까지 대기시간)를
  // 그대로 보관해 배너에 "재연결 시도 2/3 · 4초 후 재시도" 같은 구체 안내를 노출한다.
  // receivedAt 으로 nextDelayMs 만료까지 남은 시간을 계산한다.
  const [reconnectInfo, setReconnectInfo] = useState<ReconnectInfo | null>(null);
  const [secondsUntilNextAttempt, setSecondsUntilNextAttempt] = useState<number | null>(null);
  // "지금 다시 시도" 버튼을 눌러 즉시 재시도 요청을 네이티브에 보낸 직후 일시적으로
  // true. 다음 ble.reconnect 이벤트(=새 attempt 알림)가 도착하면 false로 자동 복귀.
  // - 빠른 더블 클릭으로 동일 요청을 두 번 보내는 것을 막는다.
  // - 카운트다운 0초 시점(=실제 connectToDevice 진행 중)도 별도로 비활성화 조건이지만,
  //   이 플래그는 그 사이의 짧은 race(클릭 → 250ms 틱 갱신)도 함께 막아준다.
  const [manualRetryInFlight, setManualRetryInFlight] = useState(false);
  // BLE 단절이 잦을 때 1회만 노출하는 안내 토스트 (Task #38).
  // bleStabilityNoticeShownRef 는 한 세션 내 중복 노출을 막는 영속 플래그
  // (사용자가 토스트를 닫아도 다시 뜨지 않는다 — 한 세션에 정확히 한 번).
  const [bleStabilityNoticeOpen, setBleStabilityNoticeOpen] = useState(false);
  const bleStabilityNoticeShownRef = useRef(false);
  // 트레이닝 도중 브릿지가 web→native 메시지를 거부하면(`native.ack.ok=false`)
  // 화면에는 아무 변화가 없어 사용자/QA 가 사유를 알 수 없다 (Task #77).
  // 짧은 토스트로 한국어 안내 + 디버그 키 (`type:reason@field`) 를 함께 노출한다.
  const [ackErrorBanner, setAckErrorBanner] = useState<string | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // 부분 진행분(createSession 까지 성공했지만 metrics 단계가 실패한 케이스) 보존용.
  // 이후 화면 내 재시도, 그리고 화면을 떠난 뒤 큐에 적재될 때 활용된다.
  const partialSessionIdRef = useRef<string | undefined>(undefined);
  // 화면 내 자동 재시도 + 사용자의 수동 재시도까지 누적된 시도 횟수.
  // 화면을 떠나며 큐에 적재할 때 다음 백그라운드 drain 의 시도 한도 계산에 사용된다.
  const accumulatedAttemptsRef = useRef(0);
  // 한 트레이닝 결과를 식별하는 안정 키. 세션 시작 시 1회 발급해, 화면 내 자동·수동 재시도와
  // 화면을 떠난 뒤 큐에 적재되는 항목까지 동일 키로 흐르게 한다.
  // → 서버 idempotency 가 같은 키의 두 번째 요청을 첫 응답으로 흡수해 트레이닝이
  //   두 번 저장되는 것을 막는다.
  const localIdRef = useRef<string>(createPendingLocalId());

  // ── 가드: 잘못된 진입은 목록으로 ──
  useEffect(() => {
    if (!state || !state.userId || totalSec <= 0) {
      navigate('/training', { replace: true });
    }
  }, [state, totalSec, navigate]);

  // ack(ok=false) 구독 — 트레이닝 도중 BLE write/connect 가 거부되어도 화면은
  // 조용히 보일 수 있으므로, 한국어 안내 + 디버그 키를 짧은 토스트로 노출한다 (Task #77).
  // 같은 사유가 짧은 시간 안에 반복 거부되면 카운터만 올려 토스트 깜빡임을 막는다 (Task #106).
  useEffect(() => {
    return subscribeAckErrorBanner(setAckErrorBanner);
  }, []);

  // ── 엔진 lifecycle ──
  useEffect(() => {
    if (!state) return;
    const engine = new TrainingEngine({
      mode: state.apiMode,
      bpm: state.bpm,
      level: state.level,
      totalDurationMs: totalMs,
      podCount: 4,
      isComposite: state.isComposite || state.apiMode === 'COMPOSITE',
      onPodStates: (s) => setPods(s),
      onElapsedMs: (ms) => {
        elapsedMsRef.current = ms;
        setElapsedMs(ms);
      },
      onPhaseChange: (info) => setPhaseInfo(info),
      onComplete: (m) => setEngineMetrics(m),
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 비정상 종료 공통 처리 ──
  // 다양한 사유(백그라운드 진입, BLE 연결 끊김 등)에서 트레이닝을 즉시 종료하고
  // 목록 화면에 안내 배너를 띄운다. 정책:
  //   - LED OFF + CONTROL_STOP을 즉시 보내고 (배터리 보호 + 사용자 직관)
  //   - 결과 화면(/result)으로 가지 않도록 aborted ref가 runSubmit을 차단
  //   - 사유를 navigate state로 전달해 목록 화면이 사유별 1회성 배너를 노출
  //
  // 백그라운드 사유에 한해 추가 분기(Task #16):
  //   거의 끝났던 세션(진행률 ≥ PARTIAL_RESULT_THRESHOLD, 점수 산출 모드)은
  //   곧장 목록으로 돌려보내지 않고 "결과 보러가기 / 그만두기" 모달을 띄워
  //   부분 결과를 살릴 기회를 준다. 이 경로는 finalizeAndAbort 를 호출하지
  //   않고 직접 aborted ref + engine.endNow() 만 처리한다.
  //
  // 가드:
  //   - 이미 결과 흐름(engineMetrics 산출 완료 또는 submitting 중)이면 간섭하지 않는다.
  //     예: 결과 저장 도중 BLE가 끊겨도 결과 흐름을 깨지 않는다.
  //   - aborted 플래그로 idempotent 보장(같은 이벤트가 두 번 와도 한 번만 처리).
  const aborted = useRef(false);
  const finalizeAndAbort = useCallback((reason: TrainingAbortReason) => {
    if (aborted.current) return;
    if (engineMetrics || submitting) return;
    aborted.current = true;
    // BLE 단절 종료에 한해, 회복 누적 통계가 임계 이상이면 목록 화면 배너에
    // 환경 점검 한 줄을 덧붙이도록 navigate state 에 bleUnstable 플래그를 함께 전달
    // (Task #43). 임계 미달이거나 첫 단절 즉시 종료 케이스는 false 가 되어
    // 기존 메시지 그대로 노출된다. 통계는 endNow() 직전에 읽어 진행 중 회복
    // 구간(getRecoveryStats 가 ongoing 시간을 포함)까지 반영되도록 한다.
    const recoveryStats = engineRef.current?.getRecoveryStats();
    const bleUnstable =
      reason === 'ble-disconnect'
        ? isBleUnstableForAbort(recoveryStats)
        : false;
    const eng = engineRef.current;
    if (eng) {
      // LED OFF + CONTROL_STOP + onComplete(메트릭) 발사
      eng.endNow();
      // engineRef는 비우지 않는다 — 이 시점부터는 endNow() 호출이 idempotent.
    }
    // BLE 자동 종료 텔레메트리 (Task #57) — 익명·fire-and-forget.
    // navigate 직전에 호출해야 sendBeacon 이 페이지 unload 전에 큐잉된다.
    if (reason === 'ble-disconnect') {
      reportBleAbortFireAndForget({
        windows: recoveryStats?.windows ?? 0,
        totalMs: recoveryStats?.totalMs ?? 0,
        bleUnstable,
        apiMode: state?.apiMode,
      });
    }
    navigate('/training', {
      replace: true,
      state: { abortReason: reason, bleUnstable },
    });
  }, [engineMetrics, submitting, navigate, state]);

  // ── 앱이 백그라운드로 들어가면 즉시 세션 종료 (네이티브 셸에서만) ──
  //   - 네이티브 셸(WebView) 안에서만 동작. 일반 웹/Replit 미리보기에서는 탭 전환만으로
  //     세션이 종료되지 않도록 핸들러를 아예 등록하지 않는다 (실 디바이스 LED가 없으므로
  //     백그라운드-즉시 종료 정책이 의미 없고, 오히려 평가/디버그를 방해한다).
  //   - 추가 안전망으로 네이티브 측 AppState 핸들러도 STOP을 직접 송신한다
  //     (NativeBridgeDispatcher.ensureAppLifecycleHandlerBound).
  useEffect(() => {
    if (!state) return;
    if (!isNoiLinkNativeShell()) return;
    // 백그라운드 진입은 두 갈래로 분기한다:
    //   (1) 거의 끝났던 점수 산출 세션 (진행률 ≥ partialThresholdForMode(apiMode))
    //       → engine.endNow()로 부분 메트릭만 산출해두고, 화면을 유지한 채
    //         "결과 보러가기 / 그만두기" 모달을 띄운다. finalizeAndAbort 는
    //         호출하지 않으므로 navigate 가 발생하지 않고, aborted ref 가
    //         자동 제출 useEffect 를 막아 사용자 선택을 기다린다.
    //   (2) 그 외 (짧게 끊긴 세션 / 자유 / 점수 비산출 모드)
    //       → 기존 정책대로 finalizeAndAbort('background') 가 LED OFF + 목록
    //         화면 + abortReason 배너 흐름을 일괄 처리한다.
    const onBackground = () => {
      if (aborted.current) return;
      if (engineMetrics || submitting) return;

      // 백그라운드 진입 시점의 진행률을 ref에서 직접 읽어 stale 클로저를 회피.
      const elapsedAtAbort = elapsedMsRef.current;
      const progressRatio = totalMs > 0 ? Math.min(1, elapsedAtAbort / totalMs) : 0;
      const scorable = state.yieldsScore && state.apiMode !== 'FREE';
      const partialThreshold = partialThresholdForMode(state.apiMode);

      if (scorable && progressRatio >= partialThreshold) {
        // 부분 결과 모달 경로: aborted 만 직접 set 하여 자동 제출을 차단하고,
        // 엔진을 즉시 종료해 부분 메트릭(setEngineMetrics)을 산출해둔다.
        aborted.current = true;
        const eng = engineRef.current;
        if (eng) eng.endNow();
        setPartialProgressPct(Math.round(progressRatio * 100));
        setPartialFinishOpen(true);
        return;
      }

      // 짧게 끊긴 세션: 기존 공통 종료 흐름.
      finalizeAndAbort('background');
    };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) return;
      onBackground();
    };
    document.addEventListener('visibilitychange', onVisibility);
    // pagehide는 RN WebView 라이프사이클에서도 페이지 언로드 시 한 번 더 발사된다.
    window.addEventListener('pagehide', onBackground);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onBackground);
    };
  }, [state, totalMs, engineMetrics, submitting, finalizeAndAbort]);

  // ── BLE(NoiPod) 연결이 끊기면 그레이스 기간 후 세션 종료 (네이티브 셸에서만) ──
  // 정책: 짧은 신호 단절은 네이티브가 자동 재연결을 시도하므로(1s/2s/4s 백오프) 즉시 끊지 않고
  // 임시 배너로 "회복 중" 상태를 보여준다. 그 사이에 다시 연결되면 트레이닝을 그대로 이어가고,
  // 최종 재연결 실패('retry-failed') 또는 안전 타임아웃 만료에서만 'ble-disconnect' 사유로 종료한다.
  //
  // 가드:
  //   - reason === 'user' 는 사용자가 직접 디바이스 페이지에서 해제한 케이스인데,
  //     트레이닝 진행 중에는 하단 네비가 가려져 다른 화면으로 갈 수 없으므로 실제로는 발생하지 않는다.
  //     안전을 위해 'user' 는 명시적으로 무시한다.
  //   - 일반 웹/Replit 미리보기에서는 BLE 자체가 없으므로 핸들러를 등록하지 않는다.
  //   - ble.reconnect 알림은 그레이스 기간 동안 배너 유지를 위한 보조 신호로만 사용한다
  //     (별도 추가 동작 없음 — 'connected != null' 또는 'retry-failed'가 최종 신호).
  useEffect(() => {
    if (!state) return;
    if (!isNoiLinkNativeShell()) return;
    const onBridge = (e: Event) => {
      const detail = (e as CustomEvent<NativeToWebMessage>).detail;
      if (!detail) return;
      if (detail.type === 'ble.connection') {
        if (detail.payload.connected !== null) {
          // 재연결 성공 — 그레이스 중이면 배너/타이머/진행정보를 정리하고 트레이닝을 계속 진행한다.
          clearReconnectTimer();
          setBleReconnecting(false);
          setReconnectInfo(null);
          setManualRetryInFlight(false);
          // 회복 구간 종료 알림 — 채점 제외 시간을 누적 마감 (Task #27).
          engineRef.current?.endRecoveryWindow();
          // 단절이 잦으면 환경 점검을 권하는 토스트를 1회만 노출 (Task #38).
          // endRecoveryWindow() 직후이므로 직전 구간의 시간/횟수까지 모두 누적된 상태.
          if (!bleStabilityNoticeShownRef.current) {
            const stats = engineRef.current?.getRecoveryStats();
            if (stats) {
              // 사용자/디바이스 컨텍스트로 임계값 조회 (Task #44).
              // 오버라이드 훅이 등록돼 있지 않으면 shared의 기본값을 그대로 쓴다.
              const { windowThreshold, msThreshold } = resolveBleStabilityThresholds({
                userId: state.userId,
              });
              if (stats.windows >= windowThreshold || stats.totalMs >= msThreshold) {
                bleStabilityNoticeShownRef.current = true;
                setBleStabilityNoticeOpen(true);
              }
            }
          }
          return;
        }
        if (detail.payload.reason === 'user') return;
        if (detail.payload.reason === 'retry-failed') {
          // 자동 재연결이 모두 실패 — 즉시 종료.
          clearReconnectTimer();
          setBleReconnecting(false);
          setReconnectInfo(null);
          setManualRetryInFlight(false);
          // finalizeAndAbort 가 endNow → complete → endRecoveryWindow 안전망을
          // 거치므로 별도 호출 불필요.
          finalizeAndAbort('ble-disconnect');
          return;
        }
        // 'unexpected' (또는 사유 누락) — 그레이스 기간 시작 / 갱신.
        setBleReconnecting(true);
        // 채점에서 회복 구간을 제외하기 위해 엔진에 알린다 (Task #27).
        // 멱등이므로 같은 구간에 여러 신호가 와도 안전.
        engineRef.current?.beginRecoveryWindow();
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          setBleReconnecting(false);
          setReconnectInfo(null);
          setManualRetryInFlight(false);
          finalizeAndAbort('ble-disconnect');
        }, BLE_RECONNECT_GRACE_MS);
        return;
      }
      if (detail.type === 'ble.reconnect') {
        // 재연결 시도 알림 — 배너에 시도 회수와 다음 시도까지 남은 시간을 노출하기 위해
        // 페이로드를 그대로 보관한다. receivedAt 으로 nextDelayMs 카운트다운을 계산한다.
        // 새 attempt 알림은 곧 진행할 시도이므로 "지금 다시 시도" 버튼을 다시 활성화한다
        // (manualRetryInFlight는 직전 클릭 → 다음 attempt 알림까지의 짧은 잠금 용도).
        // 동시에 회복 구간 시작을 엔진에 알려 채점 제외 시간을 누적한다 (Task #27, 멱등).
        setBleReconnecting(true);
        setReconnectInfo({
          attempt: detail.payload.attempt,
          maxAttempts: detail.payload.maxAttempts,
          nextDelayMs: detail.payload.nextDelayMs,
          receivedAt: Date.now(),
        });
        setManualRetryInFlight(false);
        engineRef.current?.beginRecoveryWindow();
      }
    };
    window.addEventListener('noilink-native-bridge', onBridge as EventListener);
    return () => {
      window.removeEventListener('noilink-native-bridge', onBridge as EventListener);
      clearReconnectTimer();
    };
  }, [state, finalizeAndAbort, clearReconnectTimer]);

  // ── 다음 재연결 시도까지 남은 초 카운트다운 ──
  // 배너에 "4초 후 재시도" 같은 안내를 보여주기 위해 nextDelayMs 만료까지의 잔여 시간을
  // 1초보다 잦은 주기(250ms)로 계산해 어색한 멈춤 없이 부드럽게 줄어들게 한다.
  // - bleReconnecting 가 꺼지거나 reconnectInfo 가 비면 즉시 정리한다.
  // - nextDelayMs 가 없는 경우(=마지막 시도 중)는 카운트다운을 표시하지 않는다.
  useEffect(() => {
    if (!bleReconnecting || !reconnectInfo || reconnectInfo.nextDelayMs == null) {
      setSecondsUntilNextAttempt(null);
      return;
    }
    const target = reconnectInfo.receivedAt + reconnectInfo.nextDelayMs;
    const tick = () => {
      const remainingMs = Math.max(0, target - Date.now());
      setSecondsUntilNextAttempt(Math.ceil(remainingMs / 1000));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [bleReconnecting, reconnectInfo]);

  // 동일 자극(pod, tickId)에 UI tap과 BLE TOUCH가 둘 다 와도 카운트는 1회만.
  const tapDedupRef = useRef<Set<string>>(new Set());
  const bumpTapCount = useCallback((podId: number, tickId: number | undefined) => {
    if (tickId && tickId > 0) {
      const key = `${podId}:${tickId}`;
      if (tapDedupRef.current.has(key)) return;
      tapDedupRef.current.add(key);
      // 장시간 세션 메모리 보호 — 상한 초과 시 가장 오래된 항목부터 정리
      if (tapDedupRef.current.size > 8192) {
        const it = tapDedupRef.current.values().next();
        if (!it.done) tapDedupRef.current.delete(it.value);
      }
    }
    setTapCount((n) => n + 1);
  }, []);

  const handleTap = useCallback((podId: number) => {
    // UI tap 시점의 현재 점등 tickId를 dedup 키로 사용
    const currentTickId = pods.find((p) => p.id === podId)?.tickId ?? 0;
    // 엔진이 실제로 채점에 반영한 경우만 카운트 (stale/중복/소등 입력은 미반영)
    const accepted = engineRef.current?.handleTap(podId) ?? false;
    if (accepted) bumpTapCount(podId, currentTickId);
  }, [pods, bumpTapCount]);

  // ── BLE TOUCH notify 구독 + 이벤트 수신 ──
  // 트레이닝 화면이 떠 있는 동안에만 디바이스 입력을 받는다.
  // 네이티브 셸이 아니거나 디바이스 미연결이면 ble.subscribeCharacteristic은 자동 no-op.
  useEffect(() => {
    const subscriptionId = `training-touch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    bleSubscribeCharacteristic(subscriptionId, 'notify');

    const onBridge = (e: Event) => {
      const detail = (e as CustomEvent<NativeToWebMessage>).detail;
      if (!detail || detail.type !== 'ble.touch') return;
      const t = detail.payload.touch;
      const useDelta = t.deviceDeltaValid ? t.deltaMs : undefined;
      // 엔진이 실제로 채점에 반영한 경우만 카운트 (stale 등 거부 입력 제외)
      const accepted = engineRef.current?.handleTap(t.pod, { deltaMs: useDelta, tickId: t.tickId }) ?? false;
      if (accepted) bumpTapCount(t.pod, t.tickId);
    };
    window.addEventListener('noilink-native-bridge', onBridge as EventListener);
    return () => {
      window.removeEventListener('noilink-native-bridge', onBridge as EventListener);
      bleUnsubscribeCharacteristic(subscriptionId);
    };
  }, [bumpTapCount]);

  // ── 엔진 종료 후 서버 제출 ──
  // 일시적 네트워크 끊김에 데이터를 잃지 않도록 자동 백오프 재시도를 한다.
  // 그래도 실패하면 화면에 안내 + "저장 재시도" 버튼을 노출한다.
  // 사용자가 그 상태로 화면을 떠나면 leaveToList() 가 큐에 적재한다(다음 진입 시 백그라운드 재전송).
  // 부분 결과 진행률 — handlePartialConfirm 에서 set 한 다음 runSubmit/leaveToList 가
  // 읽어 서버 meta + navigate state + pending 큐 모두에 동일 값을 전파한다.
  // 정상 완료 흐름에서는 항상 undefined 로 남아 기존 동작과 동일하다.
  const partialProgressPctRef = useRef<number | undefined>(undefined);

  const runSubmit = useCallback(async (metrics: Omit<RawMetrics, 'sessionId' | 'userId'> | null) => {
    if (!state || submitLock.current) return;
    // 백그라운드로 중단된 세션은 (사용자가 부분 결과 저장을 선택해 aborted 게이트를
    // 해제하지 않은 한) 결과 화면으로 보내지 않는다.
    // 사용자는 트레이닝 목록에서 안내 배너를 보고 다시 시작하게 된다.
    if (aborted.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setErr(null);
    const partialPct = partialProgressPctRef.current;
    // 직전 점수 조회(Task #113) — 정상 완료 흐름의 비교 카드에 가짜 폴백
    // (`todayScore - 12`) 대신 서버 이력의 진짜 직전 점수를 보여주기 위해
    // 제출과 병렬로 사용자 세션 이력을 받아 둔다. 제출 직전에 발사하므로
    // 응답에는 새 세션이 아직 없을 가능성이 높지만, 응답이 늦어 새 세션이
    // 포함되더라도 아래에서 `res.sessionId` 로 명시적으로 제외한다.
    // limit=50 은 Result.tsx 의 재진입 흐름과 동일한 값을 쓴다 — 점수 없는
    // 세션(자유 트레이닝/거부된 부분 결과 등)이 연속해서 끼더라도 직전 점수
    // 누락이 줄어든다.
    // 실패하거나 직전 세션이 없으면 `previousScore` 는 undefined 로 남고,
    // Result.tsx 가 비교 카드를 자연스럽게 숨긴다 (첫 세션 정책).
    const previousScorePromise = api
      .get<Session[]>(`/sessions/user/${state.userId}?limit=50`)
      .catch(() => null);
    const res = await submitCompletedTrainingWithRetry(
      {
        userId: state.userId,
        mode: state.apiMode,
        bpm: state.bpm,
        level: state.level,
        totalDurationSec: totalSec,
        yieldsScore: state.yieldsScore,
        isComposite: state.isComposite,
        tapCount,
        engineMetrics: metrics ?? undefined,
        existingSessionId: partialSessionIdRef.current,
        partialProgressPct: partialPct,
        // 화면 내 자동·수동 재시도가 모두 같은 idempotency 키를 쓰도록 세션 시작 시
        // 발급한 안정 키를 그대로 흘려보낸다 — 서버가 첫 응답을 흡수해 중복 저장 방지.
        localId: localIdRef.current,
      },
      {
        onAttempt: ({ result }) => {
          // 시도 도중 createSession 이 성공한 sessionId 가 새로 확보되면 즉시 보존.
          // 이후 재시도(자동/수동) 와 큐 적재 모두 같은 sessionId 를 재사용한다.
          if (result.sessionCreated && result.sessionId && !partialSessionIdRef.current) {
            partialSessionIdRef.current = result.sessionId;
          }
        },
      },
    );
    accumulatedAttemptsRef.current += res.totalAttempts;
    setSubmitting(false);
    if (res.error) {
      setErr(res.error);
      submitLock.current = false;
      return;
    }
    // 직전 점수 결정(Task #113):
    // 응답이 createdAt desc 정렬이므로 첫 항목부터 훑되, 새로 만든/업데이트된
    // 현재 세션(`res.sessionId`)은 명시적으로 건너뛴다. 그 다음 score 가 정의된
    // 첫 항목이 직전 점수다. 응답 실패·빈 이력·점수 누락이면 undefined 로 남기고,
    // Result.tsx 가 비교 카드와 "직전 대비" 코칭 문구를 함께 숨긴다.
    const previousScoreRes = await previousScorePromise;
    let previousScore: number | undefined;
    if (previousScoreRes && previousScoreRes.success && previousScoreRes.data) {
      for (const s of previousScoreRes.data) {
        if (s.id === res.sessionId) continue;
        if (typeof s.score === 'number') {
          previousScore = s.score;
          break;
        }
      }
    }
    navigate('/result', {
      replace: true,
      state: {
        title: state.title,
        displayScore: res.displayScore,
        // 비교 카드에 사용할 직전 점수 (첫 세션·이력 조회 실패 시 undefined).
        previousScore,
        yieldsScore: state.yieldsScore,
        sessionId: res.sessionId,
        // 서버 idempotency 캐시 hit(= 사용자가 같은 결과를 두 번 보낸 셈) 신호를
        // 결과 화면에 그대로 흘려보낸다. 결과 화면이 "이미 저장된 결과를 불러왔어요"
        // 식의 1회성 안내를 띄울 수 있다(Task #65).
        replayed: res.replayed,
        // 회복 구간 안내(Task #27): 결과 화면이 "BLE 단절 회복 X초가 채점에서
        // 제외됨" 배너를 띄울 수 있게 메트릭에서 추출해 navigate state로 전달.
        recoveryExcludedMs: metrics?.recovery?.excludedMs ?? 0,
        recoveryWindows: metrics?.recovery?.windows ?? 0,
        // 결과 화면 안내 카드의 타임라인/평균/최장 끊김 표시용 (Task #36).
        // segments 가 없는 과거/축약 페이로드와의 호환을 위해 빈 배열로 폴백.
        recoverySegments: metrics?.recovery?.segments ?? [],
        // 부분 결과 안내(Task #23): 결과 화면이 "부분 결과 · X%" 배지를 띄울 수
        // 있게 진행률을 함께 넘긴다. 정상 완료 흐름에서는 undefined 로 남는다.
        isPartial: typeof partialPct === 'number',
        partialProgressPct: partialPct,
        // ENDURANCE 부분 저장 신뢰도 안내(Task #54): 결과 화면이 "Late 구간 표본
        // 부족" 배너를 ENDURANCE 모드에서만 띄울 수 있게 모드와 표본 수를 전달.
        apiMode: state.apiMode,
        enduranceLateSampleCount: metrics?.endurance?.lateSampleCount,
      },
    });
  }, [state, totalSec, tapCount, navigate]);

  useEffect(() => {
    if (engineMetrics && !submitLock.current) {
      void runSubmit(engineMetrics);
    }
  }, [engineMetrics, runSubmit]);

  // 부분 결과 저장 모달 액션 핸들러.
  // - 결과 보러가기: aborted 게이트를 해제해 정상 종료와 동일한 제출 흐름을 탄다.
  //   submitLock 덕분에 중복 호출은 안전하고, 실패 시에는 본문의 "저장 재시도"
  //   버튼으로 동일하게 다시 시도할 수 있다.
  // - 그만두기: 기존 백그라운드 중단 흐름과 동일하게 트레이닝 목록으로 돌려보낸다.
  const handlePartialConfirm = useCallback(() => {
    // engineMetrics 가 null 인 상태로는 절대 제출하지 않는다 — submitTrainingRun
    // 의 합성 메트릭 fallback 으로 빠지면 부분 결과의 정합성이 깨진다.
    // 모달 isOpen 가드(engineMetrics !== null)와 이 가드를 모두 두어 이중 안전망.
    if (!engineMetrics) return;
    setPartialFinishOpen(false);
    // 이 시점부터의 제출은 부분 결과로 분류된다 — 진행률을 ref 에 기록해
    // runSubmit(서버 meta·navigate state) 과 leaveToList(pending 큐) 가 모두
    // 같은 값을 사용하도록 한다. setState 가 아닌 ref 를 쓰는 이유는 직후
    // runSubmit 호출이 이전 렌더의 클로저로 실행돼도 즉시 보이게 하기 위함.
    partialProgressPctRef.current = partialProgressPct;
    aborted.current = false;
    void runSubmit(engineMetrics);
  }, [engineMetrics, partialProgressPct, runSubmit]);
  const handlePartialDismiss = useCallback(() => {
    setPartialFinishOpen(false);
    navigate('/training', {
      replace: true,
      state: { abortReason: 'background' as const },
    });
  }, [navigate]);

  if (!state) return null;

  const elapsedSec = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');
  const progress = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0;

  const phaseLabel = PHASE_LABEL[phaseInfo.phase] ?? '진행';
  const cogLabel = phaseInfo.cognitiveMode ? COG_LABEL[phaseInfo.cognitiveMode] : '';
  const isComposite = state.isComposite || state.apiMode === 'COMPOSITE';

  // 사용자가 명시적으로 화면을 떠날 때(뒤로/취소) 사용할 핸들러.
  // - 결과 제출 실패 상태(err)에서 떠나면 결과가 영구 손실되므로,
  //   pending 큐에 적재해 다음 앱 진입 시 백그라운드로 재전송하도록 한다.
  //   (성공/최종 실패는 이후 outcome 배너로 사용자에게 1회성으로 안내된다.)
  // - 그 외 평범한 취소/뒤로는 안내 배너 없이 조용히 목록으로 돌아간다.
  const leaveToList = () => {
    if (err && state) {
      try {
        enqueuePendingRun({
          input: {
            userId: state.userId,
            mode: state.apiMode,
            bpm: state.bpm,
            level: state.level,
            totalDurationSec: totalSec,
            yieldsScore: state.yieldsScore,
            isComposite: state.isComposite,
            tapCount,
            engineMetrics: engineMetrics ?? undefined,
            // 부분 결과로 동의된 세션이면 진행률을 큐에도 보존해, 다음 백그라운드
            // drain 이 createSession 단계에서 동일한 meta.partial 을 영속화하도록 한다.
            partialProgressPct: partialProgressPctRef.current,
          },
          attempts: accumulatedAttemptsRef.current,
          partialSessionId: partialSessionIdRef.current,
          lastError: err,
          title: state.title,
          // 화면 내 시도와 background drain 이 같은 idempotency 키를 쓰도록
          // 세션 시작 시 발급한 안정 키를 그대로 큐에 보존한다.
          localId: localIdRef.current,
        });
      } catch {
        // 큐 적재가 실패해도 사용자 흐름을 막지 않는다 — 기존대로 안내 배너만 노출.
      }
      navigate('/training', { state: { abortReason: 'save-failed' satisfies TrainingAbortReason } });
    } else {
      navigate('/training');
    }
  };

  return (
    <MobileLayout hideBottomNav>
      <div
        className="max-w-md mx-auto px-4 pb-6 flex flex-col min-h-screen"
        style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))', paddingBottom: '40px', color: '#fff' }}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={leaveToList} className="text-white" aria-label="뒤로">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold">{state.title}</h1>
        </div>

        {/* BLE 재연결 회복 중 임시 안내 — 그레이스 기간 동안만 노출.
            네이티브가 ble.reconnect 로 보내준 attempt/maxAttempts/nextDelayMs 가 있으면
            "재연결 시도 2/3 · 4초 후 재시도" 처럼 진행 상황을 구체적으로 보여주고,
            마지막 시도(=nextDelayMs 없음 또는 attempt >= maxAttempts) 일 때는
            "마지막 시도 중…" 으로 알려준다. ble.reconnect 가 아직 도착하지 않은
            짧은 단절 직후에는 기존의 일반 안내 문구를 그대로 노출한다.

            "지금 다시 시도" 버튼은 사용자가 자동 백오프 카운트다운을 건너뛰고
            네이티브에 즉시 다음 attempt 발사를 요청하기 위한 것. 다음 경우엔 비활성화:
              - reconnectInfo 가 아직 도착하지 않음 (네이티브가 시도를 시작하기 전)
              - 마지막 시도 중 (=nextDelayMs 없음/attempt가 max 도달) — 건너뛸 대기가 없음
              - 카운트다운이 0 — 이미 connectToDevice 진행 중
              - 직전 클릭 후 새 attempt 알림이 아직 도착하지 않음 (중복 송신 방지)
         */}
        {bleReconnecting && (() => {
          const isLastAttempt = !!reconnectInfo && (
            reconnectInfo.nextDelayMs == null ||
            reconnectInfo.attempt >= reconnectInfo.maxAttempts
          );
          const countdownElapsed =
            secondsUntilNextAttempt !== null && secondsUntilNextAttempt <= 0;
          const retryDisabled =
            !reconnectInfo || isLastAttempt || countdownElapsed || manualRetryInFlight;
          const label = (() => {
            // "지금 다시 시도" 클릭 직후 ~다음 ble.reconnect/ble.connection 도착 전까지의
            // 짧은 구간엔 "재시도를 요청했어요…" 안내로 즉각 피드백을 준다.
            // 카운트다운/시도 정보 텍스트를 덮어 시각적 충돌(예: "0초 후 재시도" 잔상)을 막는다.
            if (manualRetryInFlight) return '재시도를 요청했어요…';
            if (!reconnectInfo) return '기기 연결 회복 중…';
            if (isLastAttempt) {
              return `기기 연결 회복 중… 마지막 시도 중 (${reconnectInfo.attempt}/${reconnectInfo.maxAttempts})`;
            }
            const secs = secondsUntilNextAttempt ?? Math.ceil((reconnectInfo.nextDelayMs ?? 0) / 1000);
            return `기기 연결 회복 중… 재연결 시도 ${reconnectInfo.attempt}/${reconnectInfo.maxAttempts} · ${secs}초 후 재시도`;
          })();
          return (
            <div
              role="status"
              aria-live="polite"
              className="mb-3 px-3 py-2 rounded-lg text-xs flex items-center justify-between gap-2"
              style={{ backgroundColor: '#3A2A00', color: '#FFD66B', border: '1px solid #5A4500' }}
            >
              <span className="flex-1 text-center">{label}</span>
              <button
                type="button"
                onClick={() => {
                  if (retryDisabled) return;
                  setManualRetryInFlight(true);
                  bleReconnectNow();
                }}
                disabled={retryDisabled}
                aria-label="지금 다시 시도"
                className="shrink-0 px-2 py-1 rounded-md text-xs font-semibold"
                style={{
                  backgroundColor: retryDisabled ? '#3A2A00' : '#FFD66B',
                  color: retryDisabled ? '#7A6A30' : '#3A2A00',
                  border: '1px solid #FFD66B',
                  opacity: retryDisabled ? 0.5 : 1,
                  cursor: retryDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                지금 다시 시도
              </button>
            </div>
          );
        })()}

        {/* 페이즈/모드 표시 */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <span
            className="px-3 py-1 rounded-full text-xs font-semibold"
            style={{ backgroundColor: phaseInfo.phase === 'RHYTHM' ? '#3B82F6' : '#AAED10', color: '#000' }}
          >
            {phaseLabel}
          </span>
          {phaseInfo.phase === 'COGNITIVE' && cogLabel && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold border" style={{ borderColor: '#2A2A2A' }}>
              {cogLabel}
            </span>
          )}
          {isComposite && (
            <span className="px-3 py-1 rounded-full text-xs" style={{ color: '#888' }}>
              사이클 {phaseInfo.cycleIndex + 1}
            </span>
          )}
        </div>

        {/* 진행 바 */}
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1" style={{ color: '#888' }}>
            <span>BPM {state.bpm} · Lv {state.level}</span>
            <span className="tabular-nums">{mm}:{ss} / {totalSec}초</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#2A2A2A' }}>
            <div
              className="h-full"
              style={{
                width: `${progress * 100}%`,
                backgroundColor: '#AAED10',
                transition: 'width 0.2s linear',
              }}
            />
          </div>
        </div>

        {/* 가상 Pod 그리드 */}
        <div className="my-6">
          <PodGrid pods={pods} onTap={handleTap} />
        </div>

        {/* 안내 문구 */}
        <ModeHint mode={phaseInfo.phase === 'RHYTHM' ? 'RHYTHM' : (phaseInfo.cognitiveMode ?? state.apiMode)} />

        {/* 카운트 */}
        <div className="mt-4 text-center text-xs" style={{ color: '#666' }}>
          입력 {tapCount}회
        </div>

        {err && (
          <div className="mt-4 text-center">
            <p className="text-sm text-red-400 mb-2">{err}</p>
            <button
              onClick={() => void runSubmit(engineMetrics)}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-sm font-semibold"
              style={{ backgroundColor: '#AAED10', color: '#000' }}
            >
              저장 재시도
            </button>
          </div>
        )}

        {/* 하단 버튼: 종료 */}
        <div className="mt-auto pt-6">
          <button
            onClick={leaveToList}
            disabled={submitting}
            className="w-full py-3 rounded-xl font-semibold text-white"
            style={{ backgroundColor: '#2A2A2A' }}
          >
            취소
          </button>
        </div>

        {submitting && (
          <p className="text-center text-sm mt-3 text-gray-400">결과 저장 중…</p>
        )}
      </div>

      {/* 백그라운드 중단이 임계값(80%) 이상에서 발생했을 때만 표시.
          진행률을 그대로 보여주고, 사용자가 "결과 보러가기" / "그만두기" 중 선택.
          engineMetrics 가 실제로 산출되기 전에는 모달을 띄우지 않는다 — 그래야
          "결과 보러가기" 클릭 시 합성 메트릭(submitTrainingRun 의 fallback)이
          아니라 항상 진짜 부분 메트릭이 서버로 제출된다. endNow()는 동기적으로
          onComplete 를 호출하므로 모달이 닫혀 있는 시간은 사실상 1 렌더 미만이다. */}
      {/* BLE 단절이 잦을 때 환경 점검을 부드럽게 권하는 토스트 (Task #38).
          학습 흐름을 방해하지 않도록 상단 토스트(자동 닫힘)로만 노출하고,
          한 세션에 한 번만 표시한다. 색·어휘는 결과 화면의 회복 배너와 일관. */}
      <SuccessBanner
        isOpen={bleStabilityNoticeOpen}
        message="기기 연결이 자주 끊겨요. 거리·간섭을 확인해 보세요."
        backgroundColor="#3A2A00"
        textColor="#FFD66B"
        duration={4000}
        onClose={() => setBleStabilityNoticeOpen(false)}
      />

      {/* 브릿지 거부(ack ok=false) 토스트 — 한국어 안내 + 디버그 키 (Task #77).
          BLE 단절 토스트와 동시에 뜰 가능성은 매우 낮지만, 같은 top-0 영역에
          렌더되므로 둘 중 늦게 마운트된 쪽이 위로 보일 수 있다. 둘 다 자동 닫힘이라
          교차하는 시간은 짧고, 사용자는 어느 쪽이든 즉시 사유를 확인할 수 있다. */}
      <SuccessBanner
        isOpen={!!ackErrorBanner}
        message={ackErrorBanner ?? ''}
        backgroundColor="#3a1212"
        textColor="#fca5a5"
        duration={5000}
        onClose={() => setAckErrorBanner(null)}
      />

      <ConfirmModal
        isOpen={partialFinishOpen && engineMetrics !== null}
        title="거의 다 끝났던 세션이에요"
        message={`화면을 가린 동안 트레이닝이 멈췄지만 ${partialProgressPct}% 까지 진행됐어요. 지금까지의 결과를 저장하고 결과 화면으로 이동할까요?`}
        confirmText="결과 보러가기"
        cancelText="그만두기"
        onConfirm={handlePartialConfirm}
        onCancel={handlePartialDismiss}
      />
    </MobileLayout>
  );
}

function ModeHint({ mode }: { mode: string }) {
  const text = (() => {
    switch (mode) {
      case 'RHYTHM':       return '점등되는 순간에 정확히 탭! P0 → P1 → P2 → P3';
      case 'FOCUS':        return '🔵 파랑(BLUE)만 탭. 빨강·노랑은 무시.';
      case 'MEMORY':       return '초록 순서를 외우고, 흰 신호 후 같은 순서로 탭.';
      case 'COMPREHENSION':return '현재 규칙 색만 탭. 흰색 신호 후 규칙이 바뀝니다.';
      case 'JUDGMENT':     return '🟢 초록=1탭, 🔴 빨강=참기, 🟡 노랑=2탭(더블탭)';
      case 'AGILITY':      return '🟢 초록=손, 🔵 파랑/🟡 노랑=발. Lv4부터 동시 자극.';
      case 'ENDURANCE':    return '파랑(BLUE) 타겟을 끝까지 일정한 속도로 탭.';
      case 'FREE':         return '자유롭게 탭. 점수는 기록되지 않습니다.';
      default:             return '';
    }
  })();
  if (!text) return null;
  return (
    <p className="text-center text-sm mt-2" style={{ color: '#AAED10' }}>{text}</p>
  );
}
