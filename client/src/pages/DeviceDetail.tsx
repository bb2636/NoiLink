/**
 * 기기 상세 보기 페이지
 * 기기 정보, 배터리, 센서 상태, 기기 제거
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import ConfirmModal from '../components/ConfirmModal/ConfirmModal';

const MOCK_DEVICE = {
  id: '1',
  name: 'NoiPod',
  deviceId: 'NP-49231',
  isConnected: true,
  battery: 78,
  signal: '안정적' as const,
  firmwareVersion: 'v1.2.3',
  lastUpdate: '2025.12.02',
  batteryHealth: '양호',
  estimatedUsageTime: '6시간',
  lightSensor: '정상',
  touchSensor: '정상',
};

export default function DeviceDetail() {
  const navigate = useNavigate();
  const { deviceId } = useParams<{ deviceId: string }>();
  const [showRemoveModal, setShowRemoveModal] = useState(false);

  // TODO: deviceId로 API에서 기기 정보 조회
  const device = { ...MOCK_DEVICE, id: deviceId ?? MOCK_DEVICE.id };

  const handleRemove = () => {
    // TODO: 기기 제거 API/연동
    setShowRemoveModal(false);
    navigate('/device');
  };

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
            배터리 | {device.battery}% &nbsp;&nbsp; 신호 | {device.signal}
          </div>
          <button
            className="w-full py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
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
