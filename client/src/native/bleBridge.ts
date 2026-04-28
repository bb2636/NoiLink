import {
  COLOR_CODE,
  CTRL_START,
  CTRL_STOP,
  NATIVE_BRIDGE_VERSION,
  encodeLegacyControlStartFrame,
  encodeLegacyControlStopFrame,
  encodeLegacyLedFrame,
  type BleScanFilterPayload,
  type ColorCode,
  type ControlCmd,
  type NoiPodCharacteristicKey,
  type SessionPhase,
  type WebToNativeMessage,
} from '@noilink/shared';
import { isNoiLinkNativeShell } from './initNativeBridge';
import { getBleFirmwareReady } from './bleFirmwareReady';
import { getLegacyBleMode, uint8ArrayToBase64 } from './legacyBleMode';

function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * 펌웨어 미탑재 기기(예: u-blox NINA-B1 디폴트 펌웨어, 광고명 'NINA-B1-XXXXXX')에
 * BLE write 를 보내봐야 모듈 단에서 무시되며, 일부 펌웨어는 응답이 없어
 * withResponse write 가 timeout → ack(false) 토스트로 이어진다.
 *
 * 그래서 "정식 펌웨어 아님(=getBleFirmwareReady() === false)" 으로 확인된 경우에는
 * write 류 메시지만 silent no-op 처리한다. 스캔/연결/구독/재연결 같은 비-write
 * 메시지는 그대로 보내, 디바이스 페이지의 연결 흐름과 TOUCH notify(펌웨어가
 * 들어오면 자동으로 살아남) 는 영향이 없다.
 */
const BLE_WRITE_TYPES: ReadonlySet<WebToNativeMessage['type']> = new Set([
  'ble.writeLed',
  'ble.writeSession',
  'ble.writeControl',
  'ble.writeCharacteristic',
]);

function post(message: WebToNativeMessage): void {
  if (!isNoiLinkNativeShell()) return;
  if (BLE_WRITE_TYPES.has(message.type) && getBleFirmwareReady() === false) {
    return;
  }
  window.ReactNativeWebView!.postMessage(JSON.stringify(message));
}

// ─── 레거시 모드 BLE write 직렬화 큐 ─────────────────────────────────────────
// 트레이닝 엔진이 같은 JS turn 에 여러 LED/CONTROL 프레임을 post 하면 (예:
// `flashAll`, `lightTwoPods`, MEMORY RECALL, START 중복 송신), native shell 의
// `dispatchWebMessage` 가 메시지마다 별도 promise 로 처리하기 때문에 ble-plx
// 의 GATT 큐가 동시 N 개 write 를 받게 된다. NUS 계열 (NINA-B1) 펌웨어는
// withoutResponse 동시 폭주를 못 따라가서 일부 write 가 'operation was
// cancelled' 로 drop 되거나 펌웨어가 LED 출력을 통째로 무시한다.
//
// 사용자 보고 ("진단 송신 카운터는 올라가는데 본체 LED 변화 없음") 의 직접적
// 원인. 테스트 점등(`Device.handleTestBlink`) 은 매 송신 사이 `await sleep(1000)`
// 으로 자연스럽게 직렬화돼 잘 동작했다.
//
// 본 큐는 레거시 분기에서 `bleWriteCharacteristic` 호출을 50ms 간격으로 흩뿌려,
// 가장 빠른 박자 (BPM 200 = 300ms 간격) 에서도 안정적으로 들어가게 만든다.
const LEGACY_WRITE_INTERVAL_MS = 50;
let legacyWriteQueue: Array<() => void> = [];
let legacyWriteTimer: ReturnType<typeof setTimeout> | null = null;
let legacyLastWriteAt = 0;

function scheduleLegacyDrain(): void {
  if (legacyWriteTimer != null) return;
  const drain = (): void => {
    const next = legacyWriteQueue.shift();
    if (!next) {
      legacyWriteTimer = null;
      return;
    }
    try {
      next();
    } catch {
      // post 자체는 실패해도 큐 진행 보장
    }
    legacyLastWriteAt = Date.now();
    if (legacyWriteQueue.length > 0) {
      legacyWriteTimer = setTimeout(drain, LEGACY_WRITE_INTERVAL_MS);
    } else {
      legacyWriteTimer = null;
    }
  };
  // 이전 송신 직후라면 LEGACY_WRITE_INTERVAL_MS 만큼 기다리고, 충분히 비어있다면
  // 즉시 처리(첫 송신에서 불필요한 50ms 지연을 피한다).
  const since = Date.now() - legacyLastWriteAt;
  const delay = Math.max(0, LEGACY_WRITE_INTERVAL_MS - since);
  legacyWriteTimer = setTimeout(drain, delay);
}

