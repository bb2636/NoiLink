/**
 * 트레이닝 진행 화면 — 점등 신호 송신 + 타이머 + 결과 수집의 단일 진입점.
 *
 * 정책(사용자 결정):
 * - 화면에 4개 패널 시각화는 그리지 않는다. 점등 표시는 기기(NoiPod) LED 가
 *   단독으로 담당한다 (앱 → BLE LED frame).
 * - 화면은 큰 타이머 + 페이즈/모드 안내 + 일시정지/재개/취소/뒤로 버튼만 노출.
 * - 모든 채점 입력은 기기의 11바이트 BLE TOUCH notify 단일 소스로 들어온다
 *   (`ble.touch` → `engine.handleTap`). 화면 클릭은 입력으로 인정하지 않는다.
 * - 트레이닝 시간이 끝나면 자동으로 결과 화면(`/result`) 으로 넘어간다.
 *
 * 동작:
 * - 모드별 룰(FOCUS/MEMORY/COMPREHENSION/JUDGMENT/AGILITY/ENDURANCE/COMPOSITE/RHYTHM/FREE)
 *   을 `TrainingEngine` 이 실시간 진행하며, 점등 시점마다 BLE LED frame 을 직접 송신.
 * - 종료 시 엔진이 산출한 원시 메트릭을 서버로 제출 → 개인 리포트/랭킹/기업 리포트 자동 연동.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import ConfirmModal from '../components/ConfirmModal/ConfirmModal';
import SuccessBanner from '../components/SuccessBanner/SuccessBanner';
import type { Level, NativeToWebMessage, RawMetrics, TrainingMode } from '@noilink/shared';
import {
  SESSION_MAX_MS,
  partialThresholdForMode,
  resolveBleStabilityThresholds,
  tryParseAnyNotifyBase64,
  nfcTextToPod,
  irTouchCountDelta,
} from '@noilink/shared';
import { submitCompletedTrainingWithRetry } from '../utils/submitTrainingRun';
import { createPendingLocalId, enqueuePendingRun } from '../utils/pendingTrainingRuns';
import { reportBleAbortFireAndForget } from '../utils/reportBleAbort';
import { TrainingEngine, type EnginePhaseInfo } from '../training/engine';
import {
  bleReconnectNow,
  bleSubscribeCharacteristic,
  bleUnsubscribeCharacteristic,
  getLegacyEmittedCount,
  getLegacyLastEmittedFrameHex,
} from '../native/bleBridge';
import { getBleFirmwareReady } from '../native/bleFirmwareReady';
import { getLegacyBleMode } from '../native/legacyBleMode';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { subscribeAckErrorBanner, type AckBannerSubscription } from '../native/nativeAckErrors';
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
  /**
   * 결과 저장이 묶이는 1차(주) 사용자.
   * 다중 진행 회원 선택(`participantIds`) 의 첫 번째와 동일하게 유지된다.
   * 세션 엔진은 현재 단일 사용자 기준으로 동작하므로 점수/메트릭은 이 사용자에게 귀속된다.
   * (TODO: 다중 사용자 동시 세션 분기 시 각 participantId 별 결과 저장으로 확장)
   */
  userId: string;
  /**
   * 기업 회원 진행 회원 다중 선택 결과 (TrainingSetup → 여기로 그대로 전달).
   * 길이 1 이상이고, `userId === participantIds[0]` 가 보장된다.
   * 단일 진행 회원 케이스에서는 `[userId]` 한 개만 들어온다.
   */
  participantIds?: string[];
  title: string;
  totalDurationSec: number;
  bpm: number;
  level: Level;
  yieldsScore: boolean;
  isComposite: boolean;
  /**
   * 자유 트레이닝(FREE) 자유설정 (Task #154).
   * apiMode === 'FREE' 일 때만 의미가 있으며, 그 외 모드에서는 무시된다.
   * 미지정이면 엔진이 `{ color: 'GREEN', sequenceMode: 'RANDOM' }` 폴백.
   */
  freeConfig?: import('../training/engine').EngineFreeConfig;
  // 위 import 타입에 colorMode/unlimited/sequenceMode/color 가 모두 포함되므로 별도 필드 없음.
  /**
   * FREE 모드에서 사용자가 setup 화면에서 선택한 Pod 수. 다른 모드는 항상 4
   * (펌웨어 LED 4채널 전제) 로 고정. FREE 만 사용자가 1~4 사이로 선택할 수
   * 있어 fireFreeTick 의 점등 대상 범위를 결정한다.
   */
  podCount?: number;
};

