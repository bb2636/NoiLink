/**
 * 기기 추가 (블루투스 연결) 페이지
 * 주변 기기 검색, 연결하기 버튼
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import { STORAGE_KEYS } from '../utils/constants';

interface ScanResult {
  id: string;
  name: string;
}

export default function DeviceAdd() {
  const navigate = useNavigate();
  // TODO: 나중에 Web Bluetooth API로 실제 검색 결과 사용
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<ScanResult[]>([]);

  const handleStartScan = () => {
    setIsScanning(true);
    setDevices([]);
    // TODO: navigator.bluetooth.requestDevice() 연동
    // 임시: 2초 후 mock 기기 표시
    setTimeout(() => {
      setDevices([
        { id: 'scan-1', name: 'NoiPod' },
        { id: 'scan-2', name: 'NoiPod' },
      ]);
      setIsScanning(false);
    }, 2000);
  };

  const handleConnect = (device: ScanResult) => {
    // TODO: 블루투스 연결 로직
    try {
      localStorage.setItem(STORAGE_KEYS.CONNECTED_DEVICE, JSON.stringify({
        id: device.id,
        name: device.name,
        deviceId: `NP-${device.id.replace('scan-', '')}`,
      }));
    } catch {}
    navigate('/device');
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
            onClick={() => navigate(-1)}
            className="flex items-center p-2 -m-2"
            style={{ color: '#FFFFFF' }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* 블루투스 아이콘 */}
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

        {isScanning ? (
          <p className="text-center mb-6" style={{ color: '#B6B6B9' }}>
            기기를 검색 중입니다...
          </p>
        ) : devices.length === 0 ? (
          <>
            <p className="text-center mb-8" style={{ color: '#B6B6B9' }}>
              주변에 연결 가능한 기기가 없습니다.
            </p>
            <button
              onClick={handleStartScan}
              className="px-8 py-3 rounded-full font-semibold"
              style={{ backgroundColor: '#AAED10', color: '#000000' }}
            >
              다시 검색
            </button>
          </>
        ) : (
          <>
            <p className="text-center mb-6" style={{ color: '#B6B6B9' }}>
              연결 가능한 {devices.length}개의 기기를 찾았습니다.
            </p>
            <div className="w-full space-y-4">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center justify-between p-4 rounded-xl"
                  style={{ backgroundColor: '#1A1A1A' }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#2A2A2A' }}>
                      <svg className="w-5 h-5" style={{ color: '#999999' }} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                      </svg>
                    </div>
                    <span className="font-medium" style={{ color: '#FFFFFF' }}>{device.name}</span>
                  </div>
                  <button
                    onClick={() => handleConnect(device)}
                    className="px-6 py-2 rounded-lg font-semibold text-sm"
                    style={{ backgroundColor: '#AAED10', color: '#000000' }}
                  >
                    연결하기
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </MobileLayout>
  );
}
