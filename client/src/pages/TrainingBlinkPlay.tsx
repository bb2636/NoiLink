/**
 * 점등-전용 트레이닝 진행 화면 (BlinkPlay)
 *
 * 정책:
 * - 화면은 단순화: 헤더 + BPM 카드 + 원형 progress + 시간 + 취소/일시정지·재개 버튼.
 * - 사용자 입력(화면 탭, BLE TOUCH 데이터)은 모두 무시한다 — 본 화면은 디바이스에
 *   "BPM 타이밍에 맞춘 점등 신호 송신기" 역할만 한다.
 * - 일시정지: 점등 정지 + 타이머 정지. 재개: 같은 지점에서 이어진다.
 * - BLE 단절 회복(beginRecoveryWindow/endRecoveryWindow) 정책은 그대로 유지하되,
 *   채점 자체가 무의미하므로 회복 통계는 누적만 하고 결과 화면에는 노출하지 않는다.
 * - 자연 종료 시 점수 산출/서버 제출 없이 곧장 결과 화면(blinkOnly=true)으로 이동.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { MobileLayout } from '../components/Layout';
import ConfirmModal from '../components/ConfirmModal/ConfirmModal';
import type { NativeToWebMessage } from '@noilink/shared';
import { SESSION_MAX_MS } from '@noilink/shared';
import { TrainingEngine, type EnginePhaseInfo } from '../training/engine';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { getBleFirmwareReady } from '../native/bleFirmwareReady';
import type { TrainingRunState } from './TrainingSessionPlay';

const COLOR_BG = '#0A0A0A';
const COLOR_CARD = '#1A1A1A';
const COLOR_LIME = '#AAED10';
const COLOR_ORANGE = '#FF8B3D';
const COLOR_GRAY = '#373C39';
const COLOR_TRACK = '#2A2A2A';

const BLE_RECONNECT_GRACE_MS = 8000;

function formatMmSs(totalSec: number): string {
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function TrainingBlinkPlay() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as TrainingRunState | null;

  const totalSec = state ? Math.min(state.totalDurationSec, SESSION_MAX_MS / 1000) : 0;
  const totalMs = totalSec * 1000;

  const [elapsedMs, setElapsedMs] = useState(0);
  const [, setPhaseInfo] = useState<EnginePhaseInfo>({ phase: 'IDLE', cycleIndex: 0 });
  const [isPaused, setIsPaused] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [bleReconnecting, setBleReconnecting] = useState(false);

  const engineRef = useRef<TrainingEngine | null>(null);
  const completedRef = useRef(false);
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
      // 점등-전용 모드는 화면에 PodGrid 를 노출하지 않으므로 onPodStates 는 수신만 하고 무시한다.
      onPodStates: () => {},
      onElapsedMs: (ms) => setElapsedMs(ms),
      onPhaseChange: (info) => setPhaseInfo(info),
      onComplete: () => {
        // 자연 종료 — 결과 화면으로 단순 이동. 점수/서버 제출 없음.
        if (completedRef.current) return;
        completedRef.current = true;
        setCompleted(true);
      },
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 자연 종료 후 결과 화면 이동 — completed flag 가 켜진 다음 turn 에서 navigate.
  useEffect(() => {
    if (!completed || !state) return;
    navigate('/result', {
      replace: true,
      state: {
        title: state.title,
        yieldsScore: false,
        blinkOnly: true,
      },
    });
  }, [completed, state, navigate]);

  // ── BLE 단절 → 회복 그레이스 (네이티브 셸에서만) ──
  // 짧은 단절은 자동 재연결을 기다리고, 최종 실패('retry-failed') 또는 그레이스 만료에서만
  // 트레이닝을 취소시키고 목록으로 돌려보낸다. 점등-전용이라 채점 정합성 안내는 생략.
  useEffect(() => {
    if (!state) return;
    if (!isNoiLinkNativeShell()) return;
    const onBridge = (e: Event) => {
      const detail = (e as CustomEvent<NativeToWebMessage>).detail;
      if (!detail) return;
      if (detail.type === 'ble.connection') {
        // 펌웨어 미탑재 기기는 idle 단절이 빈번 — 본 화면은 점등 신호만 보내므로
        // 단절 알림을 무시하고 진행을 그대로 둔다(기존 화면과 동일 정책).
        if (getBleFirmwareReady() === false) return;
        if (detail.payload.connected !== null) {
          clearReconnectTimer();
          setBleReconnecting(false);
          engineRef.current?.endRecoveryWindow();
          return;
        }
        if (detail.payload.reason === 'user') return;
        if (detail.payload.reason === 'retry-failed') {
          clearReconnectTimer();
          setBleReconnecting(false);
          engineRef.current?.destroy();
          engineRef.current = null;
          navigate('/training', {
            replace: true,
            state: { abortReason: 'ble-disconnect' as const },
          });
          return;
        }
        // unexpected — 회복 시작.
        setBleReconnecting(true);
        engineRef.current?.beginRecoveryWindow();
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          setBleReconnecting(false);
          engineRef.current?.destroy();
          engineRef.current = null;
          navigate('/training', {
            replace: true,
            state: { abortReason: 'ble-disconnect' as const },
          });
        }, BLE_RECONNECT_GRACE_MS);
      }
    };
    window.addEventListener('noilink-native-bridge', onBridge as EventListener);
    return () => {
      window.removeEventListener('noilink-native-bridge', onBridge as EventListener);
      clearReconnectTimer();
    };
  }, [state, clearReconnectTimer, navigate]);

  // ── 핸들러 ──
  const handlePauseResume = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    if (eng.getIsPaused()) {
      eng.resume();
      setIsPaused(false);
    } else {
      eng.pause();
      setIsPaused(true);
    }
  }, []);

  const handleCancelClick = useCallback(() => {
    const eng = engineRef.current;
    // 모달 동안 점등이 계속되지 않게 일시정지로 둔다(이미 일시정지면 그대로).
    if (eng && !eng.getIsPaused()) {
      eng.pause();
      setIsPaused(true);
    }
    setConfirmCancelOpen(true);
  }, []);

  const handleCancelConfirm = useCallback(() => {
    setConfirmCancelOpen(false);
    const eng = engineRef.current;
    if (eng) {
      eng.destroy();
      engineRef.current = null;
    }
    navigate('/training', { replace: true });
  }, [navigate]);

  const handleCancelDismiss = useCallback(() => {
    setConfirmCancelOpen(false);
    // 사용자가 취소를 철회 — 일시정지 상태는 그대로 둔다(사용자가 직접 재개 누르도록).
  }, []);

  if (!state) return null;

  const elapsedSec = Math.floor(elapsedMs / 1000);
  const remainingSec = Math.max(0, totalSec - elapsedSec);
  const progress = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0;

  // 원형 progress 좌표
  const SIZE = 240;
  const STROKE = 12;
  const RADIUS = (SIZE - STROKE) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <MobileLayout hideBottomNav>
      <div
        className="min-h-screen flex flex-col"
        style={{
          backgroundColor: COLOR_BG,
          paddingTop: 'calc(1rem + env(safe-area-inset-top))',
          paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))',
        }}
      >
        {/* 헤더 */}
        <div className="px-4 mb-2 flex items-center gap-3">
          <button
            type="button"
            onClick={handleCancelClick}
            aria-label="뒤로"
            className="text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-white">트레이닝 진행</h1>
        </div>

        {/* BPM 카드 */}
        <div className="px-4 mt-2">
          <div
            className="mx-auto rounded-2xl px-6 py-3 flex items-center justify-center gap-3"
            style={{
              backgroundColor: COLOR_CARD,
              border: `1.5px solid ${COLOR_LIME}`,
              maxWidth: 280,
            }}
            data-testid="bpm-card"
          >
            <span className="text-white text-base font-medium">BPM</span>
            <span className="text-2xl font-bold" style={{ color: COLOR_LIME }}>
              {state.bpm}
            </span>
          </div>
        </div>

        {/* 원형 progress + 중앙 시간 */}
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="relative" style={{ width: SIZE, height: SIZE }}>
            <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
              {/* track */}
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={COLOR_TRACK}
                strokeWidth={STROKE}
              />
              {/* progress */}
              <motion.circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={COLOR_LIME}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                style={{ transition: 'stroke-dashoffset 0.2s linear' }}
              />
            </svg>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center"
              data-testid="progress-center"
            >
              <div className="text-white text-3xl font-bold">{remainingSec}초</div>
              <div className="text-sm mt-1" style={{ color: '#9CA3AF' }}>
                {formatMmSs(elapsedSec)} 경과
              </div>
            </div>
          </div>

          {/* 상태 안내 */}
          <div className="mt-6 h-6 text-sm" style={{ color: '#9CA3AF' }}>
            {bleReconnecting
              ? '연결 회복 중…'
              : isPaused
                ? '일시정지됨'
                : '점등 신호 송신 중'}
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="px-4 pb-4 flex items-center justify-center gap-12">
          <button
            type="button"
            aria-label="취소"
            data-testid="cancel-button"
            onClick={handleCancelClick}
            className="rounded-full flex items-center justify-center"
            style={{ width: 64, height: 64, backgroundColor: COLOR_GRAY }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={isPaused ? '재개' : '일시정지'}
            data-testid="pause-resume-button"
            onClick={handlePauseResume}
            className="rounded-full flex items-center justify-center"
            style={{ width: 80, height: 80, backgroundColor: COLOR_ORANGE }}
          >
            {isPaused ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white" stroke="none">
                <polygon points="6,4 20,12 6,20" />
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white" stroke="none">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmCancelOpen}
        title="트레이닝을 종료할까요?"
        message="진행 중인 트레이닝을 종료하고 목록으로 돌아갑니다."
        confirmText="종료"
        cancelText="계속"
        reverseActions
        onConfirm={handleCancelConfirm}
        onCancel={handleCancelDismiss}
      />
    </MobileLayout>
  );
}
