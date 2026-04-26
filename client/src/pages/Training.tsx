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
import {
  getTrainingAbortNotice,
  isTrainingAbortReason,
  type TrainingAbortReason,
  type TrainingAbortTone,
} from './trainingAbortReason';
import {
  popOutcomeNotices,
  type PendingTrainingOutcome,
} from '../utils/pendingTrainingRuns';

// 비정상 종료 안내 배너의 톤별 색상.
// neutral: 일반 안내(검정 배경/흰 글자),
// warning: 주의가 필요한 사유(주황 배경/검정 글자),
// caution: 환경 점검을 권하는 회복 가능한 사유(노란 톤 — Task #38 토스트와 동일한 #3A2A00 / #FFD66B).
const ABORT_BANNER_STYLE: Record<TrainingAbortTone, { background: string; text: string }> = {
  neutral: { background: '#1A1A1A', text: '#FFFFFF' },
  warning: { background: '#F59E0B', text: '#1A1A1A' },
  caution: { background: '#3A2A00', text: '#FFD66B' },
};

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

interface QueuedBanner {
  key: string;
  message: string;
  background: string;
  textColor: string;
}

function formatOutcomeMessage(o: PendingTrainingOutcome): string {
  const what = o.title ? `'${o.title}'` : '이전';
  if (o.outcome === 'success') {
    return `${what} 트레이닝 결과를 백그라운드에서 안전하게 저장했어요.`;
  }
  return `${what} 트레이닝 결과를 끝내 저장하지 못했어요. 네트워크가 안정될 때 다시 시도해 주세요.`;
}

function outcomeStyle(o: PendingTrainingOutcome): { background: string; text: string } {
  return o.outcome === 'success'
    ? { background: '#1E2F1A', text: '#AAED10' }
    : ABORT_BANNER_STYLE.warning;
}

export default function Training() {
  const navigate = useNavigate();
  const location = useLocation();

  // 트레이닝이 의도치 않게 종료되면 1회성 안내 배너를 보여준다.
  // - location.state.abortReason 값에 따라 사유별 메시지/톤을 사용 (TRAINING_ABORT_NOTICE).
  // - 한 번 표시 후 history state를 즉시 비워, 같은 화면을 다시 마운트해도 재노출되지 않는다.
  // - 사용자가 명시적으로 취소(뒤로/취소 버튼) — 단, 결과 저장 실패 후 떠난 경우는 제외 — 하거나
  //   정상 종료된 경로에서는 state가 없으므로 배너가 뜨지 않는다.
  const [abortInfo, setAbortInfo] = useState<{
    reason: TrainingAbortReason;
    bleUnstable: boolean;
  } | null>(() => {
    const raw = location.state as
      | { abortReason?: unknown; bleUnstable?: unknown }
      | null;
    if (!raw || !isTrainingAbortReason(raw.abortReason)) return null;
    // bleUnstable 은 'ble-disconnect' 사유에서만 의미가 있다 — 다른 사유에는 무시.
    // 알 수 없는 값(미설정/잘못된 타입)도 false 로 안전 회귀.
    const bleUnstable =
      raw.abortReason === 'ble-disconnect' && raw.bleUnstable === true;
    return { reason: raw.abortReason, bleUnstable };
  });

  // 백그라운드 drain 결과(성공/최종 실패)를 1회성 배너로 안내하기 위해
  // 마운트 시 outcome 큐를 비우고 메모리에 보관한다.
  // 배너가 닫히면 한 건씩 소비된다 — 같은 결과가 두 번 노출되지 않는다.
  const [outcomes, setOutcomes] = useState<PendingTrainingOutcome[]>(() => popOutcomeNotices());

  useEffect(() => {
    if (abortInfo) {
      // React Router state를 즉시 비워, 새로고침/뒤로가기 등으로 같은 화면이 재마운트되어도
      // 안내 배너가 재노출되지 않도록 한다.
      // window.history.replaceState 대신 router의 navigate(replace)를 사용해
      // router 내부 history 메타데이터(key/idx 등)가 손상되지 않게 한다.
      navigate(location.pathname, { replace: true, state: null });
    }
    // 최초 마운트 시 한 번만 동작.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abortNotice = abortInfo
    ? getTrainingAbortNotice(abortInfo.reason, { bleUnstable: abortInfo.bleUnstable })
    : null;
  const abortStyle = abortNotice ? ABORT_BANNER_STYLE[abortNotice.tone] : null;

  // 배너는 위치(fixed top-0)가 겹치므로 한 번에 하나씩 노출.
  // 우선순위: 비정상 종료(abort) → 백그라운드 drain 결과 outcome 들 (FIFO).
  const banners: QueuedBanner[] = [];
  if (abortInfo && abortNotice && abortStyle) {
    banners.push({
      // 같은 사유라도 bleUnstable 여부에 따라 메시지/톤이 달라지므로 키에 포함.
      key: `abort-${abortInfo.reason}-${abortInfo.bleUnstable ? 'unstable' : 'plain'}`,
      message: abortNotice.message,
      background: abortStyle.background,
      textColor: abortStyle.text,
    });
  }
  for (const o of outcomes) {
    const s = outcomeStyle(o);
    banners.push({
      key: `outcome-${o.localId}`,
      message: formatOutcomeMessage(o),
      background: s.background,
      textColor: s.text,
    });
  }
  const activeBanner = banners[0];

  const dismissActiveBanner = () => {
    if (abortInfo) {
      setAbortInfo(null);
      return;
    }
    setOutcomes((prev) => prev.slice(1));
  };

  return (
    <MobileLayout>
      <SuccessBanner
        // key 변경으로 SuccessBanner 내부 setTimeout 가 새 배너마다 다시 시작되도록 한다.
        key={activeBanner?.key ?? 'none'}
        isOpen={!!activeBanner}
        message={activeBanner?.message ?? ''}
        onClose={dismissActiveBanner}
        autoClose
        duration={4000}
        backgroundColor={activeBanner?.background}
        textColor={activeBanner?.textColor}
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
