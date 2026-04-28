/**
 * 싱글톤 BLE 컨트롤러 — react-native-ble-plx 래핑
 * UI는 ble.hooks / 화면에서 이 인스턴스만 경유 (직접 BleManager 생성 금지)
 *
 * v2 추가:
 *  - 구조화된 BleManagerError (code 포함)
 *  - connectionMeta.shouldReconnect로 사용자 의도 disconnect 추적
 *  - onDisconnected 감지 시 1s/2s/4s 백오프로 최대 3회 자동 재연결
 *  - bleEvents 훅으로 재연결 진행 이벤트를 dispatcher에 노출
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager as PlxBleManager, Device, State, type Subscription } from 'react-native-ble-plx';
import {
  resolveNoiPodCharacteristic,
  type BleErrorAction,
  type BleErrorCode,
  type BleDisconnectReason,
  type GattAutoSelection,
  type GattServiceMeta,
  type NoiPodCharacteristicKey,
} from '@noilink/shared';
import type { BleCharacteristicLocator, BleDiscoveryDevice, BleScanFilter, BleScanOptions } from './ble.types';
import { uint8ArrayToBase64 } from './bleEncoding';

export type BleWriteMode = 'auto' | 'withResponse' | 'withoutResponse';

export interface BleGattDiscoveryResult {
  services: GattServiceMeta[];
  selected: GattAutoSelection;
}

type Listener = () => void;

const RECONNECT_BACKOFF_MS = [1000, 2000, 4000] as const;

export class BleManagerError extends Error {
  code: BleErrorCode;
  action: BleErrorAction;
  deviceId?: string;

  constructor(code: BleErrorCode, action: BleErrorAction, message: string, deviceId?: string) {
    super(message);
    this.name = 'BleManagerError';
    this.code = code;
    this.action = action;
    this.deviceId = deviceId;
  }
}

export interface BleManagerEventHandlers {
  /** 예기치 않은 disconnect 직후, 재연결 시도 시작 직전 호출 */
  onConnectionLost?: (deviceId: string) => void;
  /** 매 재연결 시도 직전 호출 (attempt는 1부터) */
  onReconnectAttempt?: (deviceId: string, attempt: number, maxAttempts: number, nextDelayMs?: number) => void;
  /** 재연결 성공 */
  onReconnectSuccess?: (device: Device) => void;
  /** 모든 재시도 실패 */
  onReconnectFailed?: (deviceId: string) => void;
  /** 사용자 의도 disconnect (shouldReconnect=false 기준) */
  onUserDisconnect?: (deviceId: string) => void;
}

interface ConnectionMeta {
  deviceId: string;
  shouldReconnect: boolean;
}

export class NoiLinkBleController {
  private plx: PlxBleManager | null = null;
  private listeners = new Set<Listener>();
  private connected: Device | null = null;
  private connectionMeta: ConnectionMeta | null = null;
  private disconnectSubscription: Subscription | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectCancelResolver: (() => void) | null = null;
  /** runReconnect 인스턴스 식별용 — 새 connect/cancel 호출 시 증가시켜 이전 재시도를 무효화 */
  private reconnectGen = 0;
  private reconnecting = false;
  private scanActive = false;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  /** `${deviceId}|${serviceUUID}|${characteristicUUID}` → notify 구독 */
  private characteristicSubscriptions = new Map<string, Subscription>();
  private events: BleManagerEventHandlers = {};

  /**
   * 연결된 기기에서 실제로 발견된 UUID로 채워지는 동적 매핑.
   * 비어 있으면 `shared/ble-constants.ts`의 NoiPod 표준 UUID로 fallback.
   * 즉 "캡쳐된 UUID 우선 사용 + 실제 기기 GATT가 다르면 그것을 우선" 구조.
   */
  private dynamicLocators: Partial<Record<NoiPodCharacteristicKey, BleCharacteristicLocator>> = {};
  private lastGattDiscovery: BleGattDiscoveryResult | null = null;

