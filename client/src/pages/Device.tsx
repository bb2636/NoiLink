/**
 * 기기 관리 페이지
 * 등록된 기기 목록, 연결/해제, 기기 추가 이동
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';

export interface DeviceInfo {
  id: string;
  name: string;
  deviceId: string;
  isConnected: boolean;
  battery?: number;
  signal?: '안정적' | '불안정' | null;
}

export default function Device() {
  const navigate = useNavigate();
  // TODO: 나중에 연결 시 API/블루투스에서 가져오기
  const [devices] = useState<DeviceInfo[]>([
    { id: '1', name: 'NoiPod', deviceId: 'NP-49231', isConnected: true, battery: 78, signal: '안정적' },
    { id: '2', name: 'NoiPod', deviceId: 'NP-40231', isConnected: false, battery: undefined, signal: null },
  ]);

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 py-6" style={{ paddingBottom: '120px' }}>
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
          {devices.map((device) => (
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
              <button
                onClick={() => {
                  if (device.isConnected) {
                    navigate(`/device/${device.id}`);
                  } else {
                    navigate('/device/add');
                  }
                }}
                className="w-full py-2 rounded-lg text-sm font-semibold"
                style={{
                  backgroundColor: device.isConnected ? '#2A2A2A' : '#AAED10',
                  color: device.isConnected ? '#FFFFFF' : '#000000',
                }}
              >
                {device.isConnected ? '연결 해제' : '연결 하기'}
              </button>
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
    </MobileLayout>
  );
}
