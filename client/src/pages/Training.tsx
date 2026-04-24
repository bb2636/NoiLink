/**
 * 트레이닝 탭 - 트레이닝 선택 목록
 * 이미지 1 디자인:
 *  1) AI 맞춤 트레이닝 (Quick Start) 추천 카드
 *  2) 카테고리별 트레이닝 그리드 (2열)
 *  3) 자유 훈련 (프리 트레이닝)
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import SuccessBanner from '../components/SuccessBanner/SuccessBanner';
import { TRAINING_BY_ID } from '../utils/trainingConfig';

interface CardItem {
  id: string;
  category: string;
  title: string;
  desc: string;
  minutes: number;
}

// 이미지 1의 그리드 카드 6개 (자유훈련 제외)
const GRID: CardItem[] = [
  { id: 'MEMORY',        category: '추천',   title: '기억력',     desc: '바둑 이전 이미지 기억과 회상 정확도를 평가하는 훈련', minutes: 7 },
  { id: 'COMPREHENSION', category: '집중',   title: '이해력',     desc: '복잡한 정보를 빠르게 이해하고 적용하는 훈련',          minutes: 6 },
  { id: 'FOCUS',         category: '기초',   title: '집중력',     desc: '주의력 분산을 줄이고 핵심 정보에 집중하는 훈련',       minutes: 5 },
  { id: 'JUDGMENT',      category: '사고',   title: '판단력',     desc: '상황 판단과 의사결정 속도를 향상시키는 훈련',          minutes: 5 },
  { id: 'ENDURANCE',     category: '체력',   title: '지구력',     desc: '꾸준한 인지 부하 환경에서 수행 능력을 키우는 훈련',     minutes: 10 },
  { id: 'AGILITY',       category: '밸런스', title: '멀티태스킹', desc: '여러 자극을 동시에 처리하는 복합 훈련',                 minutes: 8 },
];

export default function Training() {
  const navigate = useNavigate();
  const location = useLocation();

  // 백그라운드로 인해 트레이닝이 중단된 직후 1회성 안내 배너를 보여준다.
  // - location.state.abortReason === 'background' 일 때만 노출.
  // - 한 번 표시 후 history state를 즉시 비워, 같은 화면을 다시 마운트해도 재노출되지 않는다.
  // - 사용자가 명시적으로 취소(뒤로/취소 버튼)하거나 정상 종료된 경로에서는 state가 없으므로 뜨지 않는다.
  const [abortBannerOpen, setAbortBannerOpen] = useState(
    () => (location.state as { abortReason?: string } | null)?.abortReason === 'background'
  );

  useEffect(() => {
    if (abortBannerOpen) {
      // React Router state를 즉시 비워, 새로고침/뒤로가기 등으로 같은 화면이 재마운트되어도
      // 안내 배너가 재노출되지 않도록 한다.
      // window.history.replaceState 대신 router의 navigate(replace)를 사용해
      // router 내부 history 메타데이터(key/idx 등)가 손상되지 않게 한다.
      navigate(location.pathname, { replace: true, state: null });
    }
    // 최초 마운트 시 한 번만 동작.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MobileLayout>
      <SuccessBanner
        isOpen={abortBannerOpen}
        message="화면을 가린 동안 트레이닝이 중단되었어요. 다시 시작해 주세요."
        onClose={() => setAbortBannerOpen(false)}
        autoClose
        duration={4000}
      />
      <div className="max-w-md mx-auto px-4 pb-6" style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))', paddingBottom: '120px' }}>
        {/* 페이지 헤더 */}
        <div className="flex items-center gap-2 mb-6">
          <svg
            className="w-7 h-7 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <path d="M6.5 6.5l11 11" />
            <path d="M21 21l-1-1" />
            <path d="M3 3l1 1" />
            <path d="M18 22l4-4" />
            <path d="M2 6l4-4" />
            <path d="M3 10l7-7" />
            <path d="M14 21l7-7" />
          </svg>
          <h1 className="text-2xl font-bold text-white">트레이닝</h1>
        </div>

        {/* AI 맞춤 트레이닝 (Quick Start) */}
        <section className="mb-8">
          <h2 className="text-base font-semibold text-white mb-1">AI 맞춤 트레이닝(Quick Start)</h2>
          <p className="text-xs text-gray-400 mb-3">
            최근 나의 패턴을 분석해 오늘 가장 필요한 트레이닝을 바로 시작할 수 있어요.
          </p>

          <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#1A1A1A' }}>
            {/* 추천 배지 */}
            <div className="px-4 pt-4">
              <span
                className="inline-block px-3 py-1 rounded-full text-xs font-medium"
                style={{ backgroundColor: '#1E2F1A', color: '#AAED10', border: '1px solid #AAED10' }}
              >
                + 오늘의 추천 트레이닝
              </span>
            </div>

            {/* 본문 */}
            <div className="px-4 py-3">
              <h3 className="text-white text-xl font-bold mb-1.5">AI 맞춤 트레이닝</h3>
              <p className="text-gray-400 text-xs leading-relaxed">
                최근 수행 기록과 컨디션 흐름을 바탕으로 오늘 가장 적합한 훈련을 자동으로 추천해드려요.
              </p>
            </div>

            {/* 미리보기 카드 */}
            <div className="mx-4 mb-4 rounded-xl overflow-hidden" style={{ backgroundColor: '#0F0F0F' }}>
              <div
                className="w-full aspect-[16/8] bg-cover bg-center"
                style={{
                  backgroundImage: `url(${TRAINING_BY_ID.AGILITY?.image || ''})`,
                  backgroundColor: '#222',
                }}
              />
              <div className="px-3 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400">집중 회복 우선</span>
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#222', color: '#AAED10' }}>
                    약 8분
                  </span>
                </div>
                <div className="text-white text-sm font-semibold">오늘의 리듬 회복 코스</div>
                <div className="text-xs text-gray-500 mt-0.5">기억력 + 판단력 조합 추천</div>
              </div>
            </div>

            {/* AI 트레이닝 시작 버튼 */}
            <div className="px-4 pb-4">
              <button
                onClick={() => navigate('/training/setup/COMPOSITE')}
                className="w-full py-3 rounded-full font-semibold border flex items-center justify-center gap-2"
                style={{ borderColor: '#AAED10', color: '#AAED10', backgroundColor: 'transparent' }}
              >
                <span>✦</span>
                <span>AI 트레이닝 시작하기</span>
              </button>
            </div>
          </div>
        </section>

        {/* 신체 상태에 맞춰 골라보세요 */}
        <section className="mb-8">
          <h2 className="text-base font-semibold text-white mb-1">신체 상태에 맞춰 골라보세요</h2>
          <p className="text-xs text-gray-400 mb-4">뇌지컬 6대 지표 중 하나를 골라 집중 트레이닝 합니다.</p>

          <div className="grid grid-cols-2 gap-3">
            {GRID.map((item) => (
              <motion.button
                key={item.id}
                onClick={() => navigate(`/training/setup/${item.id}`)}
                whileTap={{ scale: 0.97 }}
                className="rounded-2xl overflow-hidden text-left"
                style={{ backgroundColor: '#1A1A1A' }}
              >
                <div
                  className="w-full aspect-[4/3] bg-cover bg-center"
                  style={{
                    backgroundImage: `url(${TRAINING_BY_ID[item.id]?.image || ''})`,
                    backgroundColor: '#2A2A2A',
                  }}
                />
                <div className="p-3">
                  <div className="text-[10px] mb-1" style={{ color: '#AAED10' }}>{item.category}</div>
                  <div className="text-white font-semibold text-sm mb-1">{item.title}</div>
                  <p className="text-[11px] text-gray-400 leading-snug mb-2 line-clamp-2">{item.desc}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500">{item.minutes} min</span>
                    <span className="text-gray-500">→</span>
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
        </section>

        {/* 자유 훈련 */}
        <section>
          <div
            className="inline-block px-3 py-1 rounded-full text-xs font-medium mb-3"
            style={{ backgroundColor: '#1A1A1A', color: '#999' }}
          >
            자유 훈련
          </div>
          <div className="rounded-2xl p-4" style={{ backgroundColor: '#1A1A1A' }}>
            <h3 className="text-white text-lg font-bold mb-2">프리 트레이닝</h3>
            <p className="text-xs text-gray-400 leading-relaxed mb-4">
              추천 루틴 말고 원하는 메뉴를 직접 조합해서 자유롭게 훈련할 수 있어요.
            </p>
            <button
              onClick={() => navigate('/training/setup/FREE')}
              className="w-full py-3 rounded-full font-semibold flex items-center justify-center gap-2"
              style={{ backgroundColor: '#AAED10', color: '#000' }}
            >
              직접 선택해서 시작하기 →
            </button>
          </div>
        </section>
      </div>
    </MobileLayout>
  );
}