  /**
   * GATT write 직렬화 체인 — 모든 `writeCharacteristic` 호출을 한 줄로 잇는다.
   *
   * 배경: WebView 의 `onMessage` 는 매 메시지마다 `void dispatchWebMessage(...)` 로
   * fire-and-forget 호출되고, dispatcher 는 각 메시지를 독립 promise chain 으로
   * 처리한다. 즉 JS 측이 `enqueueLegacyWrite` 로 50ms 간격을 띄워도 native 측에는
   * N 개의 `writeCharacteristic` 호출이 동시 in-flight 가 될 수 있다.
   *
   * react-native-ble-plx 의 `writeCharacteristicWithoutResponseForService` 는 OS 의
   * GATT 큐에 frame 을 enqueue 하고 즉시 리턴한다. NUS 계열(NINA-B1) 펌웨어는
   * `withoutResponse` 동시 폭주를 처리하지 못해 일부 frame 을 silent drop 하거나
   * LED 출력 자체를 무시한다 — 증상: JS 카운터/native 카운터는 올라가는데 본체
   * LED 가 안 변함.
   *
   * 본 체인은 모든 write 를 직렬로 묶어 이전 write 의 promise 가 settle 된 후에야
   * 다음 write 를 시작한다. handleTestBlink 가 1초 sleep 으로 자연 직렬화하던
   * 것과 같은 효과를, 모든 write 경로(트레이닝/테스트/세션 등)에 일괄 적용.
   */
  private writeChain: Promise<unknown> = Promise.resolve();
  /**
   * 각 write 사이의 최소 간격 — NUS 펌웨어가 직전 frame 을 처리할 시간을 확보.
   *
   * 근거: handleTestBlink 가 1000ms 간격으로 LED 를 보낼 때 100% 점등됐다.
   * 30ms 로 시작했지만 일부 NUS 펌웨어는 그것도 부족해 frame 을 silent drop
   * 한다는 보고가 있어 100ms 로 보강. BPM 200 (=300ms 비트) 도 비트당 2~3 개
   * frame 만 들어가니 100ms × 3 = 300ms 로 빡빡하게 들어맞는다. 더 빠른
   * BPM 이 필요해지면 이 값을 줄이고 native diag (legacyWriteDiag) 로 펌웨어
   * drop 여부를 다시 확인할 것.
   */
  private static readonly WRITE_GAP_MS = 100;
  private lastWriteFinishedAt = 0;

  /** dispatcher가 재연결 이벤트를 web으로 push하기 위해 등록 */
  setEventHandlers(handlers: BleManagerEventHandlers): void {
    this.events = handlers;
  }

