/**
 * 기기 상세 보기 페이지
 *
 * 연결 상태 실시간 반영:
 *  - 진입 시 localStorage(REGISTERED_DEVICES, CONNECTED_DEVICE)에서 1차 표시
 *  - 'noilink-native-bridge' (ble.connection) — native 측 BLE 연결/해제 알림
 *  - 'storage' — 다른 탭/창에서 변경
 *  - visibilitychange / focus — 다른 페이지에서 끊긴 뒤 돌아오거나 폰을
 *    잠갔다 깨운 직후에도 즉시 반영
 *
 * 배터리/펌웨어/센서 등은 펌웨어 미탑재 상태에서는 측정값이 없으므로 fallback
 * 으로 '-' 또는 데모 값을 보여 준다 (Device.tsx 와 동일 정책).
 */
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import { STORAGE_KEYS } from '../utils/constants';
import ConfirmModal from '../components/ConfirmModal/ConfirmModal';
import { bleDisconnect } from '../native/bleBridge';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import type { NativeToWebMessage } from '@noilink/shared';

interface RegisteredDevice {
  id: string;
  name: string;
  deviceId: string;
  registeredAt: string;
}

const MOCK_DETAIL = {
  firmwareVersion: 'v1.2.3',
  lastUpdate: '2025.12.02',
  batteryHealth: '양호',
  estimatedUsageTime: '6시간',
  lightSensor: '정상',
  touchSensor: '정상',
};

function getConnectedDeviceId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONNECTED_DEVICE);
    if (!raw) return null;
    return JSON.parse(raw)?.id ?? null;
  } catch {
    return null;
  }
}

