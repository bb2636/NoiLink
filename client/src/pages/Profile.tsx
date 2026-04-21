import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getBrainimalIcon, DEFAULT_BRAINIMAL } from '../utils/brainimalIcons';
import ConfirmModal from '../components/ConfirmModal/ConfirmModal';
import SuccessBanner from '../components/SuccessBanner/SuccessBanner';
import TermsModal from '../components/TermsModal/TermsModal';
import api from '../utils/api';
import type { Terms } from '@noilink/shared';

/**
 * 프로필 페이지 (마이페이지)
 */
export default function Profile() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [bannerMessage, setBannerMessage] = useState('프로필이 성공적으로 수정되었습니다.');
  const [orgApprovalLoading, setOrgApprovalLoading] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [selectedTerms, setSelectedTerms] = useState<Terms | null>(null);
  const [selectedTermsTitle, setSelectedTermsTitle] = useState<string>('');

  // 프로필 수정 성공 시 배너 표시
  useEffect(() => {
    if (location.state?.profileUpdated) {
      setBannerMessage('프로필이 성공적으로 수정되었습니다.');
      setShowSuccessBanner(true);
      // URL state 제거
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
        <div className="text-center">
          <p className="text-gray-400 mb-4">로그인이 필요합니다.</p>
          <button
            onClick={() => navigate('/login')}
            className="px-6 py-2 rounded-lg text-white"
            style={{ backgroundColor: '#AAED10', color: '#000000' }}
          >
            로그인
          </button>
        </div>
      </div>
    );
  }

  const brainimalInfo = user.brainimalType
    ? getBrainimalIcon(user.brainimalType)
    : DEFAULT_BRAINIMAL;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleWithdraw = async () => {
    // TODO: 회원탈퇴 API 구현
    console.log('회원탈퇴');
    setShowWithdrawModal(false);
  };

  return (
    <div 
      className="min-h-screen" 
      style={{ 
        backgroundColor: '#0A0A0A',
        touchAction: 'pan-y',
        overscrollBehavior: 'none',
        position: 'relative',
        overflow: 'hidden',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}
    >
      {/* 성공 배너 */}
      <SuccessBanner
        isOpen={showSuccessBanner}
        message={bannerMessage}
        onClose={() => setShowSuccessBanner(false)}
        autoClose={true}
        duration={3000}
      />
      
      <div 
        className="max-w-md mx-auto px-4 py-6"
        style={{
          paddingBottom: '100px',
          overflowY: 'auto',
          height: 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
          maxHeight: 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
          WebkitOverflowScrolling: 'touch'
        }}
      >
        {/* 헤더 */}
        <div className="flex items-center mb-6">
          <svg 
            className="w-6 h-6 mr-2" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
            style={{ color: '#FFFFFF' }}
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" 
            />
          </svg>
          <h1 className="text-lg font-semibold text-white">마이페이지</h1>
        </div>

        {/* 프로필 섹션 */}
        <div className="flex flex-col items-center mb-6">
          {/* 프로필 사진 (브레이니멀 아이콘) */}
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center mb-4 relative overflow-hidden"
            style={{ 
              backgroundColor: '#1A1A1A',
              boxShadow: '0 0 20px rgba(170, 237, 16, 0.3)'
            }}
          >
            {brainimalInfo.icon ? (
              <img 
                src={brainimalInfo.icon} 
                alt={brainimalInfo.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-5xl">{brainimalInfo.emoji}</span>
            )}
          </div>
          
          {/* 이름 */}
          <h2 className="text-xl font-semibold text-white mb-1">
            {user.name}님
          </h2>
          
          {/* 이메일 */}
          <p className="text-sm text-gray-400 mb-4">
            {user.email || '이메일 없음'}
          </p>

          {/* 기업 회원: 승인 상태 · 기관 리포트 (이미지 시안: 가운데 알약 버튼) */}
          {user.userType === 'ORGANIZATION' && (
            <div className="flex flex-col items-center gap-2 mb-2 w-full">
              {user.approvalStatus === 'APPROVED' && (
                <p className="text-center text-xs px-4 py-2 rounded-full" style={{ backgroundColor: '#1A2A1A', color: '#AAED10' }}>
                  기관 승인 완료
                </p>
              )}
              {user.approvalStatus === 'PENDING' && (
                <p className="text-center text-xs px-4 py-2 rounded-full" style={{ backgroundColor: '#2A2A1A', color: '#ccc' }}>
                  기관 승인 검토 중입니다
                </p>
              )}
              {user.approvalStatus === 'REJECTED' && (
                <p className="text-center text-xs px-4 py-2 rounded-full" style={{ backgroundColor: '#2A1818', color: '#f99' }}>
                  승인이 반려되었습니다. 다시 신청해 주세요.
                </p>
              )}
              {user.approvalStatus !== 'APPROVED' && user.approvalStatus !== 'PENDING' && (
                <button
                  type="button"
                  disabled={orgApprovalLoading}
                  className="px-6 py-2.5 rounded-full text-sm font-bold disabled:opacity-60"
                  style={{ backgroundColor: '#AAED10', color: '#000000' }}
                  onClick={async () => {
                    setOrgApprovalLoading(true);
                    try {
                      const res = await api.requestOrganizationApproval();
                      if (res.success) {
                        setBannerMessage(res.message || '요청이 접수되었습니다.');
                        setShowSuccessBanner(true);
                        await refreshUser();
                      } else {
                        alert(res.error || '요청에 실패했습니다.');
                      }
                    } finally {
                      setOrgApprovalLoading(false);
                    }
                  }}
                >
                  {orgApprovalLoading ? '처리 중…' : '기관 승인 요청'}
                </button>
              )}
              {user.organizationId && user.approvalStatus === 'APPROVED' && (
                <button
                  type="button"
                  onClick={() => navigate('/report/organization')}
                  className="px-6 py-2 rounded-full text-xs font-medium border text-white"
                  style={{ backgroundColor: 'transparent', borderColor: '#3a3a3a' }}
                >
                  기관 리포트 보기
                </button>
              )}
            </div>
          )}
        </div>

        {/* 설정 섹션 (이미지 시안: 한 카드 + 디바이더) */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-white mb-2 px-1">설정</h3>
          <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}>
            <SettingRow label="프로필 수정" onClick={() => navigate('/profile/edit')} />
            <Divider />
            <SettingRow label="로그아웃" onClick={() => setShowLogoutModal(true)} />
            <Divider />
            <SettingRow label="회원탈퇴" onClick={() => setShowWithdrawModal(true)} />
          </div>
        </div>

        {/* 고객지원 섹션 */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2 px-1">고객지원</h3>
          <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}>
            <SettingRow label="고객센터" onClick={() => navigate('/support')} />
            <Divider />
            <SettingRow
              label="개인정보처리방침"
              onClick={async () => {
                try {
                  const response = await api.getTermByType('PRIVACY');
                  if (response.success && response.data) {
                    setSelectedTerms(response.data);
                    setSelectedTermsTitle('개인정보처리방침');
                    setShowTermsModal(true);
                  } else {
                    alert('약관을 불러올 수 없습니다.');
                  }
                } catch (error) {
                  console.error('Failed to load privacy terms:', error);
                  alert('약관을 불러올 수 없습니다.');
                }
              }}
            />
            <Divider />
            <SettingRow
              label="서비스 이용약관"
              onClick={async () => {
                try {
                  const response = await api.getTermByType('SERVICE');
                  if (response.success && response.data) {
                    setSelectedTerms(response.data);
                    setSelectedTermsTitle('서비스 이용약관');
                    setShowTermsModal(true);
                  } else {
                    alert('약관을 불러올 수 없습니다.');
                  }
                } catch (error) {
                  console.error('Failed to load service terms:', error);
                  alert('약관을 불러올 수 없습니다.');
                }
              }}
            />
          </div>
        </div>
      </div>

      {/* 로그아웃 확인 모달 */}
      <ConfirmModal
        isOpen={showLogoutModal}
        title="로그아웃"
        message="로그아웃 하시겠습니까?"
        confirmText="확인"
        cancelText="아니요"
        onConfirm={handleLogout}
        onCancel={() => setShowLogoutModal(false)}
      />

      {/* 회원탈퇴 확인 모달 */}
      <ConfirmModal
        isOpen={showWithdrawModal}
        title="회원탈퇴"
        message="정말 회원탈퇴를 하시겠습니까? 탈퇴 후 모든 데이터가 삭제됩니다."
        confirmText="확인"
        cancelText="아니요"
        onConfirm={handleWithdraw}
        onCancel={() => setShowWithdrawModal(false)}
      />

      {/* 약관 모달 */}
      <TermsModal
        isOpen={showTermsModal}
        onClose={() => {
          setShowTermsModal(false);
          setSelectedTerms(null);
          setSelectedTermsTitle('');
        }}
        terms={selectedTerms}
        title={selectedTermsTitle}
      />
    </div>
  );
}

function SettingRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between py-4 px-4 text-white"
    >
      <span className="text-[15px]">{label}</span>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#888' }}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

function Divider() {
  return <div style={{ height: 1, backgroundColor: '#232323', margin: '0 16px' }} />;
}