// 기존 PHASE_LABEL/COG_LABEL 라벨 맵은 큰 원형 게이지 디자인에서 화면에 노출되지 않게
// 정리되어 함께 제거됨 — 페이즈/모드 정보는 LED + BPM 배지로 통합 표현한다.

// 모드별 입력 안내 — 게이지 아래의 디버깅/확인 라인에서 사용한다.
// 사용자가 "이 모드에서 기기에 어떤 입력을 줘야 하나?" 를 화면에서 즉시 보고
// 그 결과(입력 N회 카운트)와 매칭해 NFC/IR/TOUCH 가 채점에 잘 들어오는지 확인.
function modeHintText(mode: string): string {
  switch (mode) {
    case 'RHYTHM':        return '점등 순간 정확히 탭! · P0 → P1 → P2 → P3';
    case 'FOCUS':         return '🔵 파랑(BLUE)만 탭. 빨강/노랑은 무시.';
    case 'MEMORY':        return '초록 순서를 외우고, 흰 신호 뒤 같은 순서로 탭.';
    case 'COMPREHENSION': return '현재 규칙 색만 탭. 흰색 신호 후 규칙 변경.';
    case 'JUDGMENT':      return '🟢 초록=1탭, 🔴 빨강=참기, 🟡 노랑=2탭(더블).';
    case 'AGILITY':       return '🟢 초록=손, 🔵 파랑/🟡 노랑=발. Lv4부터 동시.';
    case 'ENDURANCE':     return '🔵 파랑(BLUE) 타겟을 일정 속도로 끝까지 탭.';
    case 'FREE':          return '자유롭게 탭 (점수는 기록되지 않음).';
    default:              return '';
  }
}

