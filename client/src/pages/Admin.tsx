/**
 * 관리자 백오피스 페이지
 * 관리자 권한이 있는 사용자만 접근 가능
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { STORAGE_KEYS } from '../utils/constants';
import type { User, Terms } from '@noilink/shared';

interface DashboardStats {
  totalUsers: number;
  personalUsers: number;
  organizationUsers: number;
  totalSessions: number;
  totalOrganizations: number;
  activeUsers: number;
}

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [terms, setTerms] = useState<Terms[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'terms'>('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // 관리자 권한 체크
    if (!authLoading) {
      if (!user) {
        navigate('/login');
        return;
      }
      if (user.userType !== 'ADMIN') {
        setError('관리자 권한이 필요합니다');
        return;
      }
      loadDashboardData();
    }
  }, [user, authLoading, navigate]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const userId = localStorage.getItem('user_id') || localStorage.getItem(STORAGE_KEYS.USER_ID);
      
      if (!userId) {
        navigate('/login');
        return;
      }

      // 관리자 API 호출 시 헤더에 userId 포함
      const dashboardRes = await fetch('/api/admin/dashboard', {
        headers: {
          'x-user-id': userId,
        },
      });

      if (!dashboardRes.ok) {
        throw new Error('Failed to load dashboard data');
      }

      const dashboardData = await dashboardRes.json();
      if (dashboardData.success) {
        setStats(dashboardData.data);
      }

      const usersRes = await fetch('/api/admin/users?limit=100', {
        headers: {
          'x-user-id': userId,
        },
      });

      if (usersRes.ok) {
        const usersData = await usersRes.json();
        if (usersData.success) {
          setUsers(usersData.data);
        }
      }

      // 약관 목록 로드
      const termsRes = await api.getAdminTerms();
      if (termsRes.success && termsRes.data) {
        setTerms(termsRes.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '데이터를 불러오는데 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
        <div className="text-white">로딩 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: '#0A0A0A' }}>
      <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {/* 헤더 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">관리자 대시보드</h1>
          <p className="text-gray-400">시스템 전체 통계 및 관리</p>
        </div>

        {/* 탭 메뉴 */}
        <div className="flex gap-4 mb-6 border-b" style={{ borderColor: '#2A2A2A' }}>
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 font-semibold transition-colors ${
              activeTab === 'dashboard' ? 'text-lime-500 border-b-2 border-lime-500' : 'text-gray-400'
            }`}
          >
            대시보드
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 font-semibold transition-colors ${
              activeTab === 'users' ? 'text-lime-500 border-b-2 border-lime-500' : 'text-gray-400'
            }`}
          >
            사용자 관리
          </button>
          <button
            onClick={() => setActiveTab('terms')}
            className={`px-4 py-2 font-semibold transition-colors ${
              activeTab === 'terms' ? 'text-lime-500 border-b-2 border-lime-500' : 'text-gray-400'
            }`}
          >
            약관 관리
          </button>
        </div>

        {/* 대시보드 탭 */}
        {activeTab === 'dashboard' && stats && (
          <>
            {/* 통계 카드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <div className="p-6 rounded-2xl" style={{ backgroundColor: '#1A1A1A' }}>
              <h3 className="text-sm text-gray-400 mb-2">전체 사용자</h3>
              <p className="text-3xl font-bold">{stats.totalUsers}</p>
            </div>
            <div className="p-6 rounded-2xl" style={{ backgroundColor: '#1A1A1A' }}>
              <h3 className="text-sm text-gray-400 mb-2">개인 회원</h3>
              <p className="text-3xl font-bold">{stats.personalUsers}</p>
            </div>
            <div className="p-6 rounded-2xl" style={{ backgroundColor: '#1A1A1A' }}>
              <h3 className="text-sm text-gray-400 mb-2">기업 회원</h3>
              <p className="text-3xl font-bold">{stats.organizationUsers}</p>
            </div>
            <div className="p-6 rounded-2xl" style={{ backgroundColor: '#1A1A1A' }}>
              <h3 className="text-sm text-gray-400 mb-2">전체 세션</h3>
              <p className="text-3xl font-bold">{stats.totalSessions}</p>
            </div>
            <div className="p-6 rounded-2xl" style={{ backgroundColor: '#1A1A1A' }}>
              <h3 className="text-sm text-gray-400 mb-2">조직 수</h3>
              <p className="text-3xl font-bold">{stats.totalOrganizations}</p>
            </div>
            <div className="p-6 rounded-2xl" style={{ backgroundColor: '#1A1A1A' }}>
              <h3 className="text-sm text-gray-400 mb-2">활성 사용자 (7일)</h3>
              <p className="text-3xl font-bold">{stats.activeUsers}</p>
            </div>
          </div>
          </>
        )}

        {/* 사용자 관리 탭 */}
        {activeTab === 'users' && (
          <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>
          <div className="p-6 border-b" style={{ borderColor: '#2A2A2A' }}>
            <h2 className="text-xl font-semibold">사용자 목록</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: '#2A2A2A' }}>
                  <th className="px-6 py-4 text-left text-sm font-semibold">ID</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">이름</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">이메일</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">타입</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold">가입일</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b" style={{ borderColor: '#2A2A2A' }}>
                    <td className="px-6 py-4 text-sm">{u.id}</td>
                    <td className="px-6 py-4 text-sm">{u.name}</td>
                    <td className="px-6 py-4 text-sm">{u.email || '-'}</td>
                    <td className="px-6 py-4 text-sm">
                      {u.userType === 'PERSONAL' && '개인'}
                      {u.userType === 'ORGANIZATION' && '기업'}
                      {u.userType === 'ADMIN' && '관리자'}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {new Date(u.createdAt).toLocaleDateString('ko-KR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* 약관 관리 탭 */}
        {activeTab === 'terms' && (
          <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>
            <div className="p-6 border-b" style={{ borderColor: '#2A2A2A' }}>
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">약관 관리</h2>
                <button
                  onClick={() => {
                    // TODO: 약관 추가 모달/폼 구현
                    alert('약관 추가 기능은 추후 구현 예정입니다');
                  }}
                  className="px-4 py-2 rounded-lg font-semibold transition-colors"
                  style={{ backgroundColor: '#AAED10', color: '#000000' }}
                >
                  약관 추가
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b" style={{ borderColor: '#2A2A2A' }}>
                    <th className="px-6 py-4 text-left text-sm font-semibold">타입</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">제목</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">버전</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">필수</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">상태</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">생성일</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {terms.map((term) => (
                    <tr key={term.id} className="border-b" style={{ borderColor: '#2A2A2A' }}>
                      <td className="px-6 py-4 text-sm">
                        {term.type === 'SERVICE' ? '서비스 이용약관' : '개인정보 수집 및 이용'}
                      </td>
                      <td className="px-6 py-4 text-sm">{term.title}</td>
                      <td className="px-6 py-4 text-sm">v{term.version}</td>
                      <td className="px-6 py-4 text-sm">
                        {term.isRequired ? (
                          <span className="text-lime-500">필수</span>
                        ) : (
                          <span className="text-gray-400">선택</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {term.isActive ? (
                          <span className="text-lime-500">활성</span>
                        ) : (
                          <span className="text-gray-400">비활성</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {new Date(term.createdAt).toLocaleDateString('ko-KR')}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <button
                          onClick={() => {
                            // TODO: 약관 수정/삭제 기능 구현
                            alert('약관 수정/삭제 기능은 추후 구현 예정입니다');
                          }}
                          className="text-lime-500 hover:underline text-sm"
                        >
                          수정
                        </button>
                      </td>
                    </tr>
                  ))}
                  {terms.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                        등록된 약관이 없습니다
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
