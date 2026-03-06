import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { useHome } from '../hooks/useHome';
import { useNavigate } from 'react-router-dom';

/**
 * 홈 페이지
 * 이미지 기반 디자인 구현
 */
export default function Home() {
  const { user } = useAuth();
  const { condition, quickStart, banners, loading } = useHome(user?.id || null);
  const navigate = useNavigate();
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const autoSlideIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // 뇌 지수 계산 (임시로 condition 점수 사용)
  const brainIndex = condition?.score || 82;
  const weeklyChange = 2; // 임시 값
  
  // 배너가 없으면 기본 뇌 이미지 표시
  const displayBanners = banners.length > 0 ? banners : [null];
  const currentBanner = displayBanners[currentBannerIndex];
  
  // 자동 슬라이드 기능 (배너가 2개 이상일 때만)
  useEffect(() => {
    if (displayBanners.length <= 1) {
      // 배너가 1개 이하면 자동 슬라이드 중지
      if (autoSlideIntervalRef.current) {
        clearInterval(autoSlideIntervalRef.current);
        autoSlideIntervalRef.current = null;
      }
      return;
    }
    
    // 기존 인터벌 정리
    if (autoSlideIntervalRef.current) {
      clearInterval(autoSlideIntervalRef.current);
    }
    
    // 5초마다 자동으로 다음 배너로 이동
    autoSlideIntervalRef.current = setInterval(() => {
      setCurrentBannerIndex((prev) => 
        prev === displayBanners.length - 1 ? 0 : prev + 1
      );
    }, 5000);
    
    // 컴포넌트 언마운트 시 정리
    return () => {
      if (autoSlideIntervalRef.current) {
        clearInterval(autoSlideIntervalRef.current);
        autoSlideIntervalRef.current = null;
      }
    };
  }, [displayBanners.length, currentBannerIndex]);
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
        <div className="text-white">로딩 중...</div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A' }}>
      {/* 상단 헤더 (고정) */}
      <div 
        className="fixed top-0 left-0 right-0 z-40"
        style={{ 
          backgroundColor: '#0A0A0A',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-white text-xl font-semibold">roi link</h1>
            <button 
              onClick={() => navigate('/device')}
              className="text-white text-sm"
            >
              기기 관리 &gt;
            </button>
          </div>
        </div>
      </div>
      
      <div 
        className="max-w-md mx-auto px-4"
        style={{ 
          paddingTop: `calc(60px + env(safe-area-inset-top))`,
          paddingBottom: 'calc(80px + env(safe-area-inset-bottom))',
        }}
      >
        
        {/* 메인 비주얼 카드 - 배너 캐러셀 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative mb-6 rounded-2xl overflow-hidden"
          style={{ backgroundColor: '#1A1A1A', aspectRatio: '16/9' }}
        >
          <AnimatePresence mode="wait">
            {currentBanner ? (
              // 배너 이미지가 있는 경우
              <motion.div
                key={currentBanner.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="relative w-full h-full"
              >
                <img
                  src={currentBanner.imageUrl}
                  alt={currentBanner.title}
                  className="w-full h-full object-cover"
                />
                {/* 캐러셀 인디케이터 */}
                {displayBanners.length > 1 && (
                  <div className="absolute bottom-4 right-4 text-white text-sm bg-black bg-opacity-50 px-3 py-1 rounded-full z-10">
                    {currentBannerIndex + 1}/{displayBanners.length}
                  </div>
                )}
              </motion.div>
            ) : (
              // 기본 뇌 3D 렌더링 영역 (배너가 없는 경우)
              <motion.div
                key="default-brain"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="relative w-full h-full flex items-center justify-center"
              >
                {/* 뇌 아이콘/이미지 영역 */}
                <div className="relative">
                  {/* 뇌 아이콘 (임시로 큰 이모지 사용) */}
                  <div className="text-8xl opacity-30" style={{ color: '#00D4FF' }}>
                    🧠
                  </div>
                  
                  {/* 네온 링 1 (시안/파란색) */}
                  <motion.div
                    animate={{ 
                      scale: [1, 1.1, 1],
                      opacity: [0.5, 0.8, 0.5]
                    }}
                    transition={{ 
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut'
                    }}
                    className="absolute top-0 left-0 w-32 h-32 rounded-full border-2"
                    style={{ 
                      borderColor: '#00D4FF',
                      boxShadow: '0 0 20px rgba(0, 212, 255, 0.5)'
                    }}
                  />
                  
                  {/* 네온 링 2 (라임 그린) */}
                  <motion.div
                    animate={{ 
                      scale: [1, 1.15, 1],
                      opacity: [0.5, 0.9, 0.5]
                    }}
                    transition={{ 
                      duration: 2.5,
                      repeat: Infinity,
                      ease: 'easeInOut',
                      delay: 0.5
                    }}
                    className="absolute bottom-0 right-0 w-28 h-28 rounded-full border-2"
                    style={{ 
                      borderColor: '#AAED10',
                      boxShadow: '0 0 20px rgba(170, 237, 16, 0.5)'
                    }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* 배너 네비게이션 버튼 (배너가 2개 이상일 때만 표시) */}
          {displayBanners.length > 1 && (
            <>
              <button
                onClick={() => {
                  // 수동 클릭 시 자동 슬라이드 재시작
                  setCurrentBannerIndex((prev) => {
                    const newIndex = prev === 0 ? displayBanners.length - 1 : prev - 1;
                    return newIndex;
                  });
                }}
                className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white bg-black bg-opacity-50 rounded-full p-2 hover:bg-opacity-70 transition-opacity z-10"
              >
                &lt;
              </button>
              <button
                onClick={() => {
                  // 수동 클릭 시 자동 슬라이드 재시작
                  setCurrentBannerIndex((prev) => {
                    const newIndex = prev === displayBanners.length - 1 ? 0 : prev + 1;
                    return newIndex;
                  });
                }}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 text-white bg-black bg-opacity-50 rounded-full p-2 hover:bg-opacity-70 transition-opacity z-10"
              >
                &gt;
              </button>
            </>
          )}
        </motion.div>
        
        {/* 프로필 요약 섹션 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mb-6"
        >
          <h2 className="text-white text-lg font-semibold mb-3">프로필 요약</h2>
          
          <div className="rounded-2xl p-4" style={{ backgroundColor: '#1A1A1A' }}>
            <div className="text-white text-sm mb-2">뇌 지수 리포트</div>
            <p className="text-gray-400 text-xs mb-4">
              반응 · 집중 · 정확도를 기반으로 산출된 종합 뇌 지수입니다.
            </p>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* 뇌 아이콘 */}
                <div className="text-4xl">🧠</div>
                <div className="text-white text-3xl font-bold">{brainIndex}점</div>
              </div>
              
              {/* 주간 변화 버튼 */}
              <button
                className="px-3 py-1 rounded-full text-sm font-semibold"
                style={{ 
                  backgroundColor: '#AAED10',
                  color: '#000000'
                }}
              >
                주간 +{weeklyChange}
              </button>
            </div>
          </div>
        </motion.div>
        
        {/* 빠른 시작 섹션 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <h2 className="text-white text-lg font-semibold mb-3">빠른 시작</h2>
          
          <div className="space-y-3">
            {/* 포커스 카드 */}
            <button
              onClick={() => navigate('/training?mode=FOCUS')}
              className="w-full rounded-2xl p-4 flex items-center justify-between"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <div className="text-left">
                <div className="text-white font-semibold mb-1">포커스</div>
                <div className="text-gray-400 text-sm">
                  집중 타겟 유지 및 방해요소 차단 능력을 강화합니다.
                </div>
              </div>
              <div className="text-white text-xl">&gt;</div>
            </button>
            
            {/* 시퀀스 카드 */}
            <button
              onClick={() => navigate('/training?mode=MEMORY')}
              className="w-full rounded-2xl p-4 flex items-center justify-between"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <div className="text-left">
                <div className="text-white font-semibold mb-1">시퀀스</div>
                <div className="text-gray-400 text-sm">
                  제시된 순서를 기억하고 재현하는 훈련입니다.
                </div>
              </div>
              <div className="text-white text-xl">&gt;</div>
            </button>
            
            {/* 오늘의 추천 트레이닝 카드 */}
            <button
              onClick={() => {
                if (quickStart) {
                  navigate(`/training?mode=${quickStart.recommendedMode}&bpm=${quickStart.recommendedBPM}&level=${quickStart.recommendedLevel}`);
                } else {
                  navigate('/training');
                }
              }}
              className="w-full rounded-2xl p-4 flex items-center justify-between"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <div className="text-left">
                <div className="text-white font-semibold mb-1">오늘의 추천 트레이닝</div>
                <div className="text-gray-400 text-sm">
                  당신에게 필요한 맞춤 트레이닝을 제공합니다.
                </div>
              </div>
              <div className="text-white text-xl">&gt;</div>
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
