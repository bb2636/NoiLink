/**
 * 레거시 BLE 모드 토글
 *
 * NoiPod 정식 펌웨어가 아직 탑재되지 않은 NINA-B1 모듈(예: 광고명
 * 'NINA-B1-XXXXXX') 처럼 12바이트 NoiPod 프레임을 못 알아듣는 펌웨어에 대해,
 * savexx 명세 §11/§12.5 의 짧은 명령으로 BLE write 를 보낸다.
 *
 *   - LED  : `4e <pod+1> 0d`  (3바이트)
 *   - START: `aa 55`
 *   - STOP : `ff`
 *
 * 토글이 ON 일 때만 위 변환이 적용되며, OFF 면 정식 12바이트 프레임을 그대로
 * 보낸다. 정식 펌웨어가 들어오면 토글을 OFF 로 두고 정상 사용한다.
 *
 * - storage key: `noilink:ble:legacyMode`
 * - 기본값: false (정식 모드)
 * - 값 변경 시 `legacy-ble-mode-change` CustomEvent 가 발사되고,
 *   다른 탭/창은 표준 `storage` 이벤트로 동기화된다.
 */

const STORAGE_KEY = 'noilink:ble:legacyMode';
const EVENT_NAME = 'legacy-ble-mode-change';

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getLegacyBleMode(): boolean {
  try {
    return safeStorage()?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setLegacyBleMode(on: boolean): void {
  try {
    const s = safeStorage();
    if (!s) return;
    if (on) s.setItem(STORAGE_KEY, '1');
    else s.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(EVENT_NAME, { detail: { on } }));
  } catch {
    /* ignore */
  }
}

export function subscribeLegacyBleMode(cb: (on: boolean) => void): () => void {
  const onCustom = (): void => cb(getLegacyBleMode());
  const onStorage = (e: StorageEvent): void => {
    if (e.key === STORAGE_KEY) cb(getLegacyBleMode());
  };
  globalThis.addEventListener?.(EVENT_NAME, onCustom as EventListener);
  globalThis.addEventListener?.('storage', onStorage);
  return () => {
    globalThis.removeEventListener?.(EVENT_NAME, onCustom as EventListener);
    globalThis.removeEventListener?.('storage', onStorage);
  };
}

/**
 * Uint8Array → base64 (브라우저/RN 양쪽 호환).
 * `bleWriteCharacteristic` 가 base64Value 를 요구하므로 변환 helper.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return globalThis.btoa(binary);
}
