import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import SuccessBanner from '../components/SuccessBanner/SuccessBanner';

interface OrgListItem {
  id: string;
  name: string;
  memberCount: number;
}

export default function OrganizationJoin() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [orgs, setOrgs] = useState<OrgListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [banner, setBanner] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await api.listOrganizations();
        if (alive && res.success && res.data) setOrgs(res.data);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    if (!k) return orgs;
    return orgs.filter((o) => o.name.toLowerCase().includes(k));
  }, [orgs, keyword]);

  const submit = async (orgId: string, orgName: string) => {
    if (!user || user.userType !== 'PERSONAL') return;
    setSubmitting(orgId);
    try {
      const res = await api.requestOrganizationJoin(orgId);
      if (res.success) {
        setBanner({ open: true, message: `${orgName} 가입 신청을 보냈습니다.` });
        await refreshUser();
        setTimeout(() => navigate('/profile'), 800);
      } else {
        alert(res.error || '가입 신청에 실패했습니다.');
      }
    } finally {
      setSubmitting(null);
    }
  };

  const alreadyPending = !!user?.pendingOrganizationId;
  const alreadyJoined = !!user?.organizationId;

  // 권한 가드: 개인 회원만 접근 가능 (모든 훅 호출 이후)
  if (user && user.userType !== 'PERSONAL') {
    return <Navigate to="/profile" replace />;
  }

  return (
    <MobileLayout>
      <SuccessBanner
        isOpen={banner.open}
        message={banner.message}
        onClose={() => setBanner({ open: false, message: '' })}
        autoClose
        duration={2500}
      />

      {/* 상단 고정 헤더 — 노치/상단바 안전영역 자체 보정 */}
      <header
        className="sticky z-40"
        style={{
          top: 'calc(-1 * env(safe-area-inset-top))',
          paddingTop: 'env(safe-area-inset-top)',
          marginTop: 'calc(-1 * env(safe-area-inset-top))',
          backgroundColor: '#0A0A0A',
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
          <h1 className="text-base font-bold text-white">기업 가입 신청</h1>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 pt-4" style={{ paddingBottom: 120 }}>
        <p className="text-xs text-gray-400 mb-3">
          가입할 기업을 선택해 신청하세요. 기업 관리자의 승인이 완료되면 소속 회원이 됩니다.
        </p>

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
            placeholder="기업명을 검색해 주세요."
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
          />
        </div>

        {/* 현재 상태 안내 */}
        {alreadyJoined && (
          <div
            className="rounded-2xl px-4 py-3 mb-4 text-sm"
            style={{ backgroundColor: '#1A2A1A', color: '#AAED10', border: '1px solid #2a3a14' }}
          >
            이미 <b>{user?.organizationName || '기업'}</b> 소속입니다.
          </div>
        )}
        {alreadyPending && !alreadyJoined && (
          <div
            className="rounded-2xl px-4 py-3 mb-4 text-sm"
            style={{ backgroundColor: '#2A2A1A', color: '#ddd', border: '1px solid #3a3a1a' }}
          >
            <b>{user?.pendingOrganizationName || '기업'}</b> 승인 검토 중입니다.
          </div>
        )}

        {/* 기업 목록 */}
        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">로딩 중…</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            {keyword ? '검색 결과가 없습니다.' : '가입 가능한 기업이 없습니다.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((o) => {
              const disabled = alreadyJoined || alreadyPending || submitting === o.id;
              return (
                <li
                  key={o.id}
                  className="rounded-2xl px-4 py-3 flex items-center justify-between"
                  style={{ backgroundColor: '#1A1A1A', border: '1px solid #2a2a2a' }}
                >
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-[14px] font-medium text-white truncate">{o.name}</p>
                    <p className="text-[11px] text-gray-400">소속 인원 {o.memberCount}명</p>
                  </div>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => submit(o.id, o.name)}
                    className="shrink-0 px-4 py-2 rounded-full text-[12px] font-bold disabled:opacity-50"
                    style={{ backgroundColor: '#AAED10', color: '#000' }}
                  >
                    {submitting === o.id ? '신청 중…' : '가입 신청'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </MobileLayout>
  );
}
