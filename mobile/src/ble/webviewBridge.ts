import { NATIVE_BRIDGE_VERSION } from '@noilink/shared';
import { postNativeToWeb } from '../bridge/injectToWeb';

/**
 * 네이티브 전용 코드에서 임의 notify를 웹으로 보낼 때 사용.
 * 권장: 웹이 `ble.subscribeCharacteristic`로 구독한 뒤 동일 subscriptionId로만 전달.
 */
export function forwardBleNotifyToWeb(payload: {
  subscriptionId: string;
  serviceUUID: string;
  characteristicUUID: string;
  base64Value: string;
}): void {
  postNativeToWeb({
    v: NATIVE_BRIDGE_VERSION,
    type: 'ble.notify',
    payload,
  });
}

/** @deprecated `forwardBleNotifyToWeb` 사용 */
export function sendBleDataToWebView(data: unknown): void {
  console.warn('[BLE→WebView] sendBleDataToWebView deprecated — use forwardBleNotifyToWeb', data);
}
