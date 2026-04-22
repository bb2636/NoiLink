/**
 * 트레이닝 결과 화면 (이미지 4 디자인)
 *  - 축하 메시지 + 반짝이 배경
 *  - 큰 점수 원 + 향상 점수
 *  - 직전 vs 오늘 비교 카드
 *  - 코칭 메시지
 *  - 완료 버튼
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import { DEMO_PROFILE } from '../utils/demoProfile';

export type TrainingResultState = {
  title: string;
  displayScore?: number;
  previousScore?: number;
  yieldsScore: boolean;
  sessionId?: string;
};

export default function Result() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const state = location.state as TrainingResultState | null;

  const hasPayload =
    state &&
    (Boolean(state.title) ||
      state.sessionId != null ||
      state.yieldsScore !== undefined ||
      state.displayScore != null);

  // 점수 데이터 (실데이터 없으면 데모 프로필 점수 사용 → 다른 화면과 일치)
  const todayScore = state?.displayScore ?? DEMO_PROFILE.brainIndex;
  // TODO: 서버에서 직전 점수 받아오기 — 현재는 임시로 todayScore - 12
  const prevScore = state?.previousScore ?? Math.max(0, todayScore - 12);
  const diff = todayScore - prevScore;
  const pctChange = prevScore > 0 ? Math.round((diff / prevScore) * 1000) / 10 : 0;
  const nextMilestone = Math.ceil((todayScore + 5) / 5) * 5;
  const nickname = user?.nickname || user?.name || '회원';

  // 반짝이 입자 (랜덤 시드 안정화)
  const particles = useMemo(
    () =>
      Array.from({ length: 18 }).map((_, i) => ({
        id: i,
        left: (i * 53) % 100,
        top: (i * 37) % 60,
        color: ['#AAED10', '#7CD9FF', '#FFB84D', '#E84545', '#9B7FE6'][i % 5],
        size: 3 + ((i * 7) % 4),
      })),
    []
  );

  // 점수 산출이 없는 트레이닝 (자유 트레이닝 등)
  if (hasPayload && state?.yieldsScore === false) {
    return (
      <MobileLayout>
        <div className="max-w-md mx-auto px-4 py-12 text-center">
          <h1 className="text-2xl font-bold text-white mb-3">수고했어요!</h1>
          <p className="text-gray-300 mb-8 text-sm">
            자유 트레이닝은 점수를 산출하지 않습니다.<br />합계 시간·스트릭에만 반영됩니다.
          </p>
          <div className="space-y-3">
            <button
              onClick={() => navigate('/training')}
              className="w-full py-3 rounded-2xl font-semibold border"
              style={{ borderColor: '#444', color: '#fff' }}
            >
              트레이닝 목록
            </button>
            <button
              onClick={() => navigate('/')}
              className="w-full py-3 rounded-2xl text-sm text-gray-400"
            >
              홈
            </button>
          </div>
        </div>
      </MobileLayout>
    );
  }

  if (!hasPayload) {
    return (
      <MobileLayout>
        <div className="max-w-md mx-auto px-4 py-12">
          <h1 className="text-2xl font-bold text-white mb-3">결과 없음</h1>
          <p className="text-sm text-gray-400 mb-6">
            트레이닝을 마친 뒤 이 화면으로 이동해야 점수·세션 정보가 표시됩니다.
          </p>
          <button
            onClick={() => navigate('/training')}
            className="w-full py-3 rounded-2xl font-semibold"
            style={{ backgroundColor: '#AAED10', color: '#000' }}
          >
            트레이닝 시작
          </button>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout hideBottomNav>
      <div
        className="flex flex-col"
        style={{
          minHeight: '100vh',
          background: 'radial-gradient(ellipse at top, #1a3a1a 0%, #0A0A0A 60%)',
        }}
      >
        {/* 반짝이 입자 */}
        <div className="relative w-full overflow-hidden" style={{ height: 0 }}>
          {particles.map((p) => (
            <motion.span
              key={p.id}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: [0, 1, 0.7], scale: [0, 1, 0.8] }}
              transition={{ duration: 1.5, delay: p.id * 0.04, repeat: Infinity, repeatDelay: 2 }}
              className="absolute rounded-full"
              style={{
                left: `${p.left}%`,
                top: `${p.top * 4}px`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                backgroundColor: p.color,
              }}
            />
          ))}
        </div>

        <div className="max-w-md mx-auto w-full px-5 pt-6 pb-4 flex-1 flex flex-col">
          {/* 헤더 메시지 */}
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-2xl font-bold text-white text-center leading-tight mb-1"
          >
            수고했어요,
          </motion.h1>
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-2xl font-bold text-center mb-5"
          >
            <span style={{ color: '#AAED10' }}>{nickname}</span>
            <span className="text-white"> 님</span>
            <span className="ml-1">👏</span>
          </motion.h2>

          {/* 큰 점수 원 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex justify-center mb-5"
          >
            <div
              className="w-32 h-32 rounded-full flex flex-col items-center justify-center"
              style={{
                border: '2px solid #AAED10',
                background: 'radial-gradient(circle, rgba(170,237,16,0.12) 0%, rgba(0,0,0,0) 70%)',
                boxShadow: '0 0 30px rgba(170,237,16,0.25)',
              }}
            >
              <span className="text-white text-4xl font-bold leading-none">{todayScore}</span>
              {diff > 0 && (
                <span className="text-xs mt-1" style={{ color: '#AAED10' }}>
                  +{diff}점 향상
                </span>
              )}
              {diff <= 0 && (
                <span className="text-xs mt-1 text-gray-400">오늘의 점수</span>
              )}
            </div>
          </motion.div>

          {/* 비교 카드 */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="rounded-2xl p-3 mb-3"
            style={{ backgroundColor: '#1A1A1A' }}
          >
            <div className="flex items-center justify-around">
              {/* 직전 */}
              <ScoreMini score={prevScore} label={formatPastDate()} accent="#888" />
              {/* 화살표 + 차이 */}
              <div className="flex flex-col items-center">
                <span className="text-sm mb-1" style={{ color: '#AAED10' }}>
                  {diff >= 0 ? `+${diff}` : diff}
                </span>
                <span className="text-2xl text-gray-500">→</span>
              </div>
              {/* 오늘 */}
              <ScoreMini score={todayScore} label="오늘" accent="#AAED10" highlight />
            </div>
          </motion.div>

          {/* 코칭 메시지 */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="rounded-2xl p-3 mb-4"
            style={{ backgroundColor: '#1A1A1A' }}
          >
            <p className="text-xs text-gray-300 leading-relaxed">
              💡 직전 대비{' '}
              <span className="font-bold" style={{ color: '#AAED10' }}>
                {pctChange > 0 ? '+' : ''}
                {pctChange}% 향상
              </span>
              됐어요. 꾸준한 훈련이 효과를 내고 있습니다. 이 추세라면 다음 회차에서{' '}
              <span className="font-bold text-white">{nextMilestone}점 돌파</span>도 기대할 수 있어요.
            </p>
          </motion.div>

          {/* 완료 버튼 */}
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/')}
            className="w-full py-3.5 rounded-full font-bold mt-auto"
            style={{ backgroundColor: '#AAED10', color: '#000' }}
          >
            완료
          </motion.button>
        </div>
      </div>
    </MobileLayout>
  );
}

function ScoreMini({
  score,
  label,
  accent,
  highlight = false,
}: {
  score: number;
  label: string;
  accent: string;
  highlight?: boolean;
}) {
  const SIZE = 60;
  const STROKE = 4;
  const R = (SIZE - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;
  const progress = Math.min(1, score / 100);
  return (
    <div className="flex flex-col items-center">
      <div
        className="rounded-2xl flex items-center justify-center"
        style={{
          backgroundColor: highlight ? 'rgba(170,237,16,0.10)' : 'transparent',
          padding: highlight ? 6 : 0,
        }}
      >
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} className="-rotate-90">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="#2A2A2A" strokeWidth={STROKE} fill="none" />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              stroke={accent}
              strokeWidth={STROKE}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - progress)}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-white text-base font-bold leading-none">{score}</span>
            <span className="text-[9px] text-gray-400 mt-0.5">점</span>
          </div>
        </div>
      </div>
      <span className="text-xs text-gray-400 mt-2">{label}</span>
    </div>
  );
}

function formatPastDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
