import { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';

interface MobileLayoutProps {
  children: ReactNode;
}

export default function MobileLayout({ children }: MobileLayoutProps) {
  const location = useLocation();
  
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
      path: '/record', 
      label: '랭킹', 
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
          <path d="M9 11h2v6H9v-6zm4 0h2v6h-2v-6z" />
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
      className="min-h-screen" 
      style={{ 
        backgroundColor: '#0A0A0A',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'calc(64px + env(safe-area-inset-bottom))' // 하단바 높이 + safe area
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
          className="max-w-md mx-auto rounded-t-2xl border shadow-lg"
          style={{ 
            backgroundColor: '#1A1A1A',
            borderColor: '#333333',
            paddingTop: '12px',
            paddingBottom: '12px',
          }}
        >
          <div className="flex justify-around items-center">
            {navItems.map((item, index) => {
              const isActive = location.pathname === item.path || 
                (item.path === '/record' && location.pathname.startsWith('/record')) ||
                (item.path === '/ranking' && location.pathname.startsWith('/ranking'));
              
              // 기록/통계 아이템은 라벨 없이 원형 배경만 표시
              const isRecordItem = item.path === '/record';
              
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
                  {!isRecordItem && (
                    <span
                      className="text-xs mt-1"
                      style={{ 
                        color: isActive ? '#AAED10' : '#999999',
                        fontWeight: isActive ? '600' : '400'
                      }}
                    >
                      {item.label}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </div>
  );
}
