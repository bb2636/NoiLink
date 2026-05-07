import { STORAGE_KEYS } from './constants';

/**
 * 데모/테스트용: 등록된 기기가 한 대도 없을 때
 * NoiPod 2대를 자동으로 localStorage에 시드해 트레이닝 흐름을 바로 테스트할 수 있게 함.
 *
 * - 사용자가 직접 추가/삭제한 흔적이 있으면(=빈 배열이 아니면) 절대 덮어쓰지 않음
 * - "이미 시드 완료" 플래그를 별도로 두어 사용자가 모두 삭제한 경우에는 다시 채우지 않음
 *
 * TODO: 실제 BLE 페어링이 가능해지면 이 시드 로직을 제거할 것
 */
const SEED_FLAG_KEY = 'noilink_demo_devices_seeded';

interface RegisteredDevice {
  id: string;
  name: string;
  deviceId: string;
  registeredAt: string;
}

const DEMO_DEVICE_IDS = ['demo-pod-1', 'demo-pod-2'];

export function ensureDemoDevicesSeeded(): void {
  try {
    // 데모 시드 비활성화 — 실제 BLE 페어링만 사용.
    // 과거 시드된 데모 기기(demo-pod-1, demo-pod-2)는 1회 정리해서 제거.
    localStorage.setItem(SEED_FLAG_KEY, 'true');
    const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_DEVICES);
    if (!raw) return;
    const list: RegisteredDevice[] = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    const cleaned = list.filter((d) => !DEMO_DEVICE_IDS.includes(d?.id));
    if (cleaned.length !== list.length) {
      localStorage.setItem(STORAGE_KEYS.REGISTERED_DEVICES, JSON.stringify(cleaned));
    }
  } catch {
    /* localStorage 미사용 환경 무시 */
  }
}
