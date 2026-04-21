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
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
        </svg>
      )
    },
    { 
      path: '/training', 
      label: '트레이닝', 
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 3 2.71 4.43l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43L21.43 20.57l-1.43-1.43L22 16.29l-1.43-1.43z" />
        </svg>
      )
    },
    {
      path: reportPath,
      label: '리포트',
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-2 16H8v-2h4v2zm4-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
        </svg>
      )
    },
    { 
      path: '/ranking', 
      label: '랭킹', 
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />
        </svg>
      )
    },
    { 
      path: '/profile', 
      label: '마이페이지', 
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
        </svg>
      )
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
