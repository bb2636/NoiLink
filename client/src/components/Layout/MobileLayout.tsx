import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../hooks/useAuth';

interface MobileLayoutProps {
  children: ReactNode;
}

export default function MobileLayout({ children }: MobileLayoutProps) {
  const location = useLocation();
  const { user } = useAuth();

  // 가운데 버튼: 기업 회원이면 기관 리포트, 그 외에는 개인 리포트
  const reportPath =
    user?.userType === 'ORGANIZATION' ? '/report/organization' : '/report';

  const navItems = [
    {
      path: '/',
      label: '홈',
      // 집 아이콘 (필드 라인)
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3L12 3z" />
        </svg>
      ),
    },
    {
      path: '/training',
      label: '트레이닝',
      // 덤벨 아이콘 (대각선)
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M6.5 6.5l11 11" />
          <path d="M21 21l-1-1" />
          <path d="M3 3l1 1" />
          <path d="M18 22l4-4" />
          <path d="M2 6l4-4" />
          <path d="M3 10l7-7" />
          <path d="M14 21l7-7" />
        </svg>
      ),
    },
    {
      path: reportPath,
      label: '리포트',
      // 문서 + 막대그래프
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M9 18v-3" />
          <path d="M12 18v-6" />
          <path d="M15 18v-2" />
        </svg>
      ),
    },
    {
      path: '/ranking',
      label: '랭킹',
      // 세로 막대 차트 (높이 다름)
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <rect x="4"  y="12" width="3.5" height="8"  rx="1" />
          <rect x="10.25" y="7"  width="3.5" height="13" rx="1" />
          <rect x="16.5" y="3"  width="3.5" height="17" rx="1" />
        </svg>
      ),
    },
    {
      path: '/profile',
      label: '마이페이지',
      // 사람 (머리+어깨)
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.418 3.582-7 8-7s8 2.582 8 7v1H4v-1z" />
        </svg>
      ),
    },
  ];
  
  return (
    <div 
      className="min-h-screen overflow-y-auto scrollbar-hide" 
      style={{ 
        backgroundColor: '#0A0A0A',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'calc(64px + env(safe-area-inset-bottom))', // 하단바 높이 + safe area
        height: '100vh',
        WebkitOverflowScrolling: 'touch',
        overscrollBehaviorY: 'none',
      }}
    >
      {/* 메인 컨텐츠 */}
      <main className="max-w-md mx-auto">
        {children}
      </main>
      
      {/* 하단 네비게이션 바 */}
      <nav 
        className="fixed bottom-0 left-0 right-0 z-50" 
        style={{ 
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: '16px',
          paddingRight: '16px',
        }}
      >
        <div 
          className="max-w-md mx-auto rounded-full border shadow-lg"
          style={{ 
            backgroundColor: '#1A1A1A',
            borderColor: '#333333',
            paddingTop: '8px',
            paddingBottom: '8px',
            paddingLeft: '8px',
            paddingRight: '8px',
          }}
        >
          <div className="flex justify-around items-center">
            {navItems.map((item) => {
              const isReportItem = item.label === '리포트';
              const isActive = location.pathname === item.path ||
                (item.path === '/training' && location.pathname.startsWith('/training')) ||
                (isReportItem && location.pathname.startsWith('/report')) ||
                (item.path === '/ranking' && location.pathname.startsWith('/ranking')) ||
                (item.path === '/profile' && location.pathname.startsWith('/profile'));

              const isRecordItem = isReportItem;
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className="flex flex-col items-center justify-center flex-1"
                >
                  <motion.div
                    whileTap={{ scale: 0.9 }}
                    className="relative flex items-center justify-center"
                  >
                    {isRecordItem ? (
                      // 기록 아이템: 활성화 시 라임 그린 원형 배경, 비활성화 시 어두운 회색 원형 배경
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: isActive ? '#AAED10' : '#2A2A2A' }}
                      >
                        <div style={{ color: isActive ? '#1A1A1A' : '#999999' }}>
                          {item.icon}
                        </div>
                      </div>
                    ) : isActive ? (
                      // 활성화된 아이템: 라임 그린 아이콘
                      <div style={{ color: '#AAED10' }}>
                        {item.icon}
                      </div>
                    ) : (
                      // 비활성화된 아이템: 회색 아이콘
                      <div style={{ color: '#999999' }}>
                        {item.icon}
                      </div>
                    )}
                  </motion.div>
                  <span
                    className="text-xs mt-1"
                    style={{ 
                      color: isActive ? '#AAED10' : '#999999',
                      fontWeight: isActive ? '600' : '400'
                    }}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
