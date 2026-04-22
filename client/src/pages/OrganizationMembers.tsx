import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { getBrainimalIcon, DEFAULT_BRAINIMAL } from '../utils/brainimalIcons';
import type { User } from '@noilink/shared';

type ResultModal = {
  open: boolean;
  message: string;
  brainimalType?: User['brainimalType'];
};

export default function OrganizationMembers() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [resultModal, setResultModal] = useState<ResultModal>({
    open: false,
    message: '',
  });

  const load = useCallback(async () => {
    if (!user || user.userType !== 'ORGANIZATION') {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await api.getPendingOrganizationMembers();
      if (res.success && res.data) setMembers(res.data);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(k) ||
        (m.email || '').toLowerCase().includes(k) ||
        (m.phone || '').toLowerCase().includes(k),
    );
  }, [members, keyword]);

  const approve = async (m: User) => {
    setWorking(m.id);
    try {
      const res = await api.approveOrganizationMember(m.id);
      if (res.success) {
        setMembers((prev) => prev.filter((x) => x.id !== m.id));
        setExpandedId(null);
        setResultModal({
          open: true,
          message: `${m.name}님이 기업회원에 승인되었습니다.`,
          brainimalType: m.brainimalType,
        });
      } else {
        alert(res.error || '승인 실패');
      }
    } finally {
      setWorking(null);
    }
  };

  const reject = async (m: User) => {
    setWorking(m.id);
    try {
      const res = await api.rejectOrganizationMember(m.id);
      if (res.success) {
        setMembers((prev) => prev.filter((x) => x.id !== m.id));
        setExpandedId(null);
        setResultModal({
          open: true,
          message: `${m.name}님의 가입 신청을 반려했습니다.`,
          brainimalType: m.brainimalType,
        });
      } else {
        alert(res.error || '반려 실패');
      }
    } finally {
      setWorking(null);
    }
  };

  // 권한 가드: 기업 관리자만 접근 가능 (모든 훅 호출 이후)
  if (user && user.userType !== 'ORGANIZATION') {
    return <Navigate to="/profile" replace />;
  }

  return (
    <MobileLayout>
      {/* 상단 고정 헤더 */}
      <header
        className="sticky top-0 z-30 backdrop-blur"
        style={{
          backgroundColor: 'rgba(10,10,10,0.92)',
          borderBottom: '1px solid #1A1A1A',
        }}
      >
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="-ml-1 p-1"
            aria-label="뒤로"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            style={{ color: '#fff' }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <h1 className="text-base font-bold text-white">기업 회원 관리</h1>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 pt-4" style={{ paddingBottom: 120 }}>
        {/* 검색바 */}
        <div
          className="flex items-center gap-2 rounded-2xl px-4 py-3 mb-4"
          style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#888' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10 18a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="이름을 검색해 주세요."
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
          />
        </div>

        {/* 목록 */}
        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">로딩 중…</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            {keyword ? '검색 결과가 없습니다.' : '가입 신청 대기 중인 회원이 없습니다.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((m) => {
              const expanded = expandedId === m.id;
              const info = m.brainimalType ? getBrainimalIcon(m.brainimalType) : DEFAULT_BRAINIMAL;
              const busy = working === m.id;

              return (
                <li
                  key={m.id}
                  className="rounded-2xl overflow-hidden"
                  style={{ backgroundColor: '#1A1A1A', border: expanded ? '1px solid #3a3a3a' : '1px solid #2a2a2a' }}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : m.id)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden shrink-0"
                        style={{ backgroundColor: '#222' }}
                      >
                        {info.icon ? (
                          <img src={info.icon} alt={info.name} className="w-full h-full object-contain" />
                        ) : (
                          <span className="text-lg">{info.emoji}</span>
                        )}
                      </div>
                      <span className="text-[14px] text-white truncate">{m.name}</span>
                    </div>

                    {!expanded && (
                      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => reject(m)}
                          className="px-3 py-1.5 rounded-full text-[12px] font-medium disabled:opacity-50"
                          style={{ backgroundColor: '#2a2222', color: '#ff8c8c', border: '1px solid #3a2a2a' }}
                        >
                          거절
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => approve(m)}
                          className="px-3 py-1.5 rounded-full text-[12px] font-bold disabled:opacity-50"
                          style={{ backgroundColor: '#AAED10', color: '#000' }}
                        >
                          승인
                        </button>
                      </div>
                    )}
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4">
                      <div className="grid grid-cols-[60px_1fr] gap-y-2 text-[13px] mb-3">
                        <span style={{ color: '#888' }}>이메일</span>
                        <span className="text-white truncate">| {m.email || '-'}</span>
                        <span style={{ color: '#888' }}>전화번호</span>
                        <span className="text-white truncate">| {m.phone || '-'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => reject(m)}
                          className="flex-1 py-3 rounded-full text-sm font-bold disabled:opacity-50"
                          style={{ backgroundColor: '#2a2222', color: '#ff8c8c', border: '1px solid #3a2a2a' }}
                        >
                          거절하기
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => approve(m)}
                          className="flex-1 py-3 rounded-full text-sm font-bold disabled:opacity-50"
                          style={{ backgroundColor: '#AAED10', color: '#000' }}
                        >
                          {busy ? '처리 중…' : '승인하기'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 결과 모달 */}
      {resultModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
          onClick={() => setResultModal({ open: false, message: '' })}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ backgroundColor: '#262626', border: '1px solid #2f2f2f' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden mb-4"
                style={{ backgroundColor: '#1A1A1A' }}
              >
                {(() => {
                  const info = resultModal.brainimalType
                    ? getBrainimalIcon(resultModal.brainimalType)
                    : DEFAULT_BRAINIMAL;
                  return info.icon ? (
                    <img src={info.icon} alt={info.name} className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-3xl">{info.emoji}</span>
                  );
                })()}
              </div>
              <p className="text-center text-white text-[15px] mb-5 whitespace-pre-line">
                {resultModal.message}
              </p>
              <button
                type="button"
                onClick={() => setResultModal({ open: false, message: '' })}
                className="w-full py-3 rounded-full text-sm font-bold"
                style={{ backgroundColor: '#AAED10', color: '#000' }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </MobileLayout>
  );
}
