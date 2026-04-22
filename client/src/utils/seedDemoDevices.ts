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

const DEMO_DEVICES: RegisteredDevice[] = [
  {
    id: 'demo-pod-1',
    name: 'NoiPod #1',
    deviceId: 'NINA-DEMO-01',
    registeredAt: new Date().toISOString(),
  },
  {
    id: 'demo-pod-2',
    name: 'NoiPod #2',
    deviceId: 'NINA-DEMO-02',
    registeredAt: new Date().toISOString(),
  },
];

export function ensureDemoDevicesSeeded(): void {
  try {
    if (localStorage.getItem(SEED_FLAG_KEY) === 'true') return;
    const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_DEVICES);
    const list: RegisteredDevice[] = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list) && list.length > 0) {
      // 이미 사용자 기기가 있으면 시드를 건너뛰되, 다시 채우지 않도록 플래그만 표시
      localStorage.setItem(SEED_FLAG_KEY, 'true');
      return;
    }
    localStorage.setItem(STORAGE_KEYS.REGISTERED_DEVICES, JSON.stringify(DEMO_DEVICES));
    localStorage.setItem(SEED_FLAG_KEY, 'true');
  } catch {
    /* localStorage 미사용 환경 무시 */
  }
}
