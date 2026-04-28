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
import { COLOR_CODE, CTRL_START, CTRL_STOP, SESSION_MAX_MS } from '@noilink/shared';
import { STORAGE_KEYS } from '../utils/constants';
import { TrainingEngine, type EnginePhaseInfo } from '../training/engine';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { getBleFirmwareReady } from '../native/bleFirmwareReady';
import {
  bleSubscribeCharacteristic,
  bleUnsubscribeCharacteristic,
  bleWriteControl,
  bleWriteLed,
  getLegacyEmittedCount,
  getLegacyLastEmittedFrameHex,
  resetLegacyEmittedDiag,
} from '../native/bleBridge';
import { getLegacyBleMode } from '../native/legacyBleMode';
import type { TrainingRunState } from './TrainingSessionPlay';

/** 연결된 기기 ID — 진단 표시용. localStorage 의 CONNECTED_DEVICE 키를 읽는다. */
function readConnectedDeviceId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONNECTED_DEVICE);
    if (!raw) return null;
    return (JSON.parse(raw) as { id?: string })?.id ?? null;
  } catch {
    return null;
  }
}

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
  // 진단용 카운터 — 본체 LED 가 박자에 맞춰 안 바뀐다는 사용자 보고를 추적하기 위해
  // 화면에 송신/점등 횟수를 노출한다. 두 카운터의 동작:
  //   - stateUpdates: 엔진의 onPodStates 콜백이 호출된 총 횟수 (점등/소등/회복 모두 포함).
  //   - lightCount: OFF→ON 전이 횟수. 박자에 맞춰 1, 2, 3 ... 으로 증가하면 BLE 송신 단계까지
  //                 정상이라는 의미이며 본체가 안 바뀌면 펌웨어/네이티브 단계 문제로 좁혀진다.
  //                 카운터가 0 에서 멈추면 엔진의 fireTick 자체가 돌지 않는다는 의미.
  const [stateUpdates, setStateUpdates] = useState(0);
  const [lightCount, setLightCount] = useState(0);
  // 진단용 — 트레이닝 화면이 'native shell' 안에서 돌아가고 BLE 가 살아있는지 확인.
  // 송신/점등 카운터는 올라가는데 본체가 안 바뀐다는 보고를 쪼개기 위해 노출한다.
  const [bleConnected, setBleConnected] = useState<boolean | null>(() =>
    isNoiLinkNativeShell() ? readConnectedDeviceId() !== null : null,
  );
  // 진단용 — 마지막 송신 frame hex. lit pod 의 ID 로 산출 (`4e (id+1) 0d`).
  // 이 값이 디바이스 점등 테스트와 동일한 형태로 흐르면 트레이닝과 테스트의
  // 송신 경로가 정말 같다는 시각적 증거가 된다.
  const [lastFrameHex, setLastFrameHex] = useState<string>('-');
  // 진단용 — bleBridge 의 레거시 큐가 실제로 native bridge 로 BLE write 를 보낸
  // 횟수와 직전 hex. `송신 N회` 는 엔진 onPodStates 호출 횟수일 뿐 실제 BLE
  // 전송과 무관하므로, 이 두 값을 따로 보여 줘야 "엔진은 점등 시도했지만 BLE
  // write 가 발사되지 않았다" 시나리오를 구별할 수 있다.
  const [bleEmitted, setBleEmitted] = useState(0);
  const [bleLastHex, setBleLastHex] = useState<string>('-');
  // 진단용 — 트레이닝 화면 자체의 BLE 환경(연결/구독/큐)이 정상인지 갈라내기 위한
  // 임시 디버그 버튼 상태. 누르면 진행 중인 엔진을 destroy(STOP 송신) 한 뒤,
  // Device 화면의 testBlink 와 정확히 같은 시퀀스(START → LED1~4 1초 간격 → STOP)
  // 를 이 화면 컨텍스트에서 직접 송신한다. 본체 LED 가 점등되면 페이지 환경은
  // 정상 → engine 의 LED 호출 패턴이 진짜 원인. 점등 안 되면 페이지 진입 자체가
  // BLE 를 깨뜨림 → 다른 가설로 좁혀진다.
  const [debugBlinkRunning, setDebugBlinkRunning] = useState(false);
  const [debugBlinkResult, setDebugBlinkResult] = useState<string>('-');
  const legacyOn = getLegacyBleMode();

  const engineRef = useRef<TrainingEngine | null>(null);
  const completedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLitRef = useRef(false);

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
    // 매 진입마다 큐 진단 카운터 리셋 — 한 trial 안에서만 누적된 값을 본다.
    resetLegacyEmittedDiag();
    const engine = new TrainingEngine({
      mode: state.apiMode,
      bpm: state.bpm,
      level: state.level,
      totalDurationMs: totalMs,
      podCount: 4,
      isComposite: state.isComposite || state.apiMode === 'COMPOSITE',
      // 점등-전용 모드는 PodGrid 를 노출하지 않으므로 화면 표시는 안 하지만, 진단용으로
      // 호출 횟수와 OFF→ON 전이 횟수, 마지막 송신 hex 를 누적해 화면 하단에 노출한다.
      onPodStates: (s) => {
        setStateUpdates((c) => c + 1);
        const litIds = s.filter((p) => p.fill !== 'OFF').map((p) => p.id);
        const isLit = litIds.length > 0;
        if (isLit && !prevLitRef.current) {
          setLightCount((c) => c + 1);
        }
        if (isLit) {
          // 레거시 분기와 동일한 인코딩(`4e (id+1) 0d`)을 화면용으로 재구성.
          // 실제 송신은 `bleWriteLed` → `encodeLegacyLedFrame` 가 담당하며 여기서는
          // 표시만을 위해 같은 식을 쓴다 (id 0..7 → 01..08).
          const hex = litIds
            .map((id) => `4e ${(id + 1).toString(16).padStart(2, '0')} 0d`)
            .join(' / ');
          setLastFrameHex(hex);
        }
        prevLitRef.current = isLit;
      },
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

  // 진단 폴링 — 레거시 큐 드레인 카운터/hex 를 250ms 마다 화면에 반영.
  // 폴링이라는 비효율을 감수하더라도, 큐가 native bridge 로 실제 송신했는지를
  // 외부에서 확인하기 위한 가장 단순한 경로다(이벤트 발신을 추가하지 않는다).
  useEffect(() => {
    if (!state) return;
    const id = setInterval(() => {
      const c = getLegacyEmittedCount();
      const h = getLegacyLastEmittedFrameHex();
      setBleEmitted((prev) => (prev === c ? prev : c));
      setBleLastHex((prev) => (prev === h || h === '' ? prev : h));
    }, 250);
    return () => clearInterval(id);
  }, [state]);

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

  // ── BLE notify 구독 (점등-전용이라도 펌웨어 RX 활성용) ──
  // NINA-B1 NUS 계열 일부 펌웨어는 TX(notify) 가 활성 구독 상태여야 RX(write) 로
  // 들어온 LED frame 을 처리한다. Device 화면(testBlink)이 작동하는 이유는 그
  // 화면이 마운트 동안 notify 를 구독하기 때문이고, 트레이닝 화면이 작동하지
  // 않는 이유는 Device 를 떠나면서 unsubscribe → 펌웨어 RX 비활성 → LED frame
  // 무시 가설. 점등-전용 트레이닝은 들어오는 데이터를 사용하지 않지만, 구독
  // 자체로 펌웨어 GATT CCCD 를 활성 상태로 유지한다.
  useEffect(() => {
    if (!isNoiLinkNativeShell()) return;
    const subscriptionId = `blink-rxkeepalive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    bleSubscribeCharacteristic(subscriptionId, 'notify');
    return () => {
      bleUnsubscribeCharacteristic(subscriptionId);
    };
  }, []);

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
        // 진단 표시 동기화 — 펌웨어 ready 여부와 무관하게 항상 갱신.
        setBleConnected(detail.payload.connected !== null);
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

  // 진단용 — Device 화면의 testBlink 와 정확히 같은 시퀀스를 이 화면에서 직접 송신.
  // 진행 중인 트레이닝 엔진은 destroy(STOP 송신) 후 800ms 대기하여 펌웨어 상태를
  // 정리한 뒤 START → LED 1~4 (1초 간격) → STOP. 결과는 화면에 노출.
  const handleDebugTestBlink = useCallback(async () => {
    if (debugBlinkRunning) return;
    setDebugBlinkRunning(true);
    setDebugBlinkResult('진행 중…');
    try {
      const eng = engineRef.current;
      if (eng) {
        eng.destroy();
        engineRef.current = null;
      }
      // 펌웨어 STOP 처리 + native 큐 비우기 시간 확보
      await new Promise((r) => setTimeout(r, 800));
      bleWriteControl(CTRL_START);
      await new Promise((r) => setTimeout(r, 500));
      for (let pod = 0; pod < 4; pod++) {
        bleWriteLed({
          tickId: pod + 1,
          pod,
          colorCode: COLOR_CODE.RED,
          onMs: 800,
        });
        await new Promise((r) => setTimeout(r, 1000));
      }
      bleWriteControl(CTRL_STOP);
      setDebugBlinkResult('완료 — 본체 LED 가 1~4번 순서로 점등되었나요?');
    } catch (err) {
      setDebugBlinkResult(`실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDebugBlinkRunning(false);
    }
  }, [debugBlinkRunning]);

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

          {/* 진단 카운터 — 본체 LED 가 안 바뀌는 문제를 좁히기 위한 임시 표시 */}
          <div
            className="mt-2 text-xs leading-5 text-center"
            style={{ color: '#6B7280' }}
            data-testid="blink-diag-counter"
          >
            <div>엔진 · 콜백 {stateUpdates}회 / 점등 {lightCount}회</div>
            <div data-testid="blink-diag-ble-emitted">
              BLE 실송신: {bleEmitted}회
            </div>
            <div>
              연결:{' '}
              {bleConnected === null ? '웹모드' : bleConnected ? '연결됨' : '끊김'}
              {' · '}
              모드: {legacyOn ? '레거시(4e XX 0d)' : '차세대(12바이트)'}
            </div>
            <div data-testid="blink-diag-last-hex">엔진 마지막 lit: {lastFrameHex}</div>
            <div data-testid="blink-diag-ble-last-hex">BLE 마지막 frame: {bleLastHex}</div>
          </div>

          {/* 진단용 디버그 버튼 — 트레이닝 화면 환경에서 testBlink 동일 시퀀스 실행.
              누르면 진행 중 엔진 destroy → 800ms 대기 → START → LED1~4 (1초 간격) → STOP.
              본체 LED 점등 여부로 페이지 환경(정상) vs engine 호출 패턴(원인) 분리. */}
          <button
            type="button"
            onClick={handleDebugTestBlink}
            disabled={debugBlinkRunning}
            data-testid="debug-testblink-button"
            className="mt-3 px-4 py-2 rounded-lg text-xs"
            style={{
              backgroundColor: COLOR_CARD,
              border: `1px solid ${COLOR_GRAY}`,
              color: debugBlinkRunning ? '#6B7280' : COLOR_LIME,
            }}
          >
            {debugBlinkRunning ? '진단 점등 중…' : '🔧 이 화면에서 testBlink 시퀀스 실행'}
          </button>
          <div className="mt-1 text-xs text-center" style={{ color: '#6B7280', maxWidth: 280 }}>
            {debugBlinkResult}
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
