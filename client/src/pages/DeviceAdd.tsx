/**
 * 기기 추가 (블루투스 연결) 페이지
 *
 * 동작:
 *  - 네이티브 셸(WebView) 안에서는 React Native BLE 브릿지를 통해 실제 스캔/연결.
 *  - 일반 웹 브라우저에서는 BLE 미지원 안내(폴백) — 운영 환경은 모바일 앱이 메인.
 *
 * 흐름:
 *  1) 화면 진입 → 네이티브 권한 ensureReady → startScan
 *  2) ble.discovery 이벤트로 발견된 기기를 목록에 누적 (NoiPod 이름 prefix 필터)
 *  3) 사용자가 "연결하기" 클릭 → bleConnect(deviceId)
 *  4) ble.connection (connected != null) 수신 → 등록 기기 목록에 저장 + connected 표기 후 /device 로 이동
 *  5) ble.error 수신 시 사용자에게 사유 표시
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import { STORAGE_KEYS } from '../utils/constants';
import {
  bleEnsureReady,
  bleStartScan,
  bleStopScan,
  bleConnect,
} from '../native/bleBridge';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import type { BleDiscoverySnapshot, NativeToWebMessage } from '@noilink/shared';

interface RegisteredDevice {
  id: string;
  name: string;
  deviceId: string;
  registeredAt: string;
}

const SCAN_TIMEOUT_MS = 15_000;
const NOIPOD_NAME_PREFIX = 'NoiPod';

function loadRegisteredDevices(): RegisteredDevice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_DEVICES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRegisteredDevice(d: RegisteredDevice): void {
  const list = loadRegisteredDevices();
  if (list.find((x) => x.id === d.id)) return;
  list.push(d);
  localStorage.setItem(STORAGE_KEYS.REGISTERED_DEVICES, JSON.stringify(list));
}

export default function DeviceAdd() {
  const navigate = useNavigate();
  const isNative = isNoiLinkNativeShell();

  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<BleDiscoverySnapshot[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  // 네이티브 메시지 수신 → discovery/connection/error 분기
  useEffect(() => {
    if (!isNative) return;

    function onBridge(e: Event) {
      const msg = (e as CustomEvent<NativeToWebMessage>).detail;
      switch (msg.type) {
        case 'ble.scanState':
          setIsScanning(msg.payload.scanning);
          break;

        case 'ble.discovery': {
          const dev = msg.payload.device;
          // NoiPod 이름 가진 기기만 표시 (BleScanFilter도 네이티브에서 적용되지만 이중 필터링)
          if (!dev.name || !dev.name.startsWith(NOIPOD_NAME_PREFIX)) return;
          setDevices((prev) => {
            const existing = prev.findIndex((d) => d.id === dev.id);
            if (existing !== -1) {
              const next = [...prev];
              next[existing] = dev;
              return next;
            }
            return [...prev, dev];
          });
          break;
        }

        case 'ble.connection': {
          const c = msg.payload.connected;
          if (c && connectingId && c.id === connectingId) {
            // 연결 성공 → 등록 + 활성 기기 설정
            const reg: RegisteredDevice = {
              id: c.id,
              name: c.name || 'NoiPod',
              deviceId: c.id,
              registeredAt: new Date().toISOString(),
            };
            saveRegisteredDevice(reg);
            try {
              localStorage.setItem(
                STORAGE_KEYS.CONNECTED_DEVICE,
                JSON.stringify({ id: reg.id, name: reg.name, deviceId: reg.deviceId }),
              );
            } catch {}
            setConnectingId(null);
            stoppedRef.current = true;
            bleStopScan();
            navigate('/device');
          }
          break;
        }

        case 'ble.error':
          setConnectingId(null);
          setError(msg.payload.message || msg.payload.code);
          break;

        default:
          break;
      }
    }

    window.addEventListener('noilink-native-bridge', onBridge as EventListener);
    return () => {
      window.removeEventListener('noilink-native-bridge', onBridge as EventListener);
    };
  }, [isNative, connectingId, navigate]);

  const handleStartScan = () => {
    if (!isNative) {
      setError('블루투스 스캔은 NoiLink 모바일 앱에서만 지원됩니다.');
      return;
    }
    setError(null);
    setDevices([]);
    setIsScanning(true);
    stoppedRef.current = false;
    bleEnsureReady();
    bleStartScan({
      filter: { namePrefix: NOIPOD_NAME_PREFIX },
      timeoutMs: SCAN_TIMEOUT_MS,
    });
  };

  // 진입 시 자동 스캔 시작 + 언마운트 시 정리
  useEffect(() => {
    if (!isNative) return;
    handleStartScan();
    return () => {
      if (!stoppedRef.current) bleStopScan();
    };
    // 마운트 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = (device: BleDiscoverySnapshot) => {
    if (!isNative) return;
    setError(null);
    setConnectingId(device.id);
    bleConnect(device.id);
  };

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 py-6 min-h-[70vh] flex flex-col items-center justify-center">
        {/* 헤더 */}
        <div
          className="absolute top-0 left-0 right-0 max-w-md mx-auto flex items-center py-4"
          style={{
            paddingTop: 'calc(1rem + env(safe-area-inset-top))',
            paddingLeft: 'max(1rem, env(safe-area-inset-left))',
            paddingRight: 'max(1rem, env(safe-area-inset-right))',
          }}
        >
          <button
            onClick={() => {
              if (!stoppedRef.current) bleStopScan();
              navigate(-1);
            }}
            className="flex items-center p-2 -m-2"
            style={{ color: '#FFFFFF' }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        <div
          className="w-24 h-24 rounded-full flex items-center justify-center mb-4"
          style={{ backgroundColor: '#AAED10' }}
        >
          <svg className="w-12 h-12" style={{ color: '#000000' }} viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold mb-8" style={{ color: '#AAED10' }}>
          블루투스 연결
        </h2>

        {!isNative ? (
          <p className="text-center mb-6" style={{ color: '#B6B6B9' }}>
            블루투스 스캔은 NoiLink 모바일 앱에서만 지원됩니다.
            <br />웹 브라우저에서는 사용할 수 없습니다.
          </p>
        ) : isScanning ? (
          <p className="text-center mb-6" style={{ color: '#B6B6B9' }}>
            기기를 검색 중입니다...
          </p>
        ) : devices.length === 0 ? (
          <p className="text-center mb-8" style={{ color: '#B6B6B9' }}>
            주변에 연결 가능한 NoiPod 기기가 없습니다.
          </p>
        ) : (
          <p className="text-center mb-6" style={{ color: '#B6B6B9' }}>
            연결 가능한 {devices.length}개의 기기를 찾았습니다.
          </p>
        )}

        {error && (
          <p className="text-center mb-4" style={{ color: '#EF4444' }}>
            {error}
          </p>
        )}

        {devices.length > 0 && (
          <div className="w-full space-y-4 mb-6">
            {devices.map((device) => {
              const connecting = connectingId === device.id;
              return (
                <div
                  key={device.id}
                  className="flex items-center justify-between p-4 rounded-xl"
                  style={{ backgroundColor: '#1A1A1A' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: '#2A2A2A' }}
                    >
                      <svg
                        className="w-5 h-5"
                        style={{ color: '#999999' }}
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                      </svg>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium" style={{ color: '#FFFFFF' }}>
                        {device.name || '(이름 없음)'}
                      </span>
                      {device.rssi != null && (
                        <span className="text-xs" style={{ color: '#666666' }}>
                          RSSI {device.rssi} dBm
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleConnect(device)}
                    disabled={connecting || connectingId !== null}
                    className="px-6 py-2 rounded-lg font-semibold text-sm disabled:opacity-50"
                    style={{ backgroundColor: '#AAED10', color: '#000000' }}
                  >
                    {connecting ? '연결중...' : '연결하기'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {isNative && !isScanning && (
          <button
            onClick={handleStartScan}
            disabled={connectingId !== null}
            className="px-8 py-3 rounded-full font-semibold disabled:opacity-50"
            style={{ backgroundColor: '#AAED10', color: '#000000' }}
          >
            다시 검색
          </button>
        )}
      </div>
    </MobileLayout>
  );
}
