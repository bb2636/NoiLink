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
import PodGrid from '../components/PodGrid/PodGrid';
import type { Level, NativeToWebMessage, RawMetrics, TrainingMode } from '@noilink/shared';
import { SESSION_MAX_MS } from '@noilink/shared';
import { submitCompletedTraining } from '../utils/submitTrainingRun';
import { TrainingEngine, type EnginePhaseInfo, type PodState } from '../training/engine';
import { bleSubscribeCharacteristic, bleUnsubscribeCharacteristic } from '../native/bleBridge';

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

  const engineRef = useRef<TrainingEngine | null>(null);
  const submitLock = useRef(false);

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
      onElapsedMs: (ms) => setElapsedMs(ms),
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

  // 동일 자극(pod, tickId)에 UI tap과 BLE TOUCH가 둘 다 와도 카운트는 1회만.
  const tapDedupRef = useRef<Set<string>>(new Set());
  const bumpTapCount = useCallback((podId: number, tickId: number | undefined) => {
    if (tickId && tickId > 0) {
      const key = `${podId}:${tickId}`;
      if (tapDedupRef.current.has(key)) return;
      tapDedupRef.current.add(key);
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

  if (!state) return null;

  const elapsedSec = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');
  const progress = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0;

  const phaseLabel = PHASE_LABEL[phaseInfo.phase] ?? '진행';
  const cogLabel = phaseInfo.cognitiveMode ? COG_LABEL[phaseInfo.cognitiveMode] : '';
  const isComposite = state.isComposite || state.apiMode === 'COMPOSITE';

  return (
    <MobileLayout hideBottomNav>
      <div
        className="max-w-md mx-auto px-4 pb-6 flex flex-col min-h-screen"
        style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))', paddingBottom: '40px', color: '#fff' }}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => navigate('/training')} className="text-white" aria-label="뒤로">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold">{state.title}</h1>
        </div>

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
            onClick={() => navigate('/training')}
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