function enqueueLegacyWrite(fn: () => void): void {
  legacyWriteQueue.push(fn);
  scheduleLegacyDrain();
}

/**
 * STOP / PAUSE 같은 우선 송신: 펜딩 LED write 를 모두 버리고 큐 맨 앞으로 보낸다.
 * 트레이닝 종료/일시정지/백그라운드 시 사용자가 즉시 LED OFF 를 기대하는데, 큐에
 * 쌓인 LED ON 들이 STOP 보다 먼저 송신되면 펌웨어가 한 박자 더 켜진 채로 멈춘다.
 * STOP 을 우선 처리하면 그 느낌을 없앨 수 있다.
 */
function enqueueLegacyWritePriority(fn: () => void): void {
  // 펜딩된 일반 LED write 는 어차피 STOP 이후 무의미하므로 비운다.
  legacyWriteQueue = [fn];
  scheduleLegacyDrain();
}

export function bleEnsureReady(): void {
  post({ v: NATIVE_BRIDGE_VERSION, id: newRequestId(), type: 'ble.ensureReady' });
}

export function bleStartScan(options?: { filter?: BleScanFilterPayload; timeoutMs?: number }): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.startScan',
    payload: options,
  });
}

export function bleStopScan(): void {
  post({ v: NATIVE_BRIDGE_VERSION, id: newRequestId(), type: 'ble.stopScan' });
}

export function bleConnect(deviceId: string): void {
  post({ v: NATIVE_BRIDGE_VERSION, id: newRequestId(), type: 'ble.connect', payload: { deviceId } });
}

export function bleDisconnect(deviceId?: string): void {
  post({ v: NATIVE_BRIDGE_VERSION, id: newRequestId(), type: 'ble.disconnect', payload: { deviceId } });
}

/**
 * Notify 구독. UUID는 네이티브 셸이 NoiPod 상수에서 매핑합니다.
 */
export function bleSubscribeCharacteristic(
  subscriptionId: string,
  key: NoiPodCharacteristicKey
): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.subscribeCharacteristic',
    payload: { subscriptionId, key },
  });
}

export function bleUnsubscribeCharacteristic(subscriptionId: string): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.unsubscribeCharacteristic',
    payload: { subscriptionId },
  });
}

/**
 * Characteristic write. UUID는 네이티브 셸이 NoiPod 상수에서 매핑합니다.
 *
 * `mode`로 BLE write 신뢰도를 지정할 수 있다. NUS(Nordic UART) 계열 펌웨어처럼
 * 응답을 보내지 않는 펌웨어는 'withoutResponse'를 명시해야 한다 — 'auto' 폴백이
 * `withResponse` 시도로 넘어가면 응답이 없어 ble-plx 가 timeout 으로 누적되어
 * 다음 write 가 silent drop 된다.
 */
export function bleWriteCharacteristic(
  key: NoiPodCharacteristicKey,
  base64Value: string,
  mode?: 'auto' | 'withResponse' | 'withoutResponse'
): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.writeCharacteristic',
    payload: mode ? { key, base64Value, mode } : { key, base64Value },
  });
}

/**
 * LED 점등 프레임 송신. 네이티브 미연결(웹/Expo Go)이면 자동 no-op.
 *
 * `mode`로 BLE write 신뢰도를 지정할 수 있다. OFF 프레임처럼 손실되면
 * 시각적 잔상이 남는 프레임은 'withResponse'(ack 보장)를 권장한다.
 * 일반 점등 프레임은 기본 'auto'로 두면 된다(저지연 우선).
 */
