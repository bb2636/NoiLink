/**
 * BLE payload ↔ base64 (react-native-ble-plx는 characteristic value를 base64 문자열로 다룸)
 */

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return globalThis.btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/** UI에서 UTF-8 텍스트를 쓰기용 base64로 변환 */
export function utf8StringToBase64(text: string): string {
  return uint8ArrayToBase64(new TextEncoder().encode(text));
}
