/**
 * 기기 관리 페이지
 * 등록된 기기 목록, 연결/해제, 기기 추가 이동
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import SuccessBanner from '../components/SuccessBanner/SuccessBanner';
import { STORAGE_KEYS } from '../utils/constants';
import { ensureDemoDevicesSeeded } from '../utils/seedDemoDevices';
import { bleConnect, bleDisconnect } from '../native/bleBridge';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { subscribeAckErrorBanner, type AckBannerSubscription } from '../native/nativeAckErrors';
import type { NativeToWebMessage } from '@noilink/shared';

export interface DeviceInfo {
  id: string;
  name: string;
  deviceId: string;
  isConnected: boolean;
  battery?: number;
  signal?: '안정적' | '불안정' | null;
}

interface RegisteredDevice {
  id: string;
  name: string;
  deviceId: string;
  registeredAt: string;
}

function getConnectedDeviceId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONNECTED_DEVICE);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.id ?? null;
  } catch {
    return null;
  }
}

function loadRegisteredDevices(): RegisteredDevice[] {
  try {
    // 데모 기기 자동 시드 — 사용자가 한 번도 추가/삭제한 적 없을 때만 1회 동작
    ensureDemoDevicesSeeded();
    const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_DEVICES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRegisteredDevices(list: RegisteredDevice[]): void {
  localStorage.setItem(STORAGE_KEYS.REGISTERED_DEVICES, JSON.stringify(list));
}

export default function Device() {
  const navigate = useNavigate();
  const isNative = isNoiLinkNativeShell();
  const [connectedId, setConnectedId] = useState<string | null>(getConnectedDeviceId);
  const [registered, setRegistered] = useState<RegisteredDevice[]>(loadRegisteredDevices);
  // 브릿지가 web→native 메시지를 거부할 때 (`native.ack.ok=false`) 화면에 띄울 안내.
  // 핵심 흐름(연결/해제) 도중 조용히 실패하지 않도록 짧은 토스트로 사유를 노출한다 (Task #77).
  const [ackErrorBanner, setAckErrorBanner] = useState<string | null>(null);

  const devicesWithConnection: DeviceInfo[] = registered.map((d) => ({
    id: d.id,
    name: d.name,
    deviceId: d.deviceId,
    isConnected: connectedId === d.id,
  }));

  // localStorage / 네이티브 BLE 이벤트로 연결 상태 동기화
  useEffect(() => {
    const storageHandler = () => {
      setConnectedId(getConnectedDeviceId());
      setRegistered(loadRegisteredDevices());
    };
    window.addEventListener('storage', storageHandler);

    const bridgeHandler = (e: Event) => {
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
      } else {
        // 연결 종료 (정상/오류 모두)
        localStorage.removeItem(STORAGE_KEYS.CONNECTED_DEVICE);
        setConnectedId(null);
      }
    };
    window.addEventListener('noilink-native-bridge', bridgeHandler as EventListener);

    return () => {
      window.removeEventListener('storage', storageHandler);
      window.removeEventListener('noilink-native-bridge', bridgeHandler as EventListener);
    };
  }, []);

  // ack(ok=false) 구독 — 브릿지가 거부한 사유를 사용자/QA 가 모두 읽을 수 있는
  // 토스트로 노출. 디버그 키(`type:reason@field`)도 함께 보여줘 버그 리포트 단서를 남긴다.
  // 같은 사유가 연속으로 쏟아지면 카운터로 묶어 보여줘 토스트 깜빡임을 막는다 (Task #106).
  // 외부 닫힘(SuccessBanner.onClose) 은 ackBannerSubRef.notifyDismissed() 로 알려
  // 자동 닫힘 vs 사용자 닫힘 비율 운영 텔레메트리를 모은다 (Task #116).
  const ackBannerSubRef = useRef<AckBannerSubscription | null>(null);
  useEffect(() => {
    const sub = subscribeAckErrorBanner(setAckErrorBanner);
    ackBannerSubRef.current = sub;
    return () => {
      sub.unsubscribe();
      ackBannerSubRef.current = null;
    };
  }, []);

  const handleConnectAction = (device: DeviceInfo) => {
    if (device.isConnected) {
      // 연결 해제 → 네이티브 BLE disconnect
      if (isNative) bleDisconnect(device.id);
      localStorage.removeItem(STORAGE_KEYS.CONNECTED_DEVICE);
      setConnectedId(null);
    } else {
      // 등록된 기기 재연결 시도
      if (isNative) {
        bleConnect(device.id);
      } else {
        navigate('/device/add');
      }
    }
  };

  const handleRemove = (device: DeviceInfo) => {
    if (!confirm(`"${device.name}" 기기를 등록 해제하시겠어요?`)) return;
    if (device.isConnected && isNative) bleDisconnect(device.id);
    const next = registered.filter((d) => d.id !== device.id);
    saveRegisteredDevices(next);
    setRegistered(next);
    if (device.isConnected) {
      localStorage.removeItem(STORAGE_KEYS.CONNECTED_DEVICE);
      setConnectedId(null);
    }
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
          <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>
            기기 관리
          </h1>
        </div>

        {/* 기기 목록 */}
        <div className="space-y-4 mb-6">
          {devicesWithConnection.map((device) => (
            <div
              key={device.id}
              className="rounded-2xl p-4"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#2A2A2A' }}>
                    <svg className="w-5 h-5" style={{ color: '#AAED10' }} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold" style={{ color: '#FFFFFF' }}>{device.name}</span>
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: device.isConnected ? '#AAED10' : '#EF4444' }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/device/${device.id}`)}
                  type="button"
                  className="flex items-center gap-1"
                  style={{ color: device.isConnected ? '#AAED10' : '#EF4444', fontSize: '14px' }}
                >
                  {device.isConnected ? '연결됨' : '연결 안됨'}
                  <span className="w-4 h-4 rounded-full border flex items-center justify-center text-xs">i</span>
                </button>
              </div>
              <div className="text-sm mb-4" style={{ color: '#999999' }}>
                배터리 | {device.battery != null ? `${device.battery}%` : '-'} &nbsp;&nbsp; 신호 | {device.signal || '-'}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleConnectAction(device)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold"
                  style={{
                    backgroundColor: device.isConnected ? '#2A2A2A' : '#AAED10',
                    color: device.isConnected ? '#FFFFFF' : '#000000',
                  }}
                >
                  {device.isConnected ? '연결 해제' : '연결 하기'}
                </button>
                <button
                  onClick={() => handleRemove(device)}
                  className="px-3 py-2 rounded-lg text-sm font-semibold"
                  style={{ backgroundColor: '#2A2A2A', color: '#EF4444' }}
                  title="등록 해제"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 기기 추가 버튼 */}
        <button
          onClick={() => navigate('/device/add')}
          className="w-full py-6 rounded-2xl flex items-center justify-center border-2 border-dashed"
          style={{ borderColor: '#333333', backgroundColor: '#1A1A1A', color: '#999999' }}
        >
          <span className="text-3xl mr-2">+</span>
          <span className="font-semibold">기기 추가</span>
        </button>
      </div>

      {/* 브릿지 거부(ack ok=false) 토스트 — 한국어 안내 + 디버그 키 (Task #77) */}
      <SuccessBanner
        isOpen={!!ackErrorBanner}
        message={ackErrorBanner ?? ''}
        backgroundColor="#3a1212"
        textColor="#fca5a5"
        duration={5000}
        onClose={() => {
          ackBannerSubRef.current?.notifyDismissed();
          setAckErrorBanner(null);
        }}
      />
    </MobileLayout>
  );
}
