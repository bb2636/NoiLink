/**
 * 싱글톤 BLE 컨트롤러 — react-native-ble-plx 래핑
 * UI는 ble.hooks / 화면에서 이 인스턴스만 경유 (직접 BleManager 생성 금지)
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager as PlxBleManager, Device, State, type Subscription } from 'react-native-ble-plx';
import type { BleCharacteristicLocator, BleDiscoveryDevice, BleScanFilter, BleScanOptions } from './ble.types';
import { uint8ArrayToBase64 } from './bleEncoding';

type Listener = () => void;

export class NoiLinkBleController {
  private plx: PlxBleManager | null = null;
  private listeners = new Set<Listener>();
  private connected: Device | null = null;
  private scanActive = false;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  /** `${deviceId}|${serviceUUID}|${characteristicUUID}` → notify 구독 */
  private characteristicSubscriptions = new Map<string, Subscription>();

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
        reject(new Error('Bluetooth 준비 시간 초과'));
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
      throw new Error('블루투스 권한이 거부되었습니다.');
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
   * 스캔 시작. serviceUUIDs 가 있으면 해당 서비스로 필터 스캔(플레이스홀더).
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
   */
  async connect(deviceId: string): Promise<Device> {
    console.log('[BLE] connect', deviceId);
    try {
      if (this.connected?.id === deviceId) {
        console.log('[BLE] already connected to', deviceId);
        return this.connected;
      }
      await this.disconnectInternal();
      const ble = this.getNativeManager();
      const d = await ble.connectToDevice(deviceId, { timeout: 15000 });
      await d.discoverAllServicesAndCharacteristics();
      this.connected = d;
      console.log('[BLE] connected + discovered', deviceId);
      this.emit();
      return d;
    } catch (e) {
      console.error('[BLE] connect failed', e);
      this.emit();
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  /**
   * 연결 해제. deviceId 생략 시 현재 연결 기준.
   */
  async disconnect(deviceId?: string): Promise<void> {
    if (!this.connected) {
      console.log('[BLE] disconnect noop — not connected');
      return;
    }
    if (deviceId && this.connected.id !== deviceId) {
      console.log('[BLE] disconnect skip — different device', deviceId, this.connected.id);
      return;
    }
    await this.disconnectInternal();
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

  private async disconnectInternal(): Promise<void> {
    if (!this.connected) return;
    const id = this.connected.id;
    this.clearAllCharacteristicSubscriptions();
    try {
      await this.getNativeManager().cancelDeviceConnection(id);
      console.log('[BLE] disconnected', id);
    } catch (e) {
      console.warn('[BLE] disconnect warn', e);
    } finally {
      this.connected = null;
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
      console.warn('[BLE] subscribeToCharacteristic: not connected');
      return { remove: () => {} };
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
      throw new Error('BLE writeCharacteristic: not connected');
    }
    const base64Payload = typeof value === 'string' ? value : uint8ArrayToBase64(value);
    console.log('[BLE] writeCharacteristic', serviceUUID, characteristicUUID, 'base64 length', base64Payload.length);
    await dev.writeCharacteristicWithResponseForService(
      serviceUUID,
      characteristicUUID,
      base64Payload
    );
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
      throw new Error('BLE writeCharacteristicForDevice: deviceId mismatch or not connected');
    }
    return this.writeCharacteristic(locator.serviceUUID, locator.characteristicUUID, base64Value);
  }
}

/** 앱 전역 단일 인스턴스 */
export const bleManager = new NoiLinkBleController();
