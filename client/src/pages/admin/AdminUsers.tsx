/**
 * 유저 관리 페이지
 */
import { useState, useEffect, useCallback } from 'react';
import api from '../../utils/api';
import type { User } from '@noilink/shared';
import Pagination from '../../components/Admin/Pagination';
import Modal from '../../components/Admin/Modal';
import ConfirmModal from '../../components/ConfirmModal/ConfirmModal';
import SuccessBanner from '../../components/SuccessBanner/SuccessBanner';

type UserTab = 'personal' | 'organization' | 'deleted' | 'recovery';

type RecoveryRow = {
  userId: string;
  name: string | null;
  email: string | null;
  userType: 'PERSONAL' | 'ORGANIZATION' | null;
  sessionsCount: number;
  sessionsWithRecovery: number;
  totalMs: number;
  windowsTotal: number;
  avgMsPerSession: number;
  exceedsThreshold: boolean;
};

type RecoverySortKey = 'avgMsPerSession' | 'totalMs' | 'sessionsWithRecovery' | 'sessionsCount';

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0초';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}초`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min}분` : `${min}분 ${sec}초`;
}

export default function AdminUsers() {
  const [activeTab, setActiveTab] = useState<UserTab>('personal');
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [showDeleteToast, setShowDeleteToast] = useState(false);
  const [loading, setLoading] = useState(true);

  // BLE 회복 통계 탭 상태
  const [recoveryPeriod, setRecoveryPeriod] = useState<'7d' | '30d'>('7d');
  const [recoveryRows, setRecoveryRows] = useState<RecoveryRow[]>([]);
  const [recoveryThreshold, setRecoveryThreshold] = useState<{ avgMsPerSession: number; minSessions: number } | null>(null);
  const [recoverySortKey, setRecoverySortKey] = useState<RecoverySortKey>('avgMsPerSession');
  const [recoveryOnlyExceed, setRecoveryOnlyExceed] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  const itemsPerPage = 10;

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await api.getAdminUsers({ limit: 1000 });
      if (response.success && response.data) {
        setUsers(response.data);
        console.log('Loaded users:', response.data.length);
      } else {
        console.error('Failed to load users:', response.error);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRecoveryStats = useCallback(async (period: '7d' | '30d') => {
    try {
      setRecoveryLoading(true);
      const response = await api.getAdminRecoveryStats({ period });
      if (response.success && response.data) {
        setRecoveryRows(response.data.rows);
        setRecoveryThreshold(response.data.threshold);
      } else {
        console.error('Failed to load recovery stats:', response.error);
        setRecoveryRows([]);
      }
    } catch (error) {
      console.error('Failed to load recovery stats:', error);
      setRecoveryRows([]);
    } finally {
      setRecoveryLoading(false);
    }
  }, []);

  const filterUsers = useCallback(() => {
    let filtered = [...users];

    // 탭별 필터링
    if (activeTab === 'personal') {
      filtered = filtered.filter(u => !u.isDeleted && u.userType === 'PERSONAL');
    } else if (activeTab === 'organization') {
      filtered = filtered.filter(u => !u.isDeleted && u.userType === 'ORGANIZATION');
    } else if (activeTab === 'deleted') {
      filtered = filtered.filter(u => u.isDeleted === true);
    }

    // 검색 필터링 (유저명, 전화번호)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(u => 
        u.name?.toLowerCase().includes(query) ||
        u.phone?.includes(query)
      );
    }

    console.log('Filtered users:', filtered.length, 'for tab:', activeTab, 'total users:', users.length);
    setFilteredUsers(filtered);
    setCurrentPage(1);
  }, [users, activeTab, searchQuery]);

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (activeTab === 'recovery') {
      loadRecoveryStats(recoveryPeriod);
    }
  }, [activeTab, recoveryPeriod, loadRecoveryStats]);

  useEffect(() => {
    filterUsers();
  }, [filterUsers]);

  useEffect(() => {
    setTotalPages(Math.ceil(filteredUsers.length / itemsPerPage));
  }, [filteredUsers]);

  const handleUserClick = (user: User) => {
    if (user.userType === 'ORGANIZATION') {
      setSelectedUser(user);
      setShowDetailModal(true);
    }
  };

  const handleApprove = async (userId: string, status: 'PENDING' | 'APPROVED' | 'REJECTED') => {
    try {
      const response = await api.updateUser(userId, { approvalStatus: status });
      if (response.success) {
        await loadUsers();
        setShowDetailModal(false);
      }
    } catch (error) {
      console.error('Failed to update approval status:', error);
    }
  };

  const handleDeleteClick = (user: User) => {
    setUserToDelete(user);
    setShowDeleteModal(true);
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      const response = await api.updateUser(userToDelete.id, { isDeleted: true });
      if (response.success) {
        await loadUsers();
        setShowDeleteModal(false);
        setUserToDelete(null);
        setShowDeleteToast(true);
      }
    } catch (error) {
      console.error('Failed to delete user:', error);
    }
  };

  const getTabCount = (tab: UserTab) => {
    if (tab === 'personal') {
      return users.filter(u => !u.isDeleted && u.userType === 'PERSONAL').length;
    } else if (tab === 'organization') {
      return users.filter(u => !u.isDeleted && u.userType === 'ORGANIZATION').length;
    } else if (tab === 'deleted') {
      return users.filter(u => u.isDeleted === true).length;
    }
    return 0;
  };

  const paginatedUsers = filteredUsers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="p-8">
      {/* 유저 삭제 토스트 알림 */}
      <SuccessBanner
        isOpen={showDeleteToast}
        message="유저가 삭제되었습니다."
        onClose={() => setShowDeleteToast(false)}
        autoClose={true}
        duration={3000}
        backgroundColor="#666666"
        textColor="#FFFFFF"
      />
      
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2" style={{ color: '#000000' }}>
          유저 관리
        </h1>
        <p className="text-sm" style={{ color: '#666666' }}>
          전체 유저 정보를 확인할 수 있어요.
        </p>
      </div>

      {/* 탭 및 검색 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('personal')}
            className={`px-4 py-2 font-semibold ${
              activeTab === 'personal' ? 'border-b-2' : ''
            }`}
            style={{
              color: activeTab === 'personal' ? '#000000' : '#666666',
              borderColor: activeTab === 'personal' ? '#000000' : 'transparent',
            }}
          >
            개인회원 {getTabCount('personal')}
          </button>
          <button
            onClick={() => setActiveTab('organization')}
            className={`px-4 py-2 font-semibold ${
              activeTab === 'organization' ? 'border-b-2' : ''
            }`}
            style={{
              color: activeTab === 'organization' ? '#000000' : '#666666',
              borderColor: activeTab === 'organization' ? '#000000' : 'transparent',
            }}
          >
            기업회원 {getTabCount('organization')}
          </button>
          <button
            onClick={() => setActiveTab('deleted')}
            className={`px-4 py-2 font-semibold ${
              activeTab === 'deleted' ? 'border-b-2' : ''
            }`}
            style={{
              color: activeTab === 'deleted' ? '#000000' : '#666666',
              borderColor: activeTab === 'deleted' ? '#000000' : 'transparent',
            }}
          >
            삭제된 유저 {getTabCount('deleted')}
          </button>
          <button
            onClick={() => setActiveTab('recovery')}
            className={`px-4 py-2 font-semibold ${
              activeTab === 'recovery' ? 'border-b-2' : ''
            }`}
            style={{
              color: activeTab === 'recovery' ? '#000000' : '#666666',
              borderColor: activeTab === 'recovery' ? '#000000' : 'transparent',
            }}
          >
            BLE 회복 통계
          </button>
        </div>
        {/* 검색창 / 회복 통계 필터 */}
        {activeTab === 'recovery' ? (
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm" style={{ color: '#000000' }}>
              <input
                type="checkbox"
                checked={recoveryOnlyExceed}
                onChange={(e) => setRecoveryOnlyExceed(e.target.checked)}
              />
              임계 초과만 보기
            </label>
            <div className="flex items-center border rounded-lg overflow-hidden" style={{ borderColor: '#E5E5E5' }}>
              <button
                onClick={() => setRecoveryPeriod('7d')}
                className="px-4 py-2 text-sm font-semibold"
                style={{
                  backgroundColor: recoveryPeriod === '7d' ? '#2A2A2A' : '#FFFFFF',
                  color: recoveryPeriod === '7d' ? '#FFFFFF' : '#666666',
                }}
              >
                최근 7일
              </button>
              <button
                onClick={() => setRecoveryPeriod('30d')}
                className="px-4 py-2 text-sm font-semibold"
                style={{
                  backgroundColor: recoveryPeriod === '30d' ? '#2A2A2A' : '#FFFFFF',
                  color: recoveryPeriod === '30d' ? '#FFFFFF' : '#666666',
                }}
              >
                최근 30일
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center relative">
            <svg 
              className="absolute left-3 w-5 h-5" 
              style={{ color: '#999999' }}
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" 
              />
            </svg>
            <input
              type="text"
              placeholder="유저명, 전화번호 등 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 border rounded-lg"
              style={{ borderColor: '#E5E5E5', color: '#000000', width: '300px' }}
            />
          </div>
        )}
      </div>

      {/* 테이블 */}
      {activeTab === 'recovery' ? (
        <RecoveryStatsTable
          rows={recoveryRows}
          threshold={recoveryThreshold}
          loading={recoveryLoading}
          sortKey={recoverySortKey}
          onSortKeyChange={setRecoverySortKey}
          onlyExceed={recoveryOnlyExceed}
        />
      ) : loading ? (
        <div className="flex items-center justify-center" style={{ color: '#666666', minHeight: '60vh' }}>
          로딩 중...
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: '#E5E5E5' }}>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    이메일
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    이름
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    닉네임
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    휴대폰 번호
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    권한 처리
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12">
                      <div className="flex flex-col items-center justify-center" style={{ color: '#666666', minHeight: '400px' }}>
                        <div className="mb-4 text-4xl">📄</div>
                        <div>유저 정보가 존재하지 않습니다.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedUsers.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b hover:bg-gray-50 cursor-pointer"
                      style={{ borderColor: '#E5E5E5' }}
                      onClick={() => handleUserClick(user)}
                    >
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {user.email || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {user.name}
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {user.nickname || user.username || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {user.phone ? user.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3') : '-'}
                      </td>
                      <td className="px-6 py-4 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClick(user);
                        }}
                        className="px-4 py-2 rounded text-sm font-semibold"
                        style={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
                      >
                        유저 삭제
                      </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {paginatedUsers.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}

      {/* 기업 회원 상세보기 모달 */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title="상세보기"
        width="800px"
      >
        {selectedUser && (
          <div className="space-y-6">
            {/* 승인 상태 */}
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                승인 상태
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleApprove(selectedUser.id, 'PENDING')}
                  className={`px-4 py-2 rounded ${
                    selectedUser.approvalStatus === 'PENDING'
                      ? 'font-semibold'
                      : ''
                  }`}
                  style={{
                    backgroundColor: selectedUser.approvalStatus === 'PENDING' ? '#F5F5F5' : 'transparent',
                    color: selectedUser.approvalStatus === 'PENDING' ? '#000000' : '#666666',
                  }}
                >
                  승인대기
                </button>
                <button
                  onClick={() => handleApprove(selectedUser.id, 'APPROVED')}
                  className={`px-4 py-2 rounded ${
                    selectedUser.approvalStatus === 'APPROVED'
                      ? 'font-semibold'
                      : ''
                  }`}
                  style={{
                    backgroundColor: selectedUser.approvalStatus === 'APPROVED' ? '#F5F5F5' : 'transparent',
                    color: selectedUser.approvalStatus === 'APPROVED' ? '#000000' : '#666666',
                  }}
                >
                  승인완료
                </button>
              </div>
            </div>

            {/* 사용자 정보 */}
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                이메일
              </label>
              <input
                type="text"
                value={selectedUser.email || ''}
                readOnly
                className="w-full px-4 py-2 border rounded-lg"
                style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                이름
              </label>
              <input
                type="text"
                value={selectedUser.name}
                readOnly
                className="w-full px-4 py-2 border rounded-lg"
                style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                기관명
              </label>
              <input
                type="text"
                value={selectedUser.organizationName || ''}
                readOnly
                className="w-full px-4 py-2 border rounded-lg"
                style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                휴대폰 번호
              </label>
              <input
                type="text"
                value={selectedUser.phone || ''}
                readOnly
                className="w-full px-4 py-2 border rounded-lg"
                style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
              />
            </div>

            {/* 증빙 자료 */}
            {selectedUser.documents && selectedUser.documents.length > 0 && (
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  증빙 자료
                </label>
                <div className="space-y-2">
                  {selectedUser.documents.map((doc, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between px-4 py-2 border rounded-lg"
                      style={{ borderColor: '#E5E5E5' }}
                    >
                      <span className="text-sm" style={{ color: '#000000' }}>
                        {doc.name} ({doc.size}MB)
                      </span>
                      <button
                        onClick={() => window.open(doc.url, '_blank')}
                        className="text-sm"
                        style={{ color: '#666666' }}
                      >
                        다운로드
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setShowDetailModal(false)}
              className="w-full px-4 py-3 rounded-lg font-semibold"
              style={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
            >
              완료
            </button>
          </div>
        )}
      </Modal>

      {/* 유저 삭제 확인 모달 */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onCancel={() => {
          setShowDeleteModal(false);
          setUserToDelete(null);
        }}
        onConfirm={handleDeleteUser}
        title="유저를 삭제시키겠어요?"
        message={
          <>
            유저의 계정을 삭제하시겠습니까? 정지된 계정은<br />
            로그인 및 업무 기능을 사용할 수 없습니다.
          </>
        }
        confirmText="삭제"
        cancelText="취소"
        confirmButtonStyle={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
        cancelButtonStyle={{ backgroundColor: '#E5E5E5', color: '#000000' }}
        modalStyle={{ backgroundColor: '#FFFFFF', titleColor: '#000000', messageColor: '#000000' }}
      />
    </div>
  );
}

interface RecoveryStatsTableProps {
  rows: RecoveryRow[];
  threshold: { avgMsPerSession: number; minSessions: number } | null;
  loading: boolean;
  sortKey: RecoverySortKey;
  onSortKeyChange: (key: RecoverySortKey) => void;
  onlyExceed: boolean;
}

function RecoveryStatsTable({
  rows,
  threshold,
  loading,
  sortKey,
  onSortKeyChange,
  onlyExceed,
}: RecoveryStatsTableProps) {
  const visibleRows = (() => {
    const filtered = onlyExceed ? rows.filter(r => r.exceedsThreshold) : rows.slice();
    filtered.sort((a, b) => (b[sortKey] - a[sortKey]) || (b.totalMs - a.totalMs));
    return filtered;
  })();

  const headerCellStyle = { color: '#767676', backgroundColor: '#F5F5F5' } as const;
  const sortable = (key: RecoverySortKey, label: string) => (
    <th
      className="px-4 py-3 text-center text-sm font-semibold cursor-pointer select-none"
      style={headerCellStyle}
      onClick={() => onSortKeyChange(key)}
    >
      {label}{sortKey === key ? ' ▼' : ''}
    </th>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ color: '#666666', minHeight: '60vh' }}>
        로딩 중...
      </div>
    );
  }

  return (
    <>
      {threshold && (
        <div className="mb-3 text-sm" style={{ color: '#666666' }}>
          임계: 세션당 평균 회복 시간 ≥ {Math.round(threshold.avgMsPerSession / 1000)}초 &amp; 최근 세션 ≥ {threshold.minSessions}회 (강조 표시)
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b" style={{ borderColor: '#E5E5E5' }}>
              <th className="px-4 py-3 text-center text-sm font-semibold" style={headerCellStyle}>이름</th>
              <th className="px-4 py-3 text-center text-sm font-semibold" style={headerCellStyle}>이메일</th>
              <th className="px-4 py-3 text-center text-sm font-semibold" style={headerCellStyle}>회원유형</th>
              {sortable('sessionsCount', '세션 수')}
              {sortable('sessionsWithRecovery', '회복 발생 세션')}
              {sortable('totalMs', '누적 회복 시간')}
              {sortable('avgMsPerSession', '세션당 평균')}
              <th className="px-4 py-3 text-center text-sm font-semibold" style={headerCellStyle}>회복 구간</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12">
                  <div className="flex flex-col items-center justify-center" style={{ color: '#666666', minHeight: '300px' }}>
                    <div className="mb-4 text-4xl">📄</div>
                    <div>표시할 회복 통계가 없습니다.</div>
                  </div>
                </td>
              </tr>
            ) : (
              visibleRows.map(row => (
                <tr
                  key={row.userId}
                  className="border-b"
                  style={{
                    borderColor: '#E5E5E5',
                    backgroundColor: row.exceedsThreshold ? '#FFF4F4' : 'transparent',
                  }}
                >
                  <td className="px-4 py-3 text-sm text-center" style={{ color: '#000000' }}>
                    {row.exceedsThreshold && (
                      <span
                        className="inline-block mr-1 px-2 py-0.5 text-xs rounded"
                        style={{ backgroundColor: '#D93B3B', color: '#FFFFFF' }}
                        title="임계 초과"
                      >
                        !
                      </span>
                    )}
                    {row.name || '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-center" style={{ color: '#000000' }}>{row.email || '-'}</td>
                  <td className="px-4 py-3 text-sm text-center" style={{ color: '#000000' }}>
                    {row.userType === 'ORGANIZATION' ? '기업' : row.userType === 'PERSONAL' ? '개인' : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-center" style={{ color: '#000000' }}>{row.sessionsCount}</td>
                  <td className="px-4 py-3 text-sm text-center" style={{ color: '#000000' }}>{row.sessionsWithRecovery}</td>
                  <td className="px-4 py-3 text-sm text-center" style={{ color: '#000000' }}>{formatMs(row.totalMs)}</td>
                  <td
                    className="px-4 py-3 text-sm text-center"
                    style={{ color: row.exceedsThreshold ? '#D93B3B' : '#000000', fontWeight: row.exceedsThreshold ? 600 : 400 }}
                  >
                    {formatMs(row.avgMsPerSession)}
                  </td>
                  <td className="px-4 py-3 text-sm text-center" style={{ color: '#000000' }}>{row.windowsTotal}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
