/**
 * BLE 모듈 진입점 — UI에서는 가능하면 `useBle` 또는 이 파일의 export만 사용
 */
export { bleManager, NoiLinkBleController } from './BleManager';
export type { BleCharacteristicLocator, BleDiscoveryDevice, BleScanFilter, BleScanOptions } from './ble.types';
export { useBle, type UseBleResult } from './ble.hooks';
export { forwardBleNotifyToWeb, sendBleDataToWebView } from './webviewBridge';
export { uint8ArrayToBase64, base64ToUint8Array, utf8StringToBase64 } from './bleEncoding';
