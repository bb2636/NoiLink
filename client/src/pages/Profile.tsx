import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getBrainimalIcon, DEFAULT_BRAINIMAL } from '../utils/brainimalIcons';
import ConfirmModal from '../components/ConfirmModal/ConfirmModal';
import api from '../utils/api';

/**
 * 프로필 페이지 (마이페이지)
 */
export default function Profile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);

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
    <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A' }}>
      <div className="max-w-md mx-auto px-4 py-6">
        {/* 헤더 */}
        <div className="flex items-center mb-6">
          <div className="w-6 h-6 rounded-full mr-2" style={{ backgroundColor: '#AAED10' }}></div>
          <h1 className="text-lg font-semibold text-white">마이페이지</h1>
        </div>

        {/* 프로필 섹션 */}
        <div className="flex flex-col items-center mb-6">
          {/* 프로필 사진 (뇌 아이콘) */}
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center mb-4 relative"
            style={{ 
              backgroundColor: '#1A1A1A',
              boxShadow: '0 0 20px rgba(170, 237, 16, 0.3)'
            }}
          >
            <span className="text-5xl">{brainimalInfo.emoji}</span>
          </div>
          
          {/* 이름 */}
          <h2 className="text-xl font-semibold text-white mb-1">
            {user.name}님
          </h2>
          
          {/* 이메일 */}
          <p className="text-sm text-gray-400 mb-4">
            {user.email || '이메일 없음'}
          </p>

          {/* 기관 승인 요청 버튼 (기업 회원인 경우) */}
          {user.userType === 'ORGANIZATION' && (
            <button
              className="w-full py-3 px-4 rounded-lg font-medium mb-6"
              style={{ 
                backgroundColor: '#AAED10',
                color: '#000000'
              }}
            >
              기관 승인 요청
            </button>
          )}
        </div>

        {/* 설정 섹션 */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-400 mb-3 px-2">설정</h3>
          <div className="space-y-1">
            <button
              onClick={() => navigate('/profile/edit')}
              className="w-full flex items-center justify-between py-4 px-4 rounded-lg text-white transition-colors"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <span>프로필 수정</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            
            <button
              onClick={() => setShowLogoutModal(true)}
              className="w-full flex items-center justify-between py-4 px-4 rounded-lg text-white transition-colors"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <span>로그아웃</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            
            <button
              onClick={() => setShowWithdrawModal(true)}
              className="w-full flex items-center justify-between py-4 px-4 rounded-lg text-white transition-colors"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <span>회원탈퇴</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* 고객지원 섹션 */}
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3 px-2">고객지원</h3>
          <div className="space-y-1">
            <button
              onClick={() => {}}
              className="w-full flex items-center justify-between py-4 px-4 rounded-lg text-white transition-colors"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <span>고객센터</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            
            <button
              onClick={() => {}}
              className="w-full flex items-center justify-between py-4 px-4 rounded-lg text-white transition-colors"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <span>개인정보처리방침</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            
            <button
              onClick={() => {}}
              className="w-full flex items-center justify-between py-4 px-4 rounded-lg text-white transition-colors"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <span>서비스 이용약관</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
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
    </div>
  );
}
