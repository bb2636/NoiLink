/**
 * NoiPod BLE 상수 — 펌웨어팀에서 확정된 UUID로 교체 필요.
 *
 * 웹은 이 파일의 UUID를 직접 사용하지 않습니다.
 * 대신 `NoiPodCharacteristicKey` (semantic key)만 알고,
 * 네이티브 셸이 `resolveNoiPodCharacteristic`로 UUID를 매핑합니다.
 *
 * 이렇게 하면 펌웨어 UUID가 바뀌어도 웹 배포 없이 모바일 앱만 업데이트하면 됩니다.
 */

/**
 * NoiPod는 u-blox NINA-B1 모듈의 Serial Port Service (SPS) 표준 UUID를 그대로 사용.
 * (nRF Connect 확인: NINA-B1-FB55CE → 2456e1b9-...d701)
 *
 * SPS는 양방향 FIFO이므로 NOTIFY/WRITE가 같은 characteristic UUID를 공유.
 * Credits characteristic (...d704/d705)은 flow-control 용으로 현재 미사용.
 */
export const NOIPOD_BLE = {
  /** u-blox SPS Service */
  SERVICE: '2456e1b9-26e2-8f83-e744-f34f01e9d701',
  /** SPS FIFO — 디바이스 → 앱 (notify) */
  NOTIFY: '2456e1b9-26e2-8f83-e744-f34f01e9d703',
  /** SPS FIFO — 앱 → 디바이스 (write, NOTIFY와 동일 char) */
  WRITE: '2456e1b9-26e2-8f83-e744-f34f01e9d703',
} as const;

/**
 * 광고 이름 prefix — 스캔 필터 기본값.
 * NINA-B1 모듈은 기본적으로 "NINA-B1-XXXXXX" 형태로 광고하므로 임시로 'NINA' prefix 허용.
 * (펌웨어가 광고 이름을 'NoiPod'로 바꿀 예정이라면 추후 'NoiPod' 단일로 좁히기)
 */
export const NOIPOD_NAME_PREFIX = 'NINA';

/**
 * 웹 ↔ 네이티브 사이에 주고받는 characteristic 식별자.
 * UUID 누출/하드코딩 방지용 추상 키.
 */
export type NoiPodCharacteristicKey = 'notify' | 'write';

export interface ResolvedCharacteristic {
  serviceUUID: string;
  characteristicUUID: string;
}

export function resolveNoiPodCharacteristic(key: NoiPodCharacteristicKey): ResolvedCharacteristic {
  switch (key) {
    case 'notify':
      return { serviceUUID: NOIPOD_BLE.SERVICE, characteristicUUID: NOIPOD_BLE.NOTIFY };
    case 'write':
      return { serviceUUID: NOIPOD_BLE.SERVICE, characteristicUUID: NOIPOD_BLE.WRITE };
    default: {
      const _exhaustive: never = key;
      throw new Error(`Unknown NoiPodCharacteristicKey: ${String(_exhaustive)}`);
    }
  }
}

// -----------------------------------------------------------------------------
// 에러 코드
// -----------------------------------------------------------------------------

/**
 * 구조화된 BLE 에러 코드.
 * 운영 로그/Sentry 분류 + 웹 측 사용자 안내 분기에 사용.
 */
export type BleErrorCode =
  | 'PERMISSION_DENIED'
  | 'BLUETOOTH_OFF'
  | 'BLUETOOTH_TIMEOUT'
  | 'SCAN_ERROR'
  | 'CONNECT_FAIL'
  | 'CONNECT_TIMEOUT'
  | 'NOT_CONNECTED'
  | 'WRITE_FAIL'
  | 'NOTIFY_FAIL'
  | 'UNKNOWN_CHARACTERISTIC'
  | 'RECONNECT_FAILED'
  | 'HANDLER_ERROR';

/** 에러가 발생한 액션 카테고리 (디버깅용) */
export type BleErrorAction =
  | 'ensureReady'
  | 'scan'
  | 'connect'
  | 'reconnect'
  | 'disconnect'
  | 'subscribe'
  | 'unsubscribe'
  | 'write';

/** 연결 종료 사유 */
export type BleDisconnectReason = 'user' | 'unexpected' | 'retry-failed';