function loadRegisteredDevices(): RegisteredDevice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_DEVICES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export default function DeviceDetail() {
  const navigate = useNavigate();
  const { deviceId } = useParams<{ deviceId: string }>();
  const isNative = isNoiLinkNativeShell();
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [connectedId, setConnectedId] = useState<string | null>(getConnectedDeviceId);
  const [registered, setRegistered] = useState<RegisteredDevice[]>(loadRegisteredDevices);

  // 등록된 기기 목록에서 URL param 의 deviceId 와 매칭. fallback 으로 첫 기기.
  const registeredMatch =
    registered.find((d) => d.id === deviceId) ?? registered[0] ?? null;

  // 화면용 통합 객체. 연결 상태(isConnected)는 connectedId 와 매칭으로 실시간 결정.
  const device = {
    id: registeredMatch?.id ?? deviceId ?? '',
    name: registeredMatch?.name ?? 'NoiPod',
    deviceId: registeredMatch?.deviceId ?? deviceId ?? '-',
    isConnected: !!registeredMatch && connectedId === registeredMatch.id,
    battery: null as number | null,
    signal: null as string | null,
    ...MOCK_DETAIL,
  };

  // 실시간 상태 동기화 — Device.tsx 와 동일 패턴 (Task: DeviceDetail 실시간 반영).
  useEffect(() => {
    const reloadFromStorage = () => {
      setConnectedId(getConnectedDeviceId());
      setRegistered(loadRegisteredDevices());
    };
    window.addEventListener('storage', reloadFromStorage);

    const onBridge = (e: Event) => {
      const msg = (e as CustomEvent<NativeToWebMessage>).detail;
      if (msg.type !== 'ble.connection') return;
      const c = msg.payload.connected;
      if (c) {
        try {
          localStorage.setItem(
            STORAGE_KEYS.CONNECTED_DEVICE,
            JSON.stringify({ id: c.id, name: c.name || 'NoiPod', deviceId: c.id }),
          );
        } catch {}
        setConnectedId(c.id);
        setRegistered(loadRegisteredDevices());
      } else {
        localStorage.removeItem(STORAGE_KEYS.CONNECTED_DEVICE);
        setConnectedId(null);
      }
    };
    window.addEventListener('noilink-native-bridge', onBridge as EventListener);

    const onVisible = () => {
      if (document.visibilityState === 'visible') reloadFromStorage();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', reloadFromStorage);

    return () => {
      window.removeEventListener('storage', reloadFromStorage);
      window.removeEventListener('noilink-native-bridge', onBridge as EventListener);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', reloadFromStorage);
    };
  }, []);

  const handleDisconnect = () => {
    // 화면 즉시 갱신 + native 에 실 BLE disconnect 요청 (Device.tsx 와 동작 일관).
    if (device.isConnected && isNative) bleDisconnect(device.id);
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CONNECTED_DEVICE);
      const data = raw ? JSON.parse(raw) : null;
      if (data?.id === device.id) {
        localStorage.removeItem(STORAGE_KEYS.CONNECTED_DEVICE);
      }
    } catch {}
    setConnectedId(null);
    navigate('/device');
  };

  const handleRemove = () => {
    // 등록 목록에서 실제 제거. 연결 중이라면 BLE disconnect 와 connected 정리도 함께.
    if (device.isConnected && isNative) bleDisconnect(device.id);
    const next = registered.filter((d) => d.id !== device.id);
    try {
      localStorage.setItem(STORAGE_KEYS.REGISTERED_DEVICES, JSON.stringify(next));
      const raw = localStorage.getItem(STORAGE_KEYS.CONNECTED_DEVICE);
      const data = raw ? JSON.parse(raw) : null;
      if (data?.id === device.id) {
        localStorage.removeItem(STORAGE_KEYS.CONNECTED_DEVICE);
      }
    } catch {}
    setShowRemoveModal(false);
    navigate('/device');
  };

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 pb-6" style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))', paddingBottom: '120px' }}>
        {/* 헤더 */}
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center"
            style={{ color: '#FFFFFF' }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold" style={{ color: '#FFFFFF' }}>
            {device.name}
          </h1>
        </div>

        {/* 연결 상태 카드 */}
        <div className="rounded-2xl p-4 mb-6" style={{ backgroundColor: '#1A1A1A' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#2A2A2A' }}>
              <svg className="w-5 h-5" style={{ color: '#AAED10' }} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93z" />
              </svg>
            </div>
            <span className="font-semibold" style={{ color: '#FFFFFF' }}>{device.name}</span>
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: device.isConnected ? '#AAED10' : '#EF4444' }} />
            <span className="text-sm" style={{ color: device.isConnected ? '#AAED10' : '#EF4444' }}>
              {device.isConnected ? '연결됨' : '연결 안됨'}
            </span>
          </div>
          <div className="text-sm mb-4" style={{ color: '#999999' }}>
            배터리 | {device.battery != null ? `${device.battery}%` : '-'} &nbsp;&nbsp; 신호 | {device.signal ?? '-'}
          </div>
          <button
            onClick={handleDisconnect}
            disabled={!device.isConnected}
            className="w-full py-2 rounded-lg text-sm font-semibold"
            style={{
              backgroundColor: '#2A2A2A',
              color: device.isConnected ? '#FFFFFF' : '#666',
            }}
          >
            연결 해제
          </button>
        </div>

        {/* 기기 정보 */}
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-3" style={{ color: '#FFFFFF' }}>기기 정보</h2>
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>
            <InfoRow label="기기 ID" value={device.deviceId} />
            <InfoRow label="펌웨어 버전" value={device.firmwareVersion} />
            <InfoRow label="마지막 업데이트" value={device.lastUpdate} />
          </div>
        </div>

        {/* 배터리 정보 */}
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-3" style={{ color: '#FFFFFF' }}>배터리 정보</h2>
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>
            <InfoRow label="배터리 건강도" value={device.batteryHealth} />
            <InfoRow label="예상 사용 가능 시간" value={device.estimatedUsageTime} />
          </div>
        </div>

        {/* 센서 상태 */}
        <div className="mb-6">
          <h2 className="text-base font-semibold mb-3" style={{ color: '#FFFFFF' }}>센서 상태</h2>
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>
            <InfoRow label="광 센서" value={device.lightSensor} />
            <InfoRow label="터치 감지 센서" value={device.touchSensor} />
          </div>
        </div>

        {/* 기기 관리 */}
        <div>
          <h2 className="text-base font-semibold mb-3" style={{ color: '#FFFFFF' }}>기기 관리</h2>
          <button
            onClick={() => setShowRemoveModal(true)}
            className="w-full flex items-center justify-between p-4 rounded-xl"
            style={{ backgroundColor: '#1A1A1A', color: '#FFFFFF' }}
          >
            <span>기기 제거하기</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* 기기 제거 확인 모달 */}
      <ConfirmModal
        isOpen={showRemoveModal}
        title="기기 제거하기"
        message="해당 기기를 제거하시나요?"
        confirmText="기기 제거"
        cancelText="취소"
        onConfirm={handleRemove}
        onCancel={() => setShowRemoveModal(false)}
        confirmButtonStyle={{ backgroundColor: '#F5F5F5', color: '#000000' }}
        cancelButtonStyle={{ backgroundColor: '#333333', color: '#FFFFFF' }}
        modalStyle={{ backgroundColor: '#2A2A2A', titleColor: '#FFFFFF', messageColor: '#D1D5DB' }}
      />
    </MobileLayout>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b last:border-b-0" style={{ borderColor: '#333333' }}>
      <span style={{ color: '#999999' }}>{label}</span>
      <span style={{ color: '#FFFFFF' }}>{value}</span>
    </div>
  );
}
