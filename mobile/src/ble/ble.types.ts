/**
 * BLE 레이어 공용 타입 (UI / 서비스 경계)
 * UUID·프로토콜 확정 전까지 확장 가능하게 설계
 */

/** 스캔 목록·연결 요약에 쓰는 직렬화 가능한 기기 스냅샷 */
export interface BleDiscoveryDevice {
  id: string;
  name: string | null;
  rssi: number | null;
  /** 로컬 타임스탬프(ms) — 중복 병합·UI 정렬용 */
  lastSeenAt: number;
}

/**
 * 스캔 필터 (펌웨어 확정 후 serviceUUIDs 채우기)
 * - namePrefix / nameContains: 광고 이름 기준(있을 때만 통과)
 * - serviceUUIDs: startDeviceScan 첫 인자로 전달되는 서비스 UUID 목록
 */
export interface BleScanFilter {
  namePrefix?: string;
  nameContains?: string;
  /** 예: ['0000180d-0000-1000-8000-00805f9b34fb'] — 미정이면 비워 두고 전체 스캔 */
  serviceUUIDs?: string[];
}

export interface BleScanOptions {
  /** 자동 stopScan (ms). 기본 15000 */
  timeoutMs?: number;
}

/** subscribe / write 확장 시 사용할 GATT 식별자 (플레이스홀더) */
export interface BleCharacteristicLocator {
  serviceUUID: string;
  characteristicUUID: string;
}

export type BleConnectionPhase = 'idle' | 'connecting' | 'connected' | 'disconnecting';