  /** react-native-ble-plx 인스턴스 (고급 용도만) */
  getNativeManager(): PlxBleManager {
    if (!this.plx) {
      this.plx = new PlxBleManager();
      console.log('[BLE] PlxBleManager created');
    }
    return this.plx;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.warn('[BLE] listener error', e);
      }
    });
  }

  /**
   * iOS: Info.plist 문구 전제(사용자 시스템 팝업). Android: API 레벨별 권한.
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'ios') {
      console.log('[BLE] iOS permissions — rely on NSBluetoothAlwaysUsageDescription + first scan');
      return true;
    }

    if (Platform.OS !== 'android') {
      return true;
    }

    const api = Platform.Version as number;
    if (api >= 31) {
      const scan = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
      );
      const connect = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
      );
      const ok =
        scan === PermissionsAndroid.RESULTS.GRANTED &&
        connect === PermissionsAndroid.RESULTS.GRANTED;
      console.log('[BLE] Android 12+ BT permissions', { scan, connect, ok });
      return ok;
    }

    const fine = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    const ok = fine === PermissionsAndroid.RESULTS.GRANTED;
    console.log('[BLE] Android location (scan) permission', { ok });
    return ok;
  }

  /** 블루투스 어댑터 PoweredOn 될 때까지 대기 */
  async whenPoweredOn(timeoutMs = 15000): Promise<void> {
    const ble = this.getNativeManager();
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        sub.remove();
        reject(new BleManagerError('BLUETOOTH_TIMEOUT', 'ensureReady', 'Bluetooth 준비 시간 초과'));
      }, timeoutMs);

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        sub.remove();
        resolve();
      };

      const sub = ble.onStateChange((state) => {
        console.log('[BLE] adapter state', state);
        if (state === State.PoweredOn) {
          finish();
        }
      }, true);

      ble.state().then((s) => {
        if (s === State.PoweredOn) {
          finish();
        }
      });
    });
  }

  async ensureReady(): Promise<void> {
    const ok = await this.requestPermissions();
    if (!ok) {
      throw new BleManagerError('PERMISSION_DENIED', 'ensureReady', '블루투스 권한이 거부되었습니다.');
    }
    await this.whenPoweredOn();
  }

  private passesAdvertisedFilter(device: Device, filter?: BleScanFilter): boolean {
    if (!filter) return true;
    const name = device.name ?? '';
    if (filter.namePrefix && !name.startsWith(filter.namePrefix)) {
      return false;
    }
    if (filter.nameContains && !name.includes(filter.nameContains)) {
      return false;
    }
    return true;
  }

  /**
   * 스캔 시작. serviceUUIDs 가 있으면 해당 서비스로 필터 스캔.
   * 중복 호출 시 이전 스캔을 중지합니다.
   */
  startDeviceScan(
    filter: BleScanFilter | undefined,
    onDiscover: (device: Device) => void,
    options?: BleScanOptions
  ): { stop: () => void } {
    this.stopScanInternal();

    const uuids = filter?.serviceUUIDs?.filter((u) => u.length > 0);
    const scanFilter = uuids && uuids.length > 0 ? uuids : null;

    const ble = this.getNativeManager();
    console.log('[BLE] startDeviceScan', { scanFilter, filter });

    ble.startDeviceScan(scanFilter, { allowDuplicates: false }, (error, device) => {
      if (error) {
        console.warn('[BLE] scan error', error.message);
        return;
      }
      if (!device) return;
      if (!this.passesAdvertisedFilter(device, filter)) return;
      onDiscover(device);
    });

    this.scanActive = true;
    this.emit();

    const timeoutMs = options?.timeoutMs ?? 15000;
    this.scanTimer = setTimeout(() => {
      console.log('[BLE] scan timeout, stopping', timeoutMs);
      this.stopScanInternal();
    }, timeoutMs);

    return {
      stop: () => {
        this.stopScanInternal();
      },
    };
  }

  stopScanInternal(): void {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    if (!this.scanActive) {
      return;
    }
    try {
      this.getNativeManager().stopDeviceScan();
      console.log('[BLE] stopDeviceScan');
    } catch (e) {
      console.warn('[BLE] stopDeviceScan warn', e);
    }
    this.scanActive = false;
    this.emit();
  }

  /** 현재 스캔 중이면 중지 */
  stopScan(): void {
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    this.stopScanInternal();
  }

  /**
   * GATT 연결 + discover. 이미 같은 id면 재사용.
   * 성공 시 onDisconnected 리스너를 부착해 자동 재연결을 활성화합니다.
   */
  async connect(deviceId: string): Promise<Device> {
    console.log('[BLE] connect', deviceId);
    // 진행 중이던 재연결을 무효화 (새 시도가 우선)
    this.cancelReconnect();
    try {
      if (this.connected?.id === deviceId) {
        console.log('[BLE] already connected to', deviceId);
        // 사용자 명시적 connect 호출이므로 재연결 의도 ON
        this.connectionMeta = { deviceId: this.connected.id, shouldReconnect: true };
        return this.connected;
      }
      // connected가 null이어도 stale meta는 치워둠
      if (this.connected) {
        await this.disconnectInternal('user');
      } else {
        this.connectionMeta = null;
        this.detachDisconnectListener();
      }
      const ble = this.getNativeManager();
      const d = await ble.connectToDevice(deviceId, { timeout: 15000 });
      await d.discoverAllServicesAndCharacteristics();
      this.connected = d;
      this.connectionMeta = { deviceId: d.id, shouldReconnect: true };
      this.attachDisconnectListener(d);
      console.log('[BLE] connected + discovered', deviceId);
      // 새 기기 → 이전 동적 매핑 폐기 후 자동 GATT 탐색 시도. 실패해도 fallback(상수)로 동작.
      this.resetDynamicLocators();
      await this.tryAutoMapFromGatt();
      this.emit();
      return d;
    } catch (e) {
      console.error('[BLE] connect failed', e);
      this.emit();
      if (e instanceof BleManagerError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = /timeout/i.test(msg);
      throw new BleManagerError(
        isTimeout ? 'CONNECT_TIMEOUT' : 'CONNECT_FAIL',
        'connect',
        msg,
        deviceId
      );
    }
  }

  /**
   * 사용자 의도 연결 해제. shouldReconnect=false로 자동 재연결 차단.
   */
  async disconnect(deviceId?: string): Promise<void> {
    if (!this.connected) {
      console.log('[BLE] disconnect noop — not connected');
      this.cancelReconnect();
      return;
    }
    if (deviceId && this.connected.id !== deviceId) {
      console.log('[BLE] disconnect skip — different device', deviceId, this.connected.id);
      return;
    }
    if (this.connectionMeta) this.connectionMeta.shouldReconnect = false;
    this.cancelReconnect();
    await this.disconnectInternal('user');
  }

  private clearAllCharacteristicSubscriptions(): void {
    for (const [key, sub] of this.characteristicSubscriptions) {
      try {
        sub.remove();
        console.log('[BLE] notify subscription removed', key);
      } catch (e) {
        console.warn('[BLE] notify subscription remove warn', key, e);
      }
    }
    this.characteristicSubscriptions.clear();
  }

  private detachDisconnectListener(): void {
    if (this.disconnectSubscription) {
      try {
        this.disconnectSubscription.remove();
      } catch (e) {
        console.warn('[BLE] detachDisconnectListener warn', e);
      }
      this.disconnectSubscription = null;
    }
  }

  private attachDisconnectListener(device: Device): void {
    this.detachDisconnectListener();
    const ble = this.getNativeManager();
    this.disconnectSubscription = ble.onDeviceDisconnected(device.id, (error, _disconnectedDevice) => {
      const meta = this.connectionMeta;
      if (!meta || meta.deviceId !== device.id) {
        console.log('[BLE] onDisconnected ignored (no matching meta)', device.id);
        return;
      }
      console.log('[BLE] onDisconnected', device.id, 'shouldReconnect=', meta.shouldReconnect, 'err=', error?.message);
      // 내부 상태 정리 (cancelDeviceConnection은 호출하지 않음 — 이미 끊김)
      this.clearAllCharacteristicSubscriptions();
      this.connected = null;
      this.emit();

      if (meta.shouldReconnect) {
        this.events.onConnectionLost?.(device.id);
        void this.runReconnect(device.id);
      } else {
        this.connectionMeta = null;
        this.detachDisconnectListener();
      }
    });
  }

  /**
   * 사용자가 "지금 다시 시도" 버튼으로 자동 재연결 백오프를 건너뛰도록 요청.
   *
   * 동작 정의 (멱등):
   *  1) connected 가 살아 있으면 할 일 없음.
   *  2) connectionMeta 가 없거나 shouldReconnect=false 이면 할 일 없음
   *     (사용자가 명시적으로 끊었거나 더 이상 자동 재연결할 대상이 없음).
   *  3) reconnect 루프가 진행 중이고 sleep 대기 중이면 sleep 만 깨워
   *     다음 attempt 가 즉시 발사되게 한다 (gen은 건드리지 않음 — 루프는 계속).
   *     - reconnectTimer 가 비어 있다면 이미 connectToDevice 실행 중이므로 no-op.
   *  4) reconnect 루프가 돌고 있지 않다면 (아직 시작 전 또는 onConnectionLost 후
   *     dispatcher 초기화 시점) shouldReconnect 의도를 살려 새 루프를 시작한다.
   *
   * cancelReconnect() 와 다른 점: gen을 증가시키지 않으므로 in-flight 루프를
   * 죽이지 않고, 단지 다음 attempt 까지의 대기 시간을 0 에 가깝게 만든다.
   */
  triggerImmediateReconnect(): void {
    if (this.connected) {
      console.log('[BLE] reconnect.now ignored — already connected');
      return;
    }
    const meta = this.connectionMeta;
    if (!meta || !meta.shouldReconnect) {
      console.log('[BLE] reconnect.now ignored — no reconnect target');
      return;
    }
    if (this.reconnecting) {
      // 진행 중: sleep 중일 때만 깨운다. connectToDevice 실행 중이면 깨울 게 없다.
      if (this.reconnectTimer || this.reconnectCancelResolver) {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        if (this.reconnectCancelResolver) {
          const r = this.reconnectCancelResolver;
          this.reconnectCancelResolver = null;
          try { r(); } catch (_e) { /* noop */ }
        }
        console.log('[BLE] reconnect.now — sleep cancelled, next attempt fires now');
      } else {
        console.log('[BLE] reconnect.now ignored — attempt already in flight');
      }
      return;
    }
    // 루프가 멈춰 있다 — 새로 시작.
    console.log('[BLE] reconnect.now — starting fresh reconnect loop');
    void this.runReconnect(meta.deviceId);
  }

  /**
   * 진행 중/예약된 재연결을 취소합니다.
   * 대기 중인 sleep promise도 즉시 resolve시켜 dangling 방지.
   * generation을 증가시켜 in-flight runReconnect 루프가 다음 체크포인트에서 빠져나오게 합니다.
   */
  private cancelReconnect(): void {
    this.reconnectGen += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.reconnectCancelResolver) {
      const r = this.reconnectCancelResolver;
      this.reconnectCancelResolver = null;
      try { r(); } catch (_e) { /* noop */ }
    }
    this.reconnecting = false;
  }

  /** 취소 가능한 sleep — cancelReconnect 호출 시 즉시 resolve */
  private cancellableSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.reconnectCancelResolver = resolve;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.reconnectCancelResolver = null;
        resolve();
      }, ms);
    });
  }

  private async runReconnect(deviceId: string): Promise<void> {
    if (this.reconnecting) {
      console.log('[BLE] reconnect already in progress, skip');
      return;
    }
    this.reconnecting = true;
    const myGen = ++this.reconnectGen;
    const max = RECONNECT_BACKOFF_MS.length;

    const isAborted = (): boolean => {
      if (myGen !== this.reconnectGen) return true;
      const m = this.connectionMeta;
      return !m || m.deviceId !== deviceId || !m.shouldReconnect;
    };

    try {
      for (let i = 0; i < max; i++) {
        if (isAborted()) {
          console.log('[BLE] reconnect aborted (pre-wait)', deviceId);
          return;
        }
        const delay = RECONNECT_BACKOFF_MS[i];
        const attempt = i + 1;
        const nextDelay = i + 1 < max ? RECONNECT_BACKOFF_MS[i + 1] : undefined;
        this.events.onReconnectAttempt?.(deviceId, attempt, max, nextDelay);
        console.log('[BLE] reconnect attempt', attempt, '/', max, 'wait', delay, 'ms');

        await this.cancellableSleep(delay);

        if (isAborted()) {
          console.log('[BLE] reconnect aborted (post-wait)', deviceId);
          return;
        }

        try {
          const ble = this.getNativeManager();
          const d = await ble.connectToDevice(deviceId, { timeout: 10000 });

          // connectToDevice 도중 취소된 경우 결과 폐기
          if (isAborted()) {
            console.log('[BLE] reconnect aborted (post-connect) — discarding', deviceId);
            try { await ble.cancelDeviceConnection(d.id); } catch (_e) { /* noop */ }
            return;
          }

          await d.discoverAllServicesAndCharacteristics();

          if (isAborted()) {
            console.log('[BLE] reconnect aborted (post-discover) — discarding', deviceId);
            try { await ble.cancelDeviceConnection(d.id); } catch (_e) { /* noop */ }
            return;
          }

          this.connected = d;
          this.connectionMeta = { deviceId: d.id, shouldReconnect: true };
          this.attachDisconnectListener(d);
          // 재연결 시에도 GATT 재탐색 (펌웨어 OTA 등으로 UUID가 바뀌었을 가능성 대비)
          this.resetDynamicLocators();
          await this.tryAutoMapFromGatt();
          console.log('[BLE] reconnect success', deviceId, 'attempt', attempt);
          this.emit();
          this.events.onReconnectSuccess?.(d);
          return;
        } catch (e) {
          console.warn('[BLE] reconnect attempt failed', attempt, e instanceof Error ? e.message : e);
        }
      }

      if (isAborted()) {
        console.log('[BLE] reconnect aborted at end');
        return;
      }
      console.warn('[BLE] reconnect failed after', max, 'attempts', deviceId);
      this.connectionMeta = null;
      this.detachDisconnectListener();
      this.events.onReconnectFailed?.(deviceId);
    } finally {
      // 같은 generation일 때만 reconnecting 해제 (취소·재시작 케이스 보호)
      if (myGen === this.reconnectGen) {
        this.reconnecting = false;
      }
    }
  }

  private async disconnectInternal(reason: BleDisconnectReason): Promise<void> {
    if (!this.connected) return;
    const id = this.connected.id;
    this.detachDisconnectListener();
    this.clearAllCharacteristicSubscriptions();
    try {
      await this.getNativeManager().cancelDeviceConnection(id);
      console.log('[BLE] disconnected', id, 'reason=', reason);
    } catch (e) {
      console.warn('[BLE] disconnect warn', e);
    } finally {
      this.connected = null;
      this.resetDynamicLocators();
      if (reason === 'user') {
        this.connectionMeta = null;
        this.events.onUserDisconnect?.(id);
      }
      this.emit();
    }
  }

  /**
   * key('write'|'notify')에 대한 실제 사용 UUID를 반환합니다.
   * - 연결된 기기에서 GATT 자동 탐색이 성공해 동적으로 매핑된 게 있으면 그것을 우선
   * - 없으면 `shared/ble-constants.ts`의 NoiPod 표준 UUID로 fallback
   */
  resolveLocator(key: NoiPodCharacteristicKey): BleCharacteristicLocator {
    const dyn = this.dynamicLocators[key];
    return dyn ?? resolveNoiPodCharacteristic(key);
  }

  /**
   * 가장 최근의 GATT 자동 탐색 결과 (없으면 null).
   * UI/디버그/웹측 노출용.
   */
  getLastGattDiscovery(): BleGattDiscoveryResult | null {
    return this.lastGattDiscovery;
  }

  private resetDynamicLocators(): void {
    this.dynamicLocators = {};
    this.lastGattDiscovery = null;
  }

  /**
   * 연결 직후/재연결 직후에 호출. 자동 탐색이 성공해 같은 service 내 tx+rx 페어를 찾으면
   * 동적 locator로 박아 둡니다. 실패해도 상수 fallback이 살아 있으므로 throw하지 않습니다.
   */
  private async tryAutoMapFromGatt(): Promise<void> {
    try {
      const result = await this.discoverGattAuto();
      this.lastGattDiscovery = result;
      if (result.selected) {
        const { service, txCharacteristic, rxCharacteristic } = result.selected;
        this.dynamicLocators.write = { serviceUUID: service, characteristicUUID: txCharacteristic };
        this.dynamicLocators.notify = { serviceUUID: service, characteristicUUID: rxCharacteristic };
        console.log('[BLE] dynamic locators set from discovery', this.dynamicLocators);
      } else {
        console.warn('[BLE] discoverGattAuto: no selection — using constant UUIDs (fallback)');
      }
    } catch (e) {
      console.warn(
        '[BLE] auto GATT map failed — using constant UUIDs (fallback):',
        e instanceof Error ? e.message : String(e)
      );
    }
  }

  getNativeConnectedDevice(): Device | null {
    return this.connected;
  }

  toDiscoverySnapshot(device: Device): BleDiscoveryDevice {
    return {
      id: device.id,
      name: device.name,
      rssi: device.rssi ?? null,
      lastSeenAt: Date.now(),
    };
  }

  getConnectedSummary(): BleDiscoveryDevice | null {
    return this.connected ? this.toDiscoverySnapshot(this.connected) : null;
  }

  isScanning(): boolean {
    return this.scanActive;
  }

  // ---------------------------------------------------------------------------
  // GATT notify / write (현재 연결된 기기 기준)
  // ---------------------------------------------------------------------------

  /**
   * Notify 구독. 동일 (service, characteristic)에 다시 구독하면 이전 구독을 먼저 제거합니다.
   * @param onValue plx가 넘기는 **base64** 페이로드
   */
  subscribeToCharacteristic(
    serviceUUID: string,
    characteristicUUID: string,
    onValue: (base64Value: string) => void
  ): { remove: () => void } {
    const dev = this.connected;
    if (!dev) {
      throw new BleManagerError('NOT_CONNECTED', 'subscribe', '연결된 기기가 없습니다.');
    }

    const key = `${dev.id}|${serviceUUID}|${characteristicUUID}`;
    const existing = this.characteristicSubscriptions.get(key);
    if (existing) {
      try {
        existing.remove();
      } catch (e) {
        console.warn('[BLE] replace existing notify warn', e);
      }
      this.characteristicSubscriptions.delete(key);
    }

    const subscription = dev.monitorCharacteristicForService(
      serviceUUID,
      characteristicUUID,
      (error, characteristic) => {
        if (error) {
          console.warn('[BLE] notify error', characteristicUUID, error.message);
          return;
        }
        const raw = characteristic?.value;
        if (raw != null && raw !== '') {
          onValue(raw);
        }
      }
    );

    this.characteristicSubscriptions.set(key, subscription);
    console.log('[BLE] subscribeToCharacteristic', key);

    return {
      remove: () => {
        try {
          subscription.remove();
        } catch (e) {
          console.warn('[BLE] unsubscribe warn', e);
        }
        if (this.characteristicSubscriptions.get(key) === subscription) {
          this.characteristicSubscriptions.delete(key);
        }
        console.log('[BLE] subscribeToCharacteristic removed', key);
      },
    };
  }

  /**
   * Write 한 번에 GATT로 전송. mode 'auto'(기본)는 noResponse → 실패 시 withResponse 폴백.
   *
   * **직렬화**: 모든 호출은 `writeChain` 에 묶여 직전 write 의 promise 가 settle 된
   * 후에야 다음 write 가 시작된다. 또 직전 write 종료 시각으로부터 `WRITE_GAP_MS` 가
   * 지나야 다음 write 가 발사된다. 이 두 가지가 NUS 계열 펌웨어가 `withoutResponse`
   * frame 을 안전히 처리할 시간을 보장한다 (위 `writeChain` 주석 참조).
   *
   * @param value `Uint8Array`는 내부에서 base64로 인코딩, `string`은 이미 **base64**인 것으로 간주해 그대로 전송
   * @returns 실제 사용된 mode
   */
  async writeCharacteristic(
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array | string,
    mode: BleWriteMode = 'auto'
  ): Promise<'withResponse' | 'withoutResponse'> {
    const next = this.writeChain.then(async () => {
      const dev = this.connected;
      if (!dev) {
        throw new BleManagerError('NOT_CONNECTED', 'write', '연결된 기기가 없습니다.');
      }
      // 직전 write 종료 후 WRITE_GAP_MS 가 안 지났으면 그 차이만큼 추가 대기.
      const since = Date.now() - this.lastWriteFinishedAt;
      const wait = NoiLinkBleController.WRITE_GAP_MS - since;
      if (wait > 0) {
        await new Promise<void>((r) => setTimeout(r, wait));
      }

      const base64Payload = typeof value === 'string' ? value : uint8ArrayToBase64(value);
      console.log(
        '[BLE] writeCharacteristic',
        serviceUUID,
        characteristicUUID,
        'b64.len=',
        base64Payload.length,
        'mode=',
        mode
      );

      try {
        if (mode === 'withResponse') {
          try {
            await dev.writeCharacteristicWithResponseForService(serviceUUID, characteristicUUID, base64Payload);
            return 'withResponse' as const;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new BleManagerError('WRITE_FAIL', 'write', msg, dev.id);
          }
        }

        if (mode === 'withoutResponse') {
          try {
            await dev.writeCharacteristicWithoutResponseForService(serviceUUID, characteristicUUID, base64Payload);
            return 'withoutResponse' as const;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new BleManagerError('WRITE_FAIL', 'write', msg, dev.id);
          }
        }

        // auto: noResponse 우선, 실패 시 withResponse 폴백 (savexx 명세 §9.2)
        try {
          await dev.writeCharacteristicWithoutResponseForService(serviceUUID, characteristicUUID, base64Payload);
          return 'withoutResponse' as const;
        } catch (eNoRsp) {
          const noRspMsg = eNoRsp instanceof Error ? eNoRsp.message : String(eNoRsp);
          console.log('[BLE] write noResponse failed → trying withResponse', noRspMsg);
          try {
            await dev.writeCharacteristicWithResponseForService(serviceUUID, characteristicUUID, base64Payload);
            return 'withResponse' as const;
          } catch (eWithRsp) {
            const msg = eWithRsp instanceof Error ? eWithRsp.message : String(eWithRsp);
            throw new BleManagerError('WRITE_FAIL', 'write', `noResponse+withResponse 모두 실패: ${msg}`, dev.id);
          }
        }
      } finally {
        this.lastWriteFinishedAt = Date.now();
      }
    });

    // 다음 호출이 본 promise 의 settle(성공/실패 무관) 후에 줄을 서도록 chain 을 갱신.
    // catch 로 흡수하지 않으면 한 번의 write 실패가 이후 모든 write 를 막아 버린다.
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  /**
   * 현재 연결된 기기의 GATT 트리를 덤프하고 TX/RX 후보를 자동 선택.
   * 우선순위 (savexx 명세 §7):
   *  1. **같은 서비스** 안에서 (writableWithoutResponse|withResponse) + (notify|indicate) 조합 — 첫 매칭 서비스 채택
   *  2. 위가 없으면 전체 서비스에서 첫 write 특성 + 첫 notify/indicate 특성 (서비스가 달라도 OK)
   */
  async discoverGattAuto(): Promise<BleGattDiscoveryResult> {
    const dev = this.connected;
    if (!dev) {
      throw new BleManagerError('NOT_CONNECTED', 'connect', '연결된 기기가 없습니다.');
    }

    const services = await dev.services();
    const meta: GattServiceMeta[] = [];
    let bestSameService: GattAutoSelection = null;

    for (const s of services) {
      const chars = await dev.characteristicsForService(s.uuid);
      const charMeta = chars.map((c) => ({
        uuid: c.uuid,
        isReadable: !!c.isReadable,
        isWritableWithResponse: !!c.isWritableWithResponse,
        isWritableWithoutResponse: !!c.isWritableWithoutResponse,
        isNotifiable: !!c.isNotifiable,
        isIndicatable: !!c.isIndicatable,
      }));
      meta.push({ uuid: s.uuid, chars: charMeta });

      if (!bestSameService) {
        const tx =
          chars.find((c) => c.isWritableWithoutResponse) ??
          chars.find((c) => c.isWritableWithResponse);
        const rx = chars.find((c) => c.isNotifiable) ?? chars.find((c) => c.isIndicatable);
        if (tx && rx) {
          bestSameService = {
            service: s.uuid,
            txCharacteristic: tx.uuid,
            rxCharacteristic: rx.uuid,
          };
        }
      }
    }

    let selected: GattAutoSelection = bestSameService;
    if (!selected) {
      let txSvc: string | null = null;
      let txCh: string | null = null;
      let rxSvc: string | null = null;
      let rxCh: string | null = null;
      for (const s of meta) {
        for (const c of s.chars) {
          if (!txCh && (c.isWritableWithoutResponse || c.isWritableWithResponse)) {
            txSvc = s.uuid;
            txCh = c.uuid;
          }
          if (!rxCh && (c.isNotifiable || c.isIndicatable)) {
            rxSvc = s.uuid;
            rxCh = c.uuid;
          }
        }
      }
      if (txSvc && txCh && rxSvc && rxCh) {
        // 두 후보의 service가 다를 수 있어 selected.service는 tx 기준으로 보고
        // rxCharacteristic은 svc가 다르면 그대로 다른 svc일 수 있음 — 호출 측이 svc도 같이 다뤄야 함.
        // 단순화: 같은 svc일 때만 selected를 채우고, 그렇지 않으면 null로 두어 호출측이 폴백 처리
        if (txSvc === rxSvc) {
          selected = { service: txSvc, txCharacteristic: txCh, rxCharacteristic: rxCh };
        } else {
          console.warn('[BLE] discoverGattAuto: tx/rx span different services — leaving selected=null', {
            txSvc,
            txCh,
            rxSvc,
            rxCh,
          });
        }
      }
    }

    console.log('[BLE] discoverGattAuto', { services: meta.length, selected });
    return { services: meta, selected };
  }

  /**
   * 기존 호출부 호환: deviceId 일치 시 위 subscribeToCharacteristic으로 위임
   * @deprecated 신규 코드는 `subscribeToCharacteristic(serviceUUID, characteristicUUID, onValue)` 사용
   */
  subscribeToCharacteristicForDevice(
    deviceId: string,
    locator: BleCharacteristicLocator,
    onValue: (base64Value: string) => void
  ): { remove: () => void } {
    if (!this.connected || this.connected.id !== deviceId) {
      console.warn('[BLE] subscribeToCharacteristicForDevice: deviceId mismatch or not connected');
      return { remove: () => {} };
    }
    return this.subscribeToCharacteristic(locator.serviceUUID, locator.characteristicUUID, onValue);
  }

  /**
   * @deprecated 신규 코드는 `writeCharacteristic(service, char, value)` 사용
   */
  async writeCharacteristicForDevice(
    deviceId: string,
    locator: BleCharacteristicLocator,
    base64Value: string
  ): Promise<void> {
    if (!this.connected || this.connected.id !== deviceId) {
      throw new BleManagerError('NOT_CONNECTED', 'write', 'deviceId mismatch or not connected', deviceId);
    }
    await this.writeCharacteristic(locator.serviceUUID, locator.characteristicUUID, base64Value);
  }
}

/** 앱 전역 단일 인스턴스 */
export const bleManager = new NoiLinkBleController();