export function bleWriteLed(payload: {
  tickId: number;
  pod: number;
  colorCode: ColorCode;
  onMs: number;
  flags?: number;
  mode?: 'auto' | 'withResponse' | 'withoutResponse';
}): void {
  // 레거시 모드: NoiPod 12바이트 프레임 대신 savexx 명세 §12.5 의 3바이트
  // `4e <pod+1> 0d` 로 점등 신호만 전송. OFF 의도(colorCode=OFF 또는 onMs=0)는
  // 레거시 펌웨어에서 단일 pod OFF 명령이 정의되지 않았으므로 송신 생략.
  if (getLegacyBleMode()) {
    const isOff = payload.colorCode === COLOR_CODE.OFF || payload.onMs === 0;
    if (isOff) return;
    try {
      const bytes = encodeLegacyLedFrame({ pod: payload.pod });
      const b64 = uint8ArrayToBase64(bytes);
      // NUS 펌웨어는 응답을 보내지 않으므로 명시적으로 'withoutResponse' 로 송신.
      // 'auto' 폴백이 `withResponse` 로 넘어가면 ble-plx 가 응답을 기다리다 timeout
      // 으로 누적되어 트레이닝 박자에 맞춘 빠른 연속 LED 가 silent drop 된다.
      // 큐화: 같은 JS turn 의 연속 송신을 50ms 간격으로 흩뿌려야 ble-plx GATT 큐가
      // 안 막힌다. 자세한 사유는 enqueueLegacyWrite 의 주석 참조.
      enqueueLegacyWrite(() => {
        bleWriteCharacteristic('write', b64, 'withoutResponse');
      });
    } catch {
      // pod 범위 초과 등 인코딩 실패는 silent skip (트레이닝 흐름 보호)
    }
    return;
  }
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.writeLed',
    payload,
  });
}

/** 세션 시작 메타 (BPM/Level/페이즈/길이) — 트레이닝 시작 시 1회 */
export function bleWriteSession(payload: {
  bpm: number;
  level: number;
  phase: SessionPhase;
  durationSec: number;
  flags?: number;
}): void {
  // 레거시 펌웨어는 SESSION 메타를 모르므로 송신 생략.
  if (getLegacyBleMode()) return;
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.writeSession',
    payload,
  });
}

/** START / STOP / PAUSE 컨트롤 */
export function bleWriteControl(cmd: ControlCmd): void {
  // 레거시 모드: START → `aa 55`, STOP → `ff`, PAUSE → 미정의(skip).
  // LED 와 동일한 이유로 NUS 펌웨어에는 'withoutResponse' 로 명시 송신.
  if (getLegacyBleMode()) {
    if (cmd === CTRL_START) {
      const b64 = uint8ArrayToBase64(encodeLegacyControlStartFrame());
      enqueueLegacyWrite(() => {
        bleWriteCharacteristic('write', b64, 'withoutResponse');
      });
    } else if (cmd === CTRL_STOP) {
      const b64 = uint8ArrayToBase64(encodeLegacyControlStopFrame());
      // STOP 은 우선 큐 — 펜딩 LED write 를 모두 비우고 즉시 송신해야 사용자가
      // 일시정지/취소 시 본체가 한 박자 더 깜박이지 않는다.
      enqueueLegacyWritePriority(() => {
        bleWriteCharacteristic('write', b64, 'withoutResponse');
      });
    }
    return;
  }
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.writeControl',
    payload: { cmd },
  });
}

/** GATT 서비스/캐릭터리스틱 자동 탐색 (재연결 없이 강제 재탐색) */
export function bleDiscoverGatt(): void {
  post({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'ble.discoverGatt',
  });
}

/**
 * 자동 재연결의 백오프 카운트다운을 건너뛰고 즉시 다음 재시도를 트리거하도록 네이티브에 요청.
 *
 * 사용 시나리오: 단절 직후 사용자가 디바이스를 다시 켰거나 거리가 가까워졌을 때,
 * 1s/2s/4s 백오프가 끝나길 기다리지 않고 바로 재연결을 시도해 회복 속도를 높인다.
 *
 * 멱등성: 네이티브 측이 이미 connectToDevice 중이거나 재연결 의도가 없으면 no-op.
 * 네이티브 미연결(웹/Expo Go)이면 자동 no-op.
 */
export function bleReconnectNow(): void {
  post({ v: NATIVE_BRIDGE_VERSION, id: newRequestId(), type: 'ble.reconnect.now' });
}
