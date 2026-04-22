import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import { useHome } from '../hooks/useHome';
import { useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { getBrainimalIcon } from '../utils/brainimalIcons';
import { DEMO_PROFILE } from '../utils/demoProfile';

// 데모 프로필 단일 출처 — 리포트/랭킹과 동일한 수치를 사용
// TODO: 실제 API 데이터로 교체
const MOCK_HOME = {
  brainimalType: DEMO_PROFILE.brainimalType,
  brainIndex: DEMO_PROFILE.brainIndex,
  bpmAvg: DEMO_PROFILE.bpmAvg,
  weeklyChange: DEMO_PROFILE.weeklyChange,
  scoreUpDelta: DEMO_PROFILE.scoreUpDelta,
  trendPoints: DEMO_PROFILE.trendPoints,
  checkedDays: DEMO_PROFILE.checkedDays,
  streakDays: DEMO_PROFILE.streakDays,
  topTrainings: DEMO_PROFILE.topTrainings,
};

type HomeVariant = 'first-time' | 'streak-active' | 'streak-broken' | 'enterprise';

/**
 * 사용자 상태 → 홈 분기 결정
 *  1. 첫 회원가입 (트레이닝 첫 시도 전): lastTrainingDate 없음
 *  2. 트레이닝 연속 (어제·오늘 훈련): streak > 0 && days since last <= 1
 *  3. 트레이닝 연속 끊김: 이외
 *  4. 기업 회원: userType === ORGANIZATION → 연속 여부와 무관하게 전용 화면
 */
function resolveVariant(user: { userType?: string; streak?: number; lastTrainingDate?: string } | null): HomeVariant {
  if (!user) return 'first-time';
  if (user.userType === 'ORGANIZATION') return 'enterprise';
  // TODO: 실 데이터 도입 시 first-time/broken 분기 복구
  // 데모: 항상 streak-active 화면(목업)을 노출하여 빈 화면 방지
  return 'streak-active';
}

export default function Home() {
  const { user } = useAuth();
  const home = useHome(user?.id || null);
  const variant = resolveVariant(user as any);

  if (home.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
        <div className="text-white">로딩 중...</div>
      </div>
    );
  }

  if (variant === 'first-time') {
    return <FirstTimeHome />;
  }

  return <StandardHome variant={variant} home={home} user={user as any} />;
}

// =============================================================================
// 1) 첫 회원가입 — 트레이닝 첫 시도 전
// =============================================================================
function FirstTimeHome() {
  const navigate = useNavigate();
  return (
    <div style={{ backgroundColor: '#0A0A0A', minHeight: '100vh' }} className="flex flex-col">
      {/* 상단 로고 */}
      <div
        className="px-4 pt-6"
        style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))' }}
      >
        <div className="max-w-md mx-auto">
          <Logo size="md" white />
        </div>
      </div>

      {/* 중앙 안내 + CTA */}
      <div
        className="flex-1 flex flex-col items-center justify-center px-6 max-w-md mx-auto w-full"
        style={{ paddingBottom: 'calc(120px + env(safe-area-inset-bottom))' }}
      >
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-white text-lg font-medium text-center mb-16"
        >
          지금 당신의 두뇌 에너지를 측정해볼까요?
        </motion.p>

        <motion.button
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => navigate('/training')}
          className="px-10 py-3 rounded-full font-semibold text-black"
          style={{ backgroundColor: '#AAED10' }}
        >
          테스트하기
        </motion.button>
      </div>
    </div>
  );
}

// =============================================================================
// 2/3/4) 표준 홈 (active / broken / enterprise)
// =============================================================================
interface StandardProps {
  variant: 'streak-active' | 'streak-broken' | 'enterprise';
  home: ReturnType<typeof useHome>;
  user: { id: string; nickname?: string; name?: string; streak?: number } | null;
}

