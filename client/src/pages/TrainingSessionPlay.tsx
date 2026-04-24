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
import type { Level, NativeToWebMessage, RawMetrics, TrainingMode } from '@noilink/shared';
import { SESSION_MAX_MS } from '@noilink/shared';
import { submitCompletedTraining } from '../utils/submitTrainingRun';
import { TrainingEngine, type EnginePhaseInfo, type PodState } from '../training/engine';
import { bleSubscribeCharacteristic, bleUnsubscribeCharacteristic } from '../native/bleBridge';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import type { TrainingAbortReason } from './trainingAbortReason';

/**
 * 백그라운드 중단 시 부분 결과 저장을 제안하는 진행률 임계값.
 * 0.8 = 전체 시간의 80% 이상 진행한 세션은 사용자에게 결과 저장 선택지를 제시한다.
 *
 * 근거:
 *  - 너무 낮으면 표본이 부족해 산출 점수의 신뢰도가 떨어진다(특히 ENDURANCE의
 *    Late 구간 점수, COMPOSITE의 마지막 사이클 모드 등은 후반부에 누적된다).
 *  - 너무 높으면 "거의 끝났는데 아무것도 안 남았다"는 사용자 불만이 그대로 남는다.
 *  - 80%는 RHYTHM/COGNITIVE 페이즈가 한 번씩 돌아 6대 지표 중 다수가 산출되는
 *    실용적 하한선이다 (COMPOSITE 5사이클 기준 4사이클 완료 직전).
 */
const PARTIAL_RESULT_THRESHOLD = 0.8;

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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // ── 가드: 잘못된 진입은 목록으로 ──
  useEffect(() => {
    if (!state || !state.userId || totalSec <= 0) {
      navigate('/training', { replace: true });
    }
  }, [state, totalSec, navigate]);

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
    const eng = engineRef.current;
    if (eng) {
      // LED OFF + CONTROL_STOP + onComplete(메트릭) 발사
      eng.endNow();
      // engineRef는 비우지 않는다 — 이 시점부터는 endNow() 호출이 idempotent.
    }
    navigate('/training', { replace: true, state: { abortReason: reason } });
  }, [engineMetrics, submitting, navigate]);

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
    //   (1) 거의 끝났던 점수 산출 세션 (진행률 ≥ PARTIAL_RESULT_THRESHOLD)
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

      if (scorable && progressRatio >= PARTIAL_RESULT_THRESHOLD) {
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
          // 재연결 성공 — 그레이스 중이면 배너/타이머를 정리하고 트레이닝을 계속 진행한다.
          clearReconnectTimer();
          setBleReconnecting(false);
          return;
        }
        if (detail.payload.reason === 'user') return;
        if (detail.payload.reason === 'retry-failed') {
          // 자동 재연결이 모두 실패 — 즉시 종료.
          clearReconnectTimer();
          setBleReconnecting(false);
          finalizeAndAbort('ble-disconnect');
          return;
        }
        // 'unexpected' (또는 사유 누락) — 그레이스 기간 시작 / 갱신.
        setBleReconnecting(true);
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          setBleReconnecting(false);
          finalizeAndAbort('ble-disconnect');
        }, BLE_RECONNECT_GRACE_MS);
        return;
      }
      if (detail.type === 'ble.reconnect') {
        // 재연결 시도 알림 — 배너 상태만 보장.
        setBleReconnecting(true);
      }
    };
    window.addEventListener('noilink-native-bridge', onBridge as EventListener);
    return () => {
      window.removeEventListener('noilink-native-bridge', onBridge as EventListener);
      clearReconnectTimer();
    };
  }, [state, finalizeAndAbort, clearReconnectTimer]);

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
  const runSubmit = useCallback(async (metrics: Omit<RawMetrics, 'sessionId' | 'userId'> | null) => {
    if (!state || submitLock.current) return;
    // 백그라운드로 중단된 세션은 (사용자가 부분 결과 저장을 선택해 aborted 게이트를
    // 해제하지 않은 한) 결과 화면으로 보내지 않는다.
    // 사용자는 트레이닝 목록에서 안내 배너를 보고 다시 시작하게 된다.
    if (aborted.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setErr(null);
    const res = await submitCompletedTraining({
      userId: state.userId,
      mode: state.apiMode,
      bpm: state.bpm,
      level: state.level,
      totalDurationSec: totalSec,
      yieldsScore: state.yieldsScore,
      isComposite: state.isComposite,
      tapCount,
      engineMetrics: metrics ?? undefined,
    });
    setSubmitting(false);
    if (res.error) {
      setErr(res.error);
      submitLock.current = false;
      return;
    }
    navigate('/result', {
      replace: true,
      state: {
        title: state.title,
        displayScore: res.displayScore,
        yieldsScore: state.yieldsScore,
        sessionId: res.sessionId,
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
    aborted.current = false;
    void runSubmit(engineMetrics);
  }, [engineMetrics, runSubmit]);
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
  // - 결과 제출 실패 상태(err)에서 떠나면 결과가 영구 손실되므로, 목록 화면에서 사유 배너로 안내한다.
  // - 그 외 평범한 취소/뒤로는 안내 배너 없이 조용히 목록으로 돌아간다.
  const leaveToList = () => {
    if (err) {
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

        {/* BLE 재연결 회복 중 임시 안내 — 그레이스 기간 동안만 노출 */}
        {bleReconnecting && (
          <div
            role="status"
            aria-live="polite"
            className="mb-3 px-3 py-2 rounded-lg text-xs text-center"
            style={{ backgroundColor: '#3A2A00', color: '#FFD66B', border: '1px solid #5A4500' }}
          >
            기기 연결 회복 중…
          </div>
        )}

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
