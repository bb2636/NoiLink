/**
 * 현행 펌웨어(레거시) BLE 모드 토글
 *
 * 사용자 기기(NINA-B1-FB55CE 등)의 현행 펌웨어 사양:
 *   - 송신(LED): `4e <pod+1> 0d`  (3바이트, "N" + idx + CR)
 *   - 송신(START): `aa 55`
 *   - 송신(STOP): `ff`
 *   - 수신: 5바이트 IR 패킷 또는 NFC NDEF Text Record
 *
 * 차세대(NoiPod 정식) 펌웨어 사양은 SYNC=0xa5 12바이트 프레임이지만, 현재
 * 사용자 기기에 들어가있지 않으므로 **기본값을 ON(레거시 모드)** 로 둔다.
 * 차세대 펌웨어가 들어간 기기를 시험할 때만 토글을 OFF 로 한다.
 *
 * - storage key: `noilink:ble:legacyMode`
 * - 명시적 '0' 만 OFF, 그 외(없거나 '1' 또는 다른 값)는 모두 ON.
 * - 값 변경 시 `legacy-ble-mode-change` CustomEvent 가 발사되고,
 *   다른 탭/창은 표준 `storage` 이벤트로 동기화된다.
 */

const STORAGE_KEY = 'noilink:ble:legacyMode';
// 어제 빌드에서는 진입 시 강제로 setLegacyBleMode(false) 가 호출돼 storage 에
// '0' 이 박혀버린 사용자가 있다. 오늘부터 기본값을 ON 으로 되돌렸지만 그 사용자는
// '0' 그대로라 OFF 가 유지되어 화면에서 직접 토글하지 않는 한 점등이 안 된다.
// 1회성 마이그레이션 키로 그 잔여 '0' 을 청소해 기본값(ON)으로 복귀시킨다.
// 마이그레이션 후 사용자가 명시적으로 OFF 를 누르면 다시 '0' 이 저장되며,
// 그 값은 (마이그레이션 키가 이미 있으므로) 다시는 청소되지 않는다.
const MIGRATION_KEY = 'noilink:ble:legacyMode:m1.cleanForcedOff';
const EVENT_NAME = 'legacy-ble-mode-change';

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function runMigrationOnce(s: Storage): void {
  try {
    if (s.getItem(MIGRATION_KEY) === '1') return;
    if (s.getItem(STORAGE_KEY) === '0') {
      // 어제 빌드의 잔여 강제-OFF 값. 제거해서 기본값(ON)으로 복귀.
      s.removeItem(STORAGE_KEY);
    }
    s.setItem(MIGRATION_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function getLegacyBleMode(): boolean {
  try {
    const s = safeStorage();
    if (!s) return true;
    runMigrationOnce(s);
    // 명시적으로 '0' 이 저장돼 있을 때만 OFF. 미설정/'1'/기타는 ON (기본값).
    return s.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setLegacyBleMode(on: boolean): void {
  try {
    const s = safeStorage();
    if (!s) return;
    // OFF 도 명시적으로 저장해야 기본값(ON)을 덮어쓸 수 있다.
    s.setItem(STORAGE_KEY, on ? '1' : '0');
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
