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
import type { BleErrorAction, BleErrorCode, BleDisconnectReason } from '@noilink/shared';
import type { BleCharacteristicLocator, BleDiscoveryDevice, BleScanFilter, BleScanOptions } from './ble.types';
import { uint8ArrayToBase64 } from './bleEncoding';

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
      if (reason === 'user') {
        this.connectionMeta = null;
        this.events.onUserDisconnect?.(id);
      }
      this.emit();
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
   * @param value `Uint8Array`는 내부에서 base64로 인코딩, `string`은 이미 **base64**인 것으로 간주해 그대로 전송
   */
  async writeCharacteristic(
    serviceUUID: string,
    characteristicUUID: string,
    value: Uint8Array | string
  ): Promise<void> {
    const dev = this.connected;
    if (!dev) {
      throw new BleManagerError('NOT_CONNECTED', 'write', '연결된 기기가 없습니다.');
    }
    const base64Payload = typeof value === 'string' ? value : uint8ArrayToBase64(value);
    console.log('[BLE] writeCharacteristic', serviceUUID, characteristicUUID, 'base64 length', base64Payload.length);
    try {
      await dev.writeCharacteristicWithResponseForService(
        serviceUUID,
        characteristicUUID,
        base64Payload
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BleManagerError('WRITE_FAIL', 'write', msg, dev.id);
    }
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
    return this.writeCharacteristic(locator.serviceUUID, locator.characteristicUUID, base64Value);
  }
}

/** 앱 전역 단일 인스턴스 */
export const bleManager = new NoiLinkBleController();
