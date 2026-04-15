/**
 * NoiPod 네이티브 BLE 뼈대 (react-native-ble-plx)
 * — 서비스/캐릭터리스틱 UUID는 펌웨어 확정 후 교체
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, State } from 'react-native-ble-plx';

let manager: BleManager | null = null;

export function getBleManager(): BleManager {
  if (!manager) {
    manager = new BleManager();
  }
  return manager;
}

export async function requestBlePermissions(): Promise<boolean> {
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
    return (
      scan === PermissionsAndroid.RESULTS.GRANTED &&
      connect === PermissionsAndroid.RESULTS.GRANTED
    );
  }
  const fine = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  return fine === PermissionsAndroid.RESULTS.GRANTED;
}

export function whenPoweredOn(ble: BleManager): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      sub.remove();
      reject(new Error('Bluetooth 준비 시간 초과'));
    }, 15000);

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sub.remove();
      resolve();
    };

    const sub = ble.onStateChange((state) => {
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

export interface ScanHandle {
  stop: () => void;
}

/**
 * 주변 BLE 기기 스캔. 서비스 필터는 펌웨어 확정 후 `serviceUUIDs`에 지정 권장.
 */
export function startScan(
  onDevice: (device: Device) => void,
  onError?: (e: Error) => void
): ScanHandle {
  const ble = getBleManager();
  ble.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
    if (error) {
      onError?.(error);
      return;
    }
    if (device) {
      onDevice(device);
    }
  });
  return {
    stop: () => {
      ble.stopDeviceScan();
    },
  };
}

export async function connectDevice(deviceId: string): Promise<Device> {
  const ble = getBleManager();
  const device = await ble.connectToDevice(deviceId);
  await device.discoverAllServicesAndCharacteristics();
  return device;
}

export async function disconnectDevice(deviceId: string): Promise<void> {
  await getBleManager().cancelDeviceConnection(deviceId);
}

/**
 * 반응 신호 notify 구독 — 펌웨어 UUID 확정 후 여기서 `monitorCharacteristicForService` 연결.
 * 지금은 noop (잘못된 UUID로 구독하면 기기마다 에러만 남).
 */
export function subscribeReactionSignal(
  _device: Device,
  _onSample: (rawBase64: string) => void
): { remove: () => void } {
  return { remove: () => {} };
}
