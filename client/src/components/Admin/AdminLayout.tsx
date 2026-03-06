/**
 * 관리자 페이지 레이아웃 컴포넌트
 * 사이드바 네비게이션 포함
 */
import { ReactNode, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import ConfirmModal from '../ConfirmModal/ConfirmModal';

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const menuItems = [
    { path: '/admin/users', label: '유저 관리' },
    { path: '/admin/banners', label: '배너 관리' },
    { path: '/admin/reports', label: '유저 리포트 관리' },
    { path: '/admin/support', label: '고객센터' },
    { path: '/admin/terms', label: '약관 관리' },
  ];

  const isActive = (path: string) => {
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#F5F5F5' }}>
      {/* 사이드바 */}
      <aside className="w-64 flex-shrink-0 border-r" style={{ backgroundColor: '#FFFFFF', borderColor: '#E5E5E5' }}>
        <div className="p-6">
          <h1 className="text-xl font-bold" style={{ color: '#000000' }}>NoiLink</h1>
          <p 
            className="text-sm mt-1 cursor-pointer hover:opacity-70 transition-opacity" 
            style={{ color: '#666666' }}
            onClick={() => setShowLogoutModal(true)}
          >
            {user?.name || 'NoiLink'} 님
          </p>
        </div>
        <nav className="p-4">
          {menuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full text-left px-4 py-3 mb-2 rounded-lg transition-colors ${
                isActive(item.path)
                  ? 'font-semibold'
                  : ''
              }`}
              style={{
                backgroundColor: isActive(item.path) ? '#F5F5F5' : 'transparent',
                color: isActive(item.path) ? '#000000' : '#666666',
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* 메인 컨텐츠 */}
      <main className="flex-1 overflow-auto" style={{ backgroundColor: '#FFFFFF' }}>
        {children}
      </main>

      {/* 로그아웃 확인 모달 */}
      <ConfirmModal
        isOpen={showLogoutModal}
        onCancel={() => setShowLogoutModal(false)}
        onConfirm={() => {
          logout();
          setShowLogoutModal(false);
        }}
        title="로그아웃 하시겠어요?"
        message="정말 로그아웃 하시겠습니까?"
        confirmText="로그아웃"
        cancelText="취소"
        confirmButtonStyle={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
        cancelButtonStyle={{ backgroundColor: '#E5E5E5', color: '#000000' }}
        modalStyle={{ backgroundColor: '#FFFFFF', titleColor: '#000000', messageColor: '#000000' }}
      />
    </div>
  );
}