export default function TrainingSessionPlay() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as TrainingRunState | null;

  // FREE 무제한 모드는 SESSION_MAX_MS clamp 와 자동 종료를 모두 우회한다
  // (Task #154). 엔진은 Number.MAX_SAFE_INTEGER 만큼 totalDurationMs 를
  // 받지만 startElapsedRaf 가 freeConfig.unlimited 를 보고 complete() 호출을
  // 스킵하므로 사용자가 화면 "종료" 버튼을 누르기 전까지 계속 진행된다.
  const isFreeUnlimited =
    state?.apiMode === 'FREE' && state.freeConfig?.unlimited === true;
  const totalSec = state
    ? isFreeUnlimited
      ? state.totalDurationSec
      : Math.min(state.totalDurationSec, SESSION_MAX_MS / 1000)
    : 0;
  const totalMs = isFreeUnlimited ? Number.MAX_SAFE_INTEGER : totalSec * 1000;

  // 화면에 점등 시각화를 그리지 않는다 (정책: 점등 표시는 기기 LED 가 단독으로
  // 담당, 화면은 큰 타이머/안내/결과만). 엔진의 onPodStates 콜백은 LED 신호 송신
  // 용도로 내부에서만 쓰이므로 React 상태로 보관할 필요가 없다.
  const [elapsedMs, setElapsedMs] = useState(0);
  const [phaseInfo, setPhaseInfo] = useState<EnginePhaseInfo>({ phase: 'IDLE', cycleIndex: 0 });
  const [tapCount, setTapCount] = useState(0);
  // BLE 송신 진단 — 1Hz 폴링으로 화면 하단 한 줄에 노출. 점등이 안 들어올 때
  // (펌웨어 미준비 / 잘못된 모드 / 송신 0건 / 마지막 프레임 hex) 를 사용자/QA 가
  // 화면에서 즉시 확인할 수 있게 한다. 폴링 주기를 짧게 잡아도 비용은 무시 가능
  // (모두 단순 ref/storage 읽기).
  const [bleDiag, setBleDiag] = useState<{
    fwLabel: string;
    legacyLabel: string;
    emitted: number;
    lastFrame: string;
    received: number;
    lastRx: string;
  }>({ fwLabel: '?', legacyLabel: '?', emitted: 0, lastFrame: '', received: 0, lastRx: '' });
  // BLE notify 수신 진단 — onBridge 에서 모든 ble.notify 가 들어올 때마다 카운트 +
  // 마지막 raw hex 를 보관. 1Hz 폴링으로 화면에 노출해 "송신은 74건인데 입력 0건"
  // 같은 한쪽 단절 케이스를 즉시 추적할 수 있게 한다 (특히 NFC 태그 텍스트가
  // 펌웨어가 보내는 raw ASCII 와 매핑되는지 hex 로 확인).
  const notifyDiagRef = useRef<{ count: number; lastHex: string }>({ count: 0, lastHex: '' });
  useEffect(() => {
    const tick = () => {
      const fw = getBleFirmwareReady();
      // 마지막 프레임 hex 가 길어 좁은 화면(360px) 에서 가로 오버플로/줄바꿈을
      // 일으키지 않도록 앞 20자만 노출 (LED 11B = 33자, IR 5B = 14자 등).
      const raw = getLegacyLastEmittedFrameHex() || '';
      const lastFrame = raw.length > 20 ? `${raw.slice(0, 20)}…` : raw;
      const rxRaw = notifyDiagRef.current.lastHex;
      const lastRx = rxRaw.length > 20 ? `${rxRaw.slice(0, 20)}…` : rxRaw;
      setBleDiag({
        fwLabel: fw === true ? 'O' : fw === false ? 'X' : '?',
        legacyLabel: getLegacyBleMode() ? 'ON' : 'OFF',
        emitted: getLegacyEmittedCount(),
        lastFrame,
        received: notifyDiagRef.current.count,
        lastRx,
      });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  // 사용자가 일시정지/재개를 화면에서 직접 토글할 수 있도록 상태로 들고 간다.
  // 엔진의 pause()/resume() 와 동기화 (자동 백그라운드 일시정지 분기는 동일 메서드를 호출).
  const [isPaused, setIsPaused] = useState(false);
  const [engineMetrics, setEngineMetrics] = useState<Omit<RawMetrics, 'sessionId' | 'userId'> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 백그라운드 중단이 임계값 이상에서 발생했을 때만 띄우는 "부분 결과 저장" 모달.
  // partialProgressPct는 모달에 노출하는 안내용 진행률(반올림된 정수 %).
  const [partialFinishOpen, setPartialFinishOpen] = useState(false);
  const [partialProgressPct, setPartialProgressPct] = useState(0);

  const engineRef = useRef<TrainingEngine | null>(null);
  // 현재 점등 중인 pod 인덱스(엔진 onPodStates 콜백이 매 점등마다 갱신).
  // 5바이트 IR 진동 패킷은 어느 pod 인지 정보가 없으므로 이 ref 의 첫 항목으로
  // 매핑해 engine.handleTap 에 흘려보낸다 — 사용자 정책 1=A.
  const litPodIdsRef = useRef<number[]>([]);
  // 현행 펌웨어 IR 5바이트 패킷의 누적 touchCount 직전 값 (u8 wrap).
  // 첫 패킷은 baseline 만 잡고 입력으로 인정하지 않는다 (irTouchCountDelta).
  const prevIrTouchCountRef = useRef<number | null>(null);
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
  // 외부 닫힘은 ackBannerSubRef 의 두 콜백으로 분리해 흘린다 — X 닫기 버튼은
  // notifyDismissed() (user-dismiss), SuccessBanner 자체 duration 타이머는
  // notifyBannerTimeout() (banner-timeout). Task #116, Task #129 참조.
  const ackBannerSubRef = useRef<AckBannerSubscription | null>(null);
  useEffect(() => {
    const sub = subscribeAckErrorBanner(setAckErrorBanner);
    ackBannerSubRef.current = sub;
    return () => {
      sub.unsubscribe();
      ackBannerSubRef.current = null;
    };
  }, []);

  // ── 엔진 lifecycle ──
  useEffect(() => {
    if (!state) return;
    const engine = new TrainingEngine({
      mode: state.apiMode,
      bpm: state.bpm,
      level: state.level,
      totalDurationMs: totalMs,
      // FREE 모드만 사용자가 setup 화면에서 1~4 사이로 선택 가능 (Task #154).
      // 다른 모드는 펌웨어 LED 4채널 전제로 항상 4. fireFreeTick 의 nPods<=0
      // 가드와 함께 두 겹의 보호.
      podCount: state.apiMode === 'FREE' ? Math.max(1, Math.min(4, state.podCount ?? 4)) : 4,
      isComposite: state.isComposite || state.apiMode === 'COMPOSITE',
      // Task #154: FREE 자유설정(색·진행 방식) 을 엔진까지 흘려보낸다. 미지정
      // 시 엔진이 'GREEN'/RANDOM 폴백으로 동작 — TrainingSetup 의 FREE 분기가
      // 항상 freeConfig 를 채워 보내므로 정상 흐름에서는 폴백을 타지 않는다.
      freeConfig: state.freeConfig,
      onPodStates: (states) => {
        // 화면에 그리지 않는다 — LED 송신은 엔진 내부에서 BLE 로 직접 처리.
        // 다만 현행 NINA-B1 펌웨어가 보내는 5바이트 IR 진동 패킷은 어느 pod 가
        // 눌렸는지 정보를 싣지 않으므로(touchCount 만 증가), "현재 점등된 pod"
        // 를 ref 에 저장해 두었다가 진동 입력을 받을 때 그 첫 점등 pod 로 매핑한다
        // (사용자 정책 1=A: 현재 점등 pod 자동 매핑).
        litPodIdsRef.current = states
          .filter((p) => p.fill !== 'OFF' && p.litAt !== null)
          .map((p) => p.id);
      },
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
        // 펌웨어 미탑재 기기(예: NINA-B1 디폴트)는 idle 단절이 빈번하다.
        // 단절 알림 자체를 무시하고 트레이닝을 그대로 진행시킨다 — 그 사이의
        // 입력은 채점에서 빠질 수 있으나, 단절이 끝나면 다시 BLE TOUCH 가
        // 정상 수신되어 트레이닝이 끊김 없이 이어진다.
        if (getBleFirmwareReady() === false) return;
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

  // BLE TOUCH 는 단일 입력 소스이지만, 네이티브 측 재전송/notify 중복 콜백으로
  // 동일 (pod, tickId) 가 두 번 도착해도 카운트는 1회만 증가하도록 dedup 한다.
  // (엔진 단의 `consumedTickIds` 와 별개로 UI 카운터 보호용.)
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

  // ── BLE TOUCH notify 구독 + 이벤트 수신 ──
  // 모든 채점 입력의 단일 소스 — 기기(NoiPod) 의 11바이트 TOUCH notify
  // (A5 81 + tickId u32 + pod + channel + deltaMs i16 + flags) 만 채점에 반영한다.
  // 앱 화면에는 4개 패널 시각화 자체를 그리지 않으므로 화면 클릭으로 인한
  // 잘못된 채점 입력 가능성도 원천 차단된다.
  // 네이티브 셸이 아니거나 디바이스 미연결이면 ble.subscribeCharacteristic은 자동 no-op.
  useEffect(() => {
    const subscriptionId = `training-touch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    bleSubscribeCharacteristic(subscriptionId, 'notify');

    const onBridge = (e: Event) => {
      const detail = (e as CustomEvent<NativeToWebMessage>).detail;
      if (!detail) return;

      // (1) 차세대 NoiPod 11바이트 TOUCH 프레임 — 네이티브 디스패처가 미리 파싱해
      //     `ble.touch` 메시지로 보낸다. pod/deltaMs/tickId 가 모두 들어있어 그대로 사용.
      if (detail.type === 'ble.touch') {
        const t = detail.payload.touch;
        const useDelta = t.deviceDeltaValid ? t.deltaMs : undefined;
        // 명세 F. 멀티태스킹: BLE TOUCH 는 손(Touch) 채널 입력으로 분류한다.
        const accepted = engineRef.current?.handleTap(t.pod, { deltaMs: useDelta, tickId: t.tickId, source: 'touch' }) ?? false;
        if (accepted) bumpTapCount(t.pod, t.tickId);
        return;
      }

      // (2) 현행 NINA-B1-FB55CE 펌웨어의 raw notify (`ble.notify`) — 5바이트 IR 패킷
      //     또는 NFC NDEF Text Record. base64 페이로드를 직접 분류 → 매핑 → 엔진 입력.
      //     payload.touch 가 함께 와서 (1) 에서 이미 처리된 경우는 중복 방지를 위해 스킵.
      if (detail.type === 'ble.notify' && detail.payload.key === 'notify') {
        // 분류 전 모든 notify 를 진단 카운터에 우선 반영. 분류 실패(매핑 안 되는
        // NFC 텍스트/예상 외 패턴)도 화면에서 hex 로 확인할 수 있어야 NFC 태그
        // 인식 디버깅이 가능하다.
        try {
          const bin = atob(detail.payload.base64Value);
          let hex = '';
          for (let i = 0; i < bin.length; i++) {
            hex += (i ? ' ' : '') + bin.charCodeAt(i).toString(16).padStart(2, '0');
          }
          notifyDiagRef.current.count += 1;
          notifyDiagRef.current.lastHex = hex;
        } catch {
          // base64 디코딩 실패는 사일런트 — 진단 라인은 비울 뿐 화면 흐름에 영향 없음.
        }
        if (detail.payload.touch) return; // (1) 에서 이미 처리됨
        const ev = tryParseAnyNotifyBase64(detail.payload.base64Value);
        if (!ev) return;
        if (ev.type === 'TOUCH') {
          // 분류기가 TOUCH 로 잡았는데 payload.touch 가 비어 있는 케이스 — 동일 데이터로 채점.
          // 명세 F: 손(Touch) 채널 입력으로 분류.
          const useDelta = ev.deviceDeltaValid ? ev.deltaMs : undefined;
          const accepted = engineRef.current?.handleTap(ev.pod, { deltaMs: useDelta, tickId: ev.tickId, source: 'touch' }) ?? false;
          if (accepted) bumpTapCount(ev.pod, ev.tickId);
          return;
        }
        if (ev.type === 'IR') {
          // 펌웨어 누적 touchCount 가 증가한 만큼만 진동 입력으로 인정. 첫 패킷은
          // baseline (delta=0) 으로 흡수해 잘못된 입력 폭주를 막는다.
          const prev = prevIrTouchCountRef.current;
          const delta = irTouchCountDelta(prev, ev.touchCount);
          prevIrTouchCountRef.current = ev.touchCount;
          if (delta <= 0) return;
          // 현재 점등 pod 가 없으면 채점할 수 없으므로 무시 (대기 구간/페이즈 전환 등).
          // 점등이 한 개 이상이면 첫 점등 pod 로 매핑 — 단순/예측 가능한 정책.
          const targetPod = litPodIdsRef.current[0];
          if (targetPod === undefined) return;
          // 펌웨어 한 패킷에 delta>1 이 들어오는 경우(loss 보상)는 같은 pod 에 N회 친 것으로 간주.
          // 명세 F: IR 진동 센서 입력은 손(Touch) 채널로 분류한다 (진동 = 손으로 두드린 것).
          for (let i = 0; i < delta; i++) {
            const accepted = engineRef.current?.handleTap(targetPod, { source: 'touch' }) ?? false;
            if (accepted) bumpTapCount(targetPod, undefined);
          }
          return;
        }
        if (ev.type === 'NFC_TEXT') {
          // NFC 태그 텍스트(예: "left", "1")를 두 컨벤션 모두 인식해 pod 로 매핑 (사용자 정책 2=C).
          // 매칭 안 되면 무시 — 사용자가 자유 라벨링해도 잘못된 입력이 발생하지 않는다.
          // 명세 F: NFC 입력은 발(NFC) 채널로 분류한다.
          const pod = nfcTextToPod(ev.text);
          if (pod === null) return;
          const accepted = engineRef.current?.handleTap(pod, { source: 'nfc' }) ?? false;
          if (accepted) bumpTapCount(pod, undefined);
          return;
        }
      }
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
    // 직전 점수 조회는 submitCompletedTraining 안에서 calculateMetrics 와
    // 병렬로 일어난다(Task #122). 정상 완료 흐름은 결과 화면이 "이미 채워진"
    // navigate state.previousScore 를 그대로 쓰고, 재진입 흐름은 Result.tsx 가
    // 같은 단건 엔드포인트를 직접 호출한다 — 두 경로가 같은 서버 진실원에
    // 묶여 비교 카드 정책이 한 줄로 흐른다.
    //   `includePreviousScore: true` 는 결과 화면을 곧장 띄울 사용자 흐름에서만
    //   넘긴다(background drain 은 결과 화면을 띄우지 않으므로 false 로 둔다).
    const res = await submitCompletedTrainingWithRetry(
      {
        userId: state.userId,
        mode: state.apiMode,
        bpm: state.bpm,
        level: state.level,
        // FREE 무제한 모드는 사용자가 종료 버튼을 눌러야 끝나므로 totalSec 가
        // 무의미한 큰 값(MAX_SAFE_INTEGER/1000) 이다. 서버 `Session.duration`
        // 이 의미 있는 값을 가지도록 실제 경과를 초 단위(올림) 로 덮어쓴다.
        // 이 값은 totalTimeRanking 의 일별 누적 시간 계산에 그대로 사용된다.
        totalDurationSec: isFreeUnlimited
          ? Math.max(1, Math.ceil(elapsedMsRef.current / 1000))
          : totalSec,
        yieldsScore: state.yieldsScore,
        isComposite: state.isComposite,
        tapCount,
        engineMetrics: metrics ?? undefined,
        existingSessionId: partialSessionIdRef.current,
        partialProgressPct: partialPct,
        // 화면 내 자동·수동 재시도가 모두 같은 idempotency 키를 쓰도록 세션 시작 시
        // 발급한 안정 키를 그대로 흘려보낸다 — 서버가 첫 응답을 흡수해 중복 저장 방지.
        localId: localIdRef.current,
        // 결과 화면 비교 카드용 직전 점수를 결과 객체에 함께 담아 받는다 (Task #122).
        includePreviousScore: true,
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
    navigate('/result', {
      replace: true,
      state: {
        title: state.title,
        displayScore: res.displayScore,
        // 비교 카드에 사용할 직전 점수 (Task #122).
        // submitCompletedTraining 이 단건 엔드포인트로 받아둔 값을 그대로 흘려보낸다.
        // 첫 세션·조회 실패는 서버 측에서 `null` 로 정규화되어 오므로, navigate state
        // 에는 undefined 로 변환해 Result.tsx 의 "값 없음" 분기와 일관되게 한다.
        previousScore: res.previousScore ?? undefined,
        // 비교 카드의 직전 날짜 라벨용(Task #123) — 점수와 한 쌍으로 함께 전달.
        // 점수가 없으면 날짜도 undefined 라 라벨이 어긋나는 일이 없다.
        previousScoreCreatedAt: res.previousScoreCreatedAt ?? undefined,
        // 라벨이 디바이스 시간대로 흔들리지 않도록 KST 기준 표시용 날짜도
        // 함께 전달(Task #132). submit 유틸이 서버 단건 엔드포인트(같은 KST 헬퍼
        // `shared/kst-date.ts` 의 `isoToKstLocalDate` 로 만든 값) 응답을 그대로
        // 흘려보내므로 정상 완료/재진입 두 흐름의 라벨이 정확히 일치한다.
        previousScoreLocalDate: res.previousScoreLocalDate ?? undefined,
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
        // FREE 결과 화면 — 사용자가 실제 진행한 시간/입력 횟수(Task #154).
        // 다른 모드는 점수가 있어 별도 표시가 필요 없으므로 FREE 일 때만 채움.
        ...(state.apiMode === 'FREE'
          ? {
              freeDurationSec: isFreeUnlimited
                ? Math.max(0, Math.ceil(elapsedMsRef.current / 1000))
                : totalSec,
              freeTapCount: tapCount,
            }
          : {}),
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

  // 페이즈/모드 라벨은 큰 원형 게이지 디자인에서 화면에 노출하지 않는다 — 진행 정보는
  // 원형 게이지(시간) + BPM 배지(난이도/사이클) 로 통합. 페이즈 전환은 LED 가 시각화한다.
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
            // FREE 무제한 모드는 totalSec 가 형식상 placeholder(60s) 라
            // 큐로 그대로 적재하면 다음 background drain 이 잘못된 길이를
            // 서버에 영속화한다. runSubmit 과 동일하게 elapsedMsRef 기준
            // 실제 경과(초)로 덮어 정확한 duration 이 보존되도록 한다 (Task #154).
            totalDurationSec: isFreeUnlimited
              ? Math.max(1, Math.ceil(elapsedMsRef.current / 1000))
              : totalSec,
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

  // 원형 진행 게이지 — 이미지 디자인의 큰 라임색 원. SVG stroke-dashoffset 으로 진행률 표시.
  const RING_SIZE = 280;
  const RING_STROKE = 14;
  const RING_R = (RING_SIZE - RING_STROKE) / 2;
  const RING_C = 2 * Math.PI * RING_R;
  const ringDashOffset = RING_C * (1 - progress);

  return (
    <MobileLayout hideBottomNav>
      <div
        data-testid="training-session-play"
        className="max-w-md mx-auto px-5 flex flex-col"
        style={{
          // 화면을 한 화면에 딱 맞추고 스크롤은 막는다 — 트레이닝 중에 스크롤이
          // 발생하면 사용자가 게이지/타이머에 집중하지 못하고 화면이 흔들리는 인상을
          // 준다. 모든 콘텐츠는 안드로이드 status bar/제스처 바를 피하면서 한 뷰포트
          // 안에 들어가도록 위/아래 safe-area 만 최소로 확보한다.
          //
          // 사용자 보고: 모바일 WebView 에서 입력 카운터가 화면 밖으로 밀려 안 보임.
          // 100vh 는 iOS Safari/안드로이드 WebView 의 동적 주소창 영역까지 포함한
          // "전체 뷰포트" 라서 실제 보이는 영역(가시 viewport)을 초과해 콘텐츠가
          // 잘렸다. 100dvh(동적 viewport)로 바꿔 주소창 노출 여부와 무관하게
          // 게이지·힌트·카운터·버튼이 한 화면에 모두 들어오게 한다. dvh 미지원
          // 구형 브라우저는 100vh 로 자연 폴백된다.
          height: '100dvh',
          minHeight: '100vh',
          overflow: 'hidden',
          paddingTop: 'calc(0.25rem + env(safe-area-inset-top))',
          // 하단 버튼이 iOS 홈 인디케이터/안드로이드 제스처 바에 가리지 않도록 safe-area + 여유.
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)',
          color: '#fff',
          backgroundColor: '#0A0A0A',
        }}
      >
        {/* 헤더 — "< 트레이닝 진행" */}
        <div className="flex items-center gap-3 mb-2">
          <button onClick={leaveToList} className="text-white -ml-1 p-1" aria-label="뒤로">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-base font-semibold">트레이닝 진행</h1>
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

        {/* BPM 배지 — 라임 테두리 라운드 박스. 종합 모드는 사이클 정보를 함께 보여준다. */}
        <div className="flex items-center justify-center mt-3 mb-6">
          <div
            className="px-8 py-2.5 rounded-full text-base font-semibold tabular-nums"
            style={{ border: '1.5px solid #AAED10', color: '#AAED10' }}
            aria-label={`BPM ${state.bpm}`}
          >
            BPM&nbsp;&nbsp;{state.bpm}
            {isComposite && (
              <span className="ml-3 text-xs font-normal" style={{ color: '#7BA80B' }}>
                · 사이클 {phaseInfo.cycleIndex + 1}
              </span>
            )}
          </div>
        </div>

        {/*
          큰 원형 진행 게이지 — 화면의 메인 콘텐츠.
          정책: 트레이닝 진행 중 화면은 "기기에 점등 신호를 보내고, 시간을 보여주고,
          끝나면 결과로 넘어가는" 역할만 한다. 4개 패널(PodGrid) 같은 시각 동조는
          사용자가 화면을 누르고 싶게 만들기 때문에 노출하지 않는다 — 점등 표시는
          기기(NoiPod) 의 LED 가 담당하고, 모든 입력은 기기 BLE notify 단일 소스로 받는다.
          원 안: "총 N초" 작은 회색 + "MM:SS" 큰 흰색.
        */}
        {/*
          게이지 컨테이너 — 이전엔 flex-1 로 빈 공간을 다 차지해서 하단 버튼이
          화면 끝까지 밀려갔다. 사용자 요청에 따라 flex-1 을 제거해 게이지·힌트·
          버튼이 자연스럽게 위에서부터 쌓이고, 버튼이 타이머 바로 아래에 붙게 한다.
        */}
        <div className="flex flex-col items-center justify-center">
          <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
            <svg
              width={RING_SIZE}
              height={RING_SIZE}
              className="-rotate-90"
              aria-hidden="true"
            >
              {/* 배경 트랙 */}
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                stroke="#2A2A2A"
                strokeWidth={RING_STROKE}
                fill="none"
              />
              {/* 진행 라임 */}
              <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_R}
                stroke={isPaused ? '#666' : '#AAED10'}
                strokeWidth={RING_STROKE}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={RING_C}
                strokeDashoffset={ringDashOffset}
                style={{ transition: 'stroke-dashoffset 0.2s linear' }}
              />
            </svg>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center"
              aria-live="off"
              aria-label={`총 ${totalSec}초 중 ${mm}분 ${ss}초 경과`}
            >
              <div className="text-sm" style={{ color: '#888' }}>
                총 {totalSec}초
              </div>
              <div
                className="text-6xl font-semibold tabular-nums tracking-tight mt-1"
                style={{ color: '#FFFFFF' }}
              >
                {mm}:{ss}
              </div>
              {isPaused && (
                <div className="mt-2 text-xs font-semibold" style={{ color: '#FFD66B' }}>
                  일시정지됨
                </div>
              )}
            </div>
          </div>
        </div>

        {/*
          디버깅/확인용 안내 — 사용자가 기기(IR/NFC/TOUCH) 입력이 채점에 잘
          잡히는지 화면에서 즉시 알 수 있게 두 줄을 노출한다:
            1) 현재 모드에서 어떤 입력이 유효한지 (모드별 힌트)
            2) 실시간 입력 누적 카운트 (tapCount) — 기기를 누를 때마다 +1 되어야
               신호가 정상적으로 들어오는 것.
          디자인을 해치지 않게 작은 폰트/회색으로만 표기한다.
        */}
        <div className="mt-3 text-center" aria-live="polite">
          <p className="text-xs leading-relaxed" style={{ color: '#7BA80B' }}>
            {modeHintText(
              phaseInfo.phase === 'RHYTHM'
                ? 'RHYTHM'
                : (phaseInfo.cognitiveMode ?? state.apiMode),
            )}
          </p>
          <p
            className="mt-1 text-xs tabular-nums"
            style={{ color: '#888' }}
            data-testid="tap-count-debug"
          >
            입력 {tapCount}회
          </p>
          {/* BLE 송신 진단 한 줄 — 점등이 안 들어오는 원인을 사용자/QA 가 화면에서
              즉시 식별할 수 있게 노출. 펌웨어 ready 여부, 레거시 모드, 누적 송신
              횟수, 마지막 송신 프레임을 한 줄로 보여준다.
              - 펌웨어 미준비(FW=X) → bleBridge 가 모든 LED/SESSION/CONTROL write
                를 silent skip → 점등 0건의 가장 흔한 원인.
              - 레거시 모드(L=ON/OFF) → 현행 NINA-B1 펌웨어는 ON, NoiPod 신규
                펌웨어는 OFF. 잘못된 모드면 프레임 인코딩이 달라져 본체가 무시.
              - 송신=0 → 엔진이 LED 호출조차 안 하는 상태(트레이닝 자체가 멈춤).
              - 마지막 프레임 hex → 본체가 안 깜빡이면 "송신은 됐는데 본체가
                무시" vs "송신 자체가 안 됨" 을 구분.
              Task #150 의 safe* wrapper 가 BLE throw 를 silent swallow 하므로
              이 라인이 사실상 유일한 사용자측 진단 수단이다. */}
          <p
            className="mt-1 text-[10px] font-mono"
            style={{ color: '#555' }}
            data-testid="ble-diag"
          >
            BLE: FW={bleDiag.fwLabel} · L={bleDiag.legacyLabel} · TX={bleDiag.emitted}{bleDiag.lastFrame ? ` ${bleDiag.lastFrame}` : ''} · RX={bleDiag.received}{bleDiag.lastRx ? ` ${bleDiag.lastRx}` : ''}
          </p>
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

        {/* 원형 버튼 — 타이머/모드 안내 바로 아래에 붙도록 mt 만 살짝. 좌 취소(회색)
            + 우 일시정지/재개(주황). 빈 공간은 자연스럽게 화면 하단으로 남는다. */}
        <div className="mt-6 flex items-center justify-between px-4">
          <button
            type="button"
            onClick={leaveToList}
            disabled={submitting}
            className="rounded-full font-semibold flex items-center justify-center"
            style={{
              width: 72,
              height: 72,
              backgroundColor: '#2A2A2A',
              color: '#fff',
              fontSize: 15,
              opacity: submitting ? 0.5 : 1,
            }}
            aria-label="취소"
          >
            취소
          </button>
          {isFreeUnlimited ? (
            // FREE 무제한 모드(Task #154): 자동 완료가 없으므로 사용자가
            // 직접 "종료" 를 눌러 endNow() → complete() → onComplete 메트릭 →
            // submit 흐름을 트리거. 이 시점의 elapsed 가 서버 duration 으로
            // 저장된다. 일시정지/재개는 의미가 없어 종료 한 버튼만 노출.
            <button
              type="button"
              onClick={() => {
                const eng = engineRef.current;
                if (!eng) return;
                eng.endNow();
              }}
              disabled={submitting || !!engineMetrics}
              className="rounded-full font-semibold flex items-center justify-center"
              style={{
                width: 72,
                height: 72,
                backgroundColor: '#AAED10',
                color: '#000',
                fontSize: 15,
                opacity: (submitting || !!engineMetrics) ? 0.5 : 1,
              }}
              aria-label="종료"
            >
              종료
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                const eng = engineRef.current;
                if (!eng) return;
                if (isPaused) {
                  eng.resume();
                  setIsPaused(false);
                } else {
                  eng.pause();
                  setIsPaused(true);
                }
              }}
              disabled={submitting || !!engineMetrics}
              className="rounded-full font-semibold flex items-center justify-center"
              style={{
                width: 72,
                height: 72,
                backgroundColor: isPaused ? '#AAED10' : '#B8782A',
                color: isPaused ? '#000' : '#fff',
                fontSize: 15,
                opacity: (submitting || !!engineMetrics) ? 0.5 : 1,
              }}
              aria-label={isPaused ? '재개' : '일시정지'}
            >
              {isPaused ? '재개' : '일시정지'}
            </button>
          )}
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
          교차하는 시간은 짧고, 사용자는 어느 쪽이든 즉시 사유를 확인할 수 있다.
          Task #129: X 닫기 버튼을 노출하고 사용자 닫힘만 user-dismiss 로 흘린다. */}
      <SuccessBanner
        isOpen={!!ackErrorBanner}
        message={ackErrorBanner ?? ''}
        backgroundColor="#3a1212"
        textColor="#fca5a5"
        duration={5000}
        showCloseButton
        onClose={() => {
          ackBannerSubRef.current?.notifyBannerTimeout();
          setAckErrorBanner(null);
        }}
        onUserClose={() => {
          ackBannerSubRef.current?.notifyDismissed();
          setAckErrorBanner(null);
        }}
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

