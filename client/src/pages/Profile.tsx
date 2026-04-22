import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getBrainimalIcon, DEFAULT_BRAINIMAL } from '../utils/brainimalIcons';
import ConfirmModal from '../components/ConfirmModal/ConfirmModal';
import SuccessBanner from '../components/SuccessBanner/SuccessBanner';
import TermsModal from '../components/TermsModal/TermsModal';
import api from '../utils/api';
import type { Terms, User } from '@noilink/shared';

interface OrgListItem { id: string; name: string; memberCount: number; }

/**
 * 프로필 페이지 (마이페이지)
 */
export default function Profile() {
  const { user, loading: authLoading, logout, refreshUser } = useAuth();
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

  // ─── 개인 회원 → 기업 가입 신청 ─────────────────────────
  const [showOrgPicker, setShowOrgPicker] = useState(false);
  const [orgList, setOrgList] = useState<OrgListItem[]>([]);
  const [orgListLoading, setOrgListLoading] = useState(false);

  // ─── 기업 관리자 → 가입 신청 대기 회원 ────────────────────
  const [pendingMembers, setPendingMembers] = useState<User[]>([]);

  const loadPendingMembers = useCallback(async () => {
    if (!user || user.userType !== 'ORGANIZATION') return;
    const res = await api.getPendingOrganizationMembers();
    if (res.success && res.data) setPendingMembers(res.data);
  }, [user]);

  useEffect(() => {
    loadPendingMembers();
  }, [loadPendingMembers]);

  const openOrgPicker = async () => {
    setShowOrgPicker(true);
    setOrgListLoading(true);
    try {
      const res = await api.listOrganizations();
      if (res.success && res.data) setOrgList(res.data);
    } finally {
      setOrgListLoading(false);
    }
  };

  const submitJoinRequest = async (organizationId: string) => {
    setOrgApprovalLoading(true);
    try {
      const res = await api.requestOrganizationJoin(organizationId);
      if (res.success) {
        setBannerMessage(res.message || '가입 신청이 접수되었습니다.');
        setShowSuccessBanner(true);
        setShowOrgPicker(false);
        await refreshUser();
      } else {
        alert(res.error || '가입 신청에 실패했습니다.');
      }
    } finally {
      setOrgApprovalLoading(false);
    }
  };

  const cancelJoinRequest = async () => {
    setOrgApprovalLoading(true);
    try {
      const res = await api.cancelOrganizationJoin();
      if (res.success) {
        setBannerMessage(res.message || '신청이 취소되었습니다.');
        setShowSuccessBanner(true);
        await refreshUser();
      } else {
        alert(res.error || '취소에 실패했습니다.');
      }
    } finally {
      setOrgApprovalLoading(false);
    }
  };

  const approveMember = async (userId: string) => {
    const res = await api.approveOrganizationMember(userId);
    if (res.success) {
      setBannerMessage(res.message || '승인되었습니다.');
      setShowSuccessBanner(true);
      await loadPendingMembers();
    } else {
      alert(res.error || '승인 실패');
    }
  };

  const rejectMember = async (userId: string) => {
    const res = await api.rejectOrganizationMember(userId);
    if (res.success) {
      setBannerMessage(res.message || '반려되었습니다.');
      setShowSuccessBanner(true);
      await loadPendingMembers();
    } else {
      alert(res.error || '반려 실패');
    }
  };

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
    // 인증 정보 로딩 중에는 안내 문구 대신 빈 화면 유지 (깜빡임 방지)
    if (authLoading) {
      return <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A' }} />;
    }
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
        paddingBottom: 'env(safe-area-inset-bottom)',
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

      {/* 고정 상단바 */}
      <div
        className="sticky top-0 z-30 max-w-md mx-auto px-4 flex items-center"
        style={{
          backgroundColor: '#0A0A0A',
          height: 44,
          borderBottom: '1px solid #161616',
        }}
      >
        <svg
          className="w-4 h-4 mr-1.5"
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
        <h1 className="text-[15px] font-semibold text-white">마이페이지</h1>
      </div>

      <div
        className="max-w-md mx-auto px-4 pt-4"
        style={{
          paddingBottom: 'calc(96px + env(safe-area-inset-bottom))',
          overflowY: 'auto',
          height: 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 44px)',
          maxHeight: 'calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 44px)',
          WebkitOverflowScrolling: 'touch',
        }}
      >

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

          {/* 기업 관리자(ORGANIZATION) — 기관 리포트 진입 */}
          {user.userType === 'ORGANIZATION' && user.organizationId && (
            <div className="flex flex-col items-center gap-2 mb-2 w-full">
              <p className="text-center text-xs px-4 py-2 rounded-full" style={{ backgroundColor: '#1A2A1A', color: '#AAED10' }}>
                {user.organizationName || '기업 관리자'} · 관리자
              </p>
              <button
                type="button"
                onClick={() => navigate('/report/organization')}
                className="px-6 py-2 rounded-full text-xs font-medium border text-white"
                style={{ backgroundColor: 'transparent', borderColor: '#3a3a3a' }}
              >
                기관 리포트 보기
              </button>
            </div>
          )}

          {/* 개인 회원 — 기관 가입 신청 / 상태 */}
          {user.userType === 'PERSONAL' && (
            <div className="flex flex-col items-center gap-2 mb-2 w-full">
              {user.organizationId ? (
                <p className="text-center text-xs px-4 py-2 rounded-full" style={{ backgroundColor: '#1A2A1A', color: '#AAED10' }}>
                  {user.organizationName || '기업'} 소속
                </p>
              ) : user.pendingOrganizationId ? (
                <>
                  <p className="text-center text-xs px-4 py-2 rounded-full" style={{ backgroundColor: '#2A2A1A', color: '#ccc' }}>
                    {user.pendingOrganizationName || '기업'} 가입 승인 검토 중
                  </p>
                  <button
                    type="button"
                    disabled={orgApprovalLoading}
                    onClick={cancelJoinRequest}
                    className="px-5 py-2 rounded-full text-xs font-medium border text-white disabled:opacity-60"
                    style={{ backgroundColor: 'transparent', borderColor: '#3a3a3a' }}
                  >
                    {orgApprovalLoading ? '처리 중…' : '신청 취소'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={orgApprovalLoading}
                  onClick={openOrgPicker}
                  className="px-6 py-2.5 rounded-full text-sm font-bold disabled:opacity-60"
                  style={{ backgroundColor: '#AAED10', color: '#000000' }}
                >
                  기관 승인 요청
                </button>
              )}
            </div>
          )}
        </div>

        {/* 기업 관리자: 가입 승인 대기 회원 */}
        {user.userType === 'ORGANIZATION' && pendingMembers.length > 0 && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-white mb-2 px-1">
              가입 승인 대기 ({pendingMembers.length})
            </h3>
            <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#262626', border: '1px solid #2f2f2f' }}>
              {pendingMembers.map((m, idx) => (
                <div key={m.id}>
                  {idx > 0 && <Divider />}
                  <div className="flex items-center justify-between py-3 px-4">
                    <div className="min-w-0 flex-1 mr-3">
                      <p className="text-[14px] text-white truncate">{m.name}</p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {m.email || m.username}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => approveMember(m.id)}
                        className="px-3 py-1.5 rounded-full text-[12px] font-semibold"
                        style={{ backgroundColor: '#AAED10', color: '#000' }}
                      >
                        승인
                      </button>
                      <button
                        type="button"
                        onClick={() => rejectMember(m.id)}
                        className="px-3 py-1.5 rounded-full text-[12px] font-medium border text-white"
                        style={{ backgroundColor: 'transparent', borderColor: '#3a3a3a' }}
                      >
                        반려
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 설정 섹션 (이미지 시안: 한 카드 + 디바이더) */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-white mb-2 px-1">설정</h3>
          <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#262626', border: '1px solid #2f2f2f' }}>
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
          <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#262626', border: '1px solid #2f2f2f' }}>
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
        reverseActions
        onConfirm={handleLogout}
        onCancel={() => setShowLogoutModal(false)}
      />

      {/* 회원탈퇴 확인 모달 */}
      <ConfirmModal
        isOpen={showWithdrawModal}
        title="회원탈퇴"
        message="정말 회원탈퇴 하시겠습니까?"
        confirmText="확인"
        cancelText="아니요"
        reverseActions
        onConfirm={handleWithdraw}
        onCancel={() => setShowWithdrawModal(false)}
      />

      {/* 기업 선택 모달 (개인 회원 가입 신청) */}
      {showOrgPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setShowOrgPicker(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-4"
            style={{ backgroundColor: '#1A1A1A', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-white mb-3">가입할 기업 선택</h2>
            <p className="text-xs text-gray-400 mb-3">
              가입을 신청한 후 해당 기업 관리자의 승인을 받으면 소속 회원이 됩니다.
            </p>
            <div className="overflow-y-auto flex-1 -mx-1 px-1">
              {orgListLoading ? (
                <p className="py-8 text-center text-sm text-gray-400">로딩 중…</p>
              ) : orgList.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  가입 가능한 기업이 없습니다.
                </p>
              ) : (
                <div className="space-y-2">
                  {orgList.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      disabled={orgApprovalLoading}
                      onClick={() => submitJoinRequest(o.id)}
                      className="w-full text-left px-4 py-3 rounded-lg flex items-center justify-between disabled:opacity-60"
                      style={{ backgroundColor: '#262626', color: '#fff' }}
                    >
                      <div>
                        <p className="text-[14px] font-medium">{o.name}</p>
                        <p className="text-[11px] text-gray-400">소속 인원 {o.memberCount}명</p>
                      </div>
                      <span className="text-[12px]" style={{ color: '#AAED10' }}>가입 신청 →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowOrgPicker(false)}
              className="mt-3 w-full py-3 rounded-xl text-sm font-medium border text-white"
              style={{ backgroundColor: 'transparent', borderColor: '#3a3a3a' }}
            >
              닫기
            </button>
          </div>
        </div>
      )}

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
  return <div style={{ height: 1, backgroundColor: '#333333', margin: '0 16px' }} />;
}