function StandardHome({ variant, home, user }: StandardProps) {
  const navigate = useNavigate();
  const { banners } = home;

  // 배너 캐러셀
  const [bannerIdx, setBannerIdx] = useState(0);
  const slideRef = useRef<NodeJS.Timeout | null>(null);
  const displayBanners = banners.length > 0 ? banners : [null];
  const currentBanner = displayBanners[bannerIdx];

  useEffect(() => {
    if (displayBanners.length <= 1) return;
    slideRef.current = setInterval(() => {
      setBannerIdx((p) => (p === displayBanners.length - 1 ? 0 : p + 1));
    }, 5000);
    return () => {
      if (slideRef.current) clearInterval(slideRef.current);
    };
  }, [displayBanners.length]);

  // 리포트/랭킹과 동일한 단일 데모 프로필 사용
  // 데모 사용자는 화면 간 100% 일치를 보장하기 위해 서버값(condition?.score, user.streak)을 무시하고
  // DEMO_PROFILE 값을 사용. 실제 사용자 데이터는 추후 API 연동 시 분기.
  const brainIndex = MOCK_HOME.brainIndex;
  const bpmAvg = MOCK_HOME.bpmAvg;
  const weeklyChange = MOCK_HOME.weeklyChange;
  const streakDays = MOCK_HOME.streakDays;
  const nickname = user?.nickname || user?.name || '회원';
  const brainimalInfo = getBrainimalIcon(MOCK_HOME.brainimalType);

  // 요일 트렌드 (월~일)
  const weekdayLabels = ['월', '화', '수', '목', '금', '토', '일'];
  const checkedDays = useMemo(() => {
    if (variant === 'streak-broken') return [true, true, false, false, false, false, false];
    return MOCK_HOME.checkedDays;
  }, [variant]);

  return (
    <div style={{ backgroundColor: '#0A0A0A', minHeight: '100vh' }}>
      {/* 헤더 */}
      <div
        className="fixed top-0 left-0 right-0 z-40"
        style={{ backgroundColor: '#0A0A0A', paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <Logo size="md" white />
          <button onClick={() => navigate('/device')} className="text-white text-sm">
            기기 관리 &gt;
          </button>
        </div>
      </div>

      <div
        className="max-w-md mx-auto px-4"
        style={{
          paddingTop: 'calc(80px + env(safe-area-inset-top))',
          paddingBottom: 'calc(120px + env(safe-area-inset-bottom))',
        }}
      >
        {/* 배너 카드 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative mb-5 rounded-2xl overflow-hidden"
          style={{ backgroundColor: '#1A1A1A', aspectRatio: '16/9' }}
        >
          <AnimatePresence mode="wait">
            {currentBanner ? (
              <motion.div
                key={currentBanner.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="relative w-full h-full"
              >
                <img src={currentBanner.imageUrl} alt={currentBanner.title} className="w-full h-full object-cover" />
              </motion.div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-7xl opacity-30" style={{ color: '#AAED10' }}>
                🧠
              </div>
            )}
          </AnimatePresence>
          {displayBanners.length > 1 && (
            <div className="absolute bottom-3 right-3 text-white text-xs bg-black bg-opacity-50 px-2 py-0.5 rounded-full">
              {bannerIdx + 1}/{displayBanners.length}
            </div>
          )}
        </motion.div>

        {/* 프로필 카드 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="rounded-2xl p-4 mb-6"
          style={{ backgroundColor: '#1A1A1A' }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden"
                style={{ backgroundColor: '#2A2A2A' }}
              >
                <img
                  src={brainimalInfo.icon}
                  alt={brainimalInfo.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-white text-sm font-medium">{nickname}님</span>
            </div>
            <span
              className="px-2.5 py-1 rounded-full text-xs font-medium flex items-center gap-1.5"
              style={{ backgroundColor: '#2A2A2A', color: brainimalInfo.color }}
            >
              <img src={brainimalInfo.icon} alt="" className="w-4 h-4 rounded-full object-cover" />
              {brainimalInfo.name}
            </span>
          </div>
          <button
            onClick={() => navigate('/training')}
            className="w-full py-3 rounded-full font-semibold border"
            style={{ borderColor: '#AAED10', color: '#AAED10', backgroundColor: 'transparent' }}
          >
            ✦ AI 맞춤 트레이닝
          </button>
        </motion.div>

        {/* 트레이닝 요약 */}
        <h2 className="text-white text-base font-semibold mb-3">트레이닝 요약</h2>
        <div className="rounded-2xl p-4 mb-6" style={{ backgroundColor: '#1A1A1A' }}>
          <div className="flex items-center justify-between mb-4">
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold text-black" style={{ backgroundColor: '#AAED10' }}>
              주간 성장률 +{weeklyChange}
            </span>
            <button onClick={() => navigate('/profile')} className="text-gray-400 text-lg">→</button>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-gray-400 text-xs mb-1">뇌 지수 리포트</div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">🧠</span>
                <span className="text-white text-2xl font-bold">{brainIndex}점</span>
              </div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">BPM 평균</div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">💚</span>
                <span className="text-white text-2xl font-bold">{bpmAvg}bpm</span>
              </div>
            </div>
          </div>
          <div className="text-gray-400 text-xs mb-2">자주하는 트레이닝</div>
          <div className="flex gap-2 flex-wrap">
            {MOCK_HOME.topTrainings.map((t) => (
              <span
                key={t}
                className="px-3 py-1 rounded-full text-xs border border-gray-600 text-gray-300"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* 나의 트렌드 */}
        <h2 className="text-white text-base font-semibold mb-3">나의 트렌드</h2>
        <div className="rounded-2xl p-4 mb-5" style={{ backgroundColor: '#1A1A1A' }}>
          <div className="grid grid-cols-7 gap-1">
            {weekdayLabels.map((d, i) => (
              <div key={d} className="flex flex-col items-center gap-2">
                <span className="text-gray-400 text-xs">{d}</span>
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: checkedDays[i] ? '#AAED10' : '#2A2A2A' }}
                >
                  {checkedDays[i] && <span className="text-black text-sm">✓</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 연속 트레이닝 트렌드 — variant별 분기 */}
        <StreakSection variant={variant} streakDays={streakDays} onStart={() => navigate('/training')} />

        {/* 최근 트레이닝 점수 변화 */}
        <h2 className="text-white text-base font-semibold mt-6 mb-3">최근 트레이닝 점수 변화 트렌드</h2>
        <div className="rounded-2xl p-4" style={{ backgroundColor: '#1A1A1A' }}>
          <div className="text-sm mb-3" style={{ color: '#AAED10' }}>
            트레이닝 점수가 {MOCK_HOME.scoreUpDelta}점 상승했네요!
          </div>
          <MiniLineChart points={MOCK_HOME.trendPoints} />
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 연속 트레이닝 트렌드 — variant 별 다른 표시
// -----------------------------------------------------------------------------
function StreakSection({
  variant,
  streakDays,
  onStart,
}: {
  variant: 'streak-active' | 'streak-broken' | 'enterprise';
  streakDays: number;
  onStart: () => void;
}) {
  const isActive = variant === 'streak-active';

  return (
    <div
      className="rounded-2xl p-4 relative overflow-hidden"
      style={{
        background: isActive
          ? 'linear-gradient(135deg, #1a2a1a 0%, #1A1A1A 100%)'
          : 'linear-gradient(135deg, #1a2a1a 0%, #1A1A1A 100%)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="text-white font-semibold mb-1">연속 트레이닝 트렌드</div>
          <div className="text-gray-400 text-xs leading-relaxed">
            {isActive ? '꾸준함이 확실히 쌓이고 있어요!' : '오늘 훈련을 완료하면\n연속 트레이닝 불씨가 켜져요!'}
          </div>
        </div>

        {isActive ? (
          // 원형 진행도 + 일수 + 불꽃
          <div className="relative w-16 h-16 flex items-center justify-center">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" stroke="#2A2A2A" strokeWidth="4" fill="none" />
              <circle
                cx="32"
                cy="32"
                r="28"
                stroke="#AAED10"
                strokeWidth="4"
                fill="none"
                strokeDasharray={`${(Math.min(streakDays, 7) / 7) * 175.9} 175.9`}
                strokeLinecap="round"
              />
            </svg>
            <div className="text-center">
              <div className="text-white font-bold text-lg leading-none">{streakDays}일</div>
              <div className="text-orange-400 text-sm">🔥</div>
            </div>
          </div>
        ) : (
          // 시작하기 버튼
          <button
            onClick={onStart}
            className="px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1"
            style={{ backgroundColor: 'transparent', color: '#AAED10', border: '1px solid #AAED10' }}
          >
            <span>🔥</span>
            <span>시작하기</span>
          </button>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 미니 라인 차트 (자리잡이용 SVG)
// -----------------------------------------------------------------------------
function MiniLineChart({ points = [60, 65, 62, 70, 68, 75, 80, 78, 82, 90] }: { points?: number[] }) {
  const max = 100;
  const w = 280;
  const h = 100;
  const stepX = w / (points.length - 1);
  const path = points.map((y, i) => `${i === 0 ? 'M' : 'L'} ${i * stepX} ${h - (y / max) * h}`).join(' ');
  const last = points[points.length - 1];

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${w} ${h + 20}`} className="w-full h-auto">
        {/* 가로 그리드 */}
        {[0, 50, 100].map((g) => (
          <line key={g} x1={0} y1={h - (g / max) * h} x2={w} y2={h - (g / max) * h} stroke="#2A2A2A" strokeWidth="1" />
        ))}
        {/* 라벨 */}
        {[100, 50, 0].map((g) => (
          <text key={g} x={-2} y={h - (g / max) * h + 4} fill="#666" fontSize="9" textAnchor="end">
            {g}
          </text>
        ))}
        {/* 라인 */}
        <path d={path} stroke="#AAED10" strokeWidth="2" fill="none" />
        {/* 마지막 점 */}
        <circle cx={(points.length - 1) * stepX} cy={h - (last / max) * h} r="4" fill="#AAED10" />
        {/* x축 라벨 */}
        {points.map((_, i) => (
          <text key={i} x={i * stepX} y={h + 14} fill="#666" fontSize="9" textAnchor="middle">
            {i + 1}
          </text>
        ))}
      </svg>
    </div>
  );
}
