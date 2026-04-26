/**
 * 트레이닝 결과 화면 (이미지 4 디자인)
 *  - 축하 메시지 + 반짝이 배경
 *  - 큰 점수 원 + 향상 점수
 *  - 직전 vs 오늘 비교 카드
 *  - 코칭 메시지
 *  - 완료 버튼
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  isEnduranceLateConfident,
  type MetricsScore,
  type RawMetrics,
  type RecoveryRawMetrics,
  type TrainingMode,
} from '@noilink/shared';
import { MobileLayout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { DEMO_PROFILE } from '../utils/demoProfile';

export type TrainingResultState = {
  title: string;
  displayScore?: number;
  previousScore?: number;
  yieldsScore: boolean;
  sessionId?: string;
  /** BLE 단절 → 자동 재연결 회복 구간 누적 시간(ms). 0 또는 미존재면 배너 숨김. */
  recoveryExcludedMs?: number;
  /** 회복 구간 발생 횟수 (안내 문구 정밀도 향상용). */
  recoveryWindows?: number;
  /**
   * 회복 구간 세부 타임라인(Task #36). 안내 카드를 펼쳤을 때 "언제/얼마나"를
   * 보여주는 데 사용. 누락(과거 세션)이면 카드는 요약만 노출하고 목록은 숨긴다.
   */
  recoverySegments?: { startedAt: number; durationMs: number }[];
  /**
   * 부분 결과로 저장된 세션인지(Task #23).
   * true 면 점수 원 위에 "부분 결과 · {progressPct}%" 배지를 노출해
   * 정상 완료 세션과 시각적으로 구분한다. 정상 완료에서는 false/undefined.
   */
  isPartial?: boolean;
  /** 백그라운드로 끊긴 시점의 진행률(정수 %, 0~100). isPartial 일 때만 사용. */
  partialProgressPct?: number;
  /**
   * 트레이닝 API 모드. ENDURANCE 부분 저장 신뢰도 안내(Task #54)에서 ENDURANCE
   * 결과에만 Late 표본 부족 배너를 노출하기 위해 사용.
   */
  apiMode?: TrainingMode;
  /**
   * Late 구간(200~300s) 표본 수. ENDURANCE 모드에서 임계
   * (`isEnduranceLateConfident`) 미만이면 결과 화면이 신뢰도 안내를 띄운다.
   * 미존재(undefined) 면 정보 없음으로 간주해 배너를 띄우지 않는다.
   */
  enduranceLateSampleCount?: number;
  /**
   * 결과 저장 요청이 서버 idempotency 캐시 hit 으로 흡수되었는지(Task #65).
   * 사용자가 "재시도" 를 반복했지만 사실 첫 요청이 이미 서버에 도달해 저장된
   * 케이스 — 결과 화면 상단에 "이미 저장된 결과를 불러왔어요" 식의 1회성
   * 안내(subtle hint)를 띄워 같은 결과가 두 건 저장된 게 아니라는 신호를 준다.
   * 일반(첫 응답) 흐름에서는 undefined 로 안내가 뜨지 않는다.
   */
  replayed?: boolean;
};

/** 회복이 N회 이상 발생하면 환경 점검 안내를 추가로 노출 (Task #36). */
const RECOVERY_ENV_CHECK_THRESHOLD = 3;

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

  const nickname = user?.nickname || user?.name || '회원';

  // 결과 화면 재진입(기록·홈에서 같은 세션) 대응 (Task #75 / Task #95):
  // 트레이닝 직후엔 navigate state 로 점수·회복 정보가 함께 넘어오지만, 사용자가
  // 결과 화면을 떠났다 다시 들어오면 state 가 sessionId 만 남는다(또는 비어 있다).
  // 그 경우 서버에 저장된 raw.recovery 와 score 를 한 번 받아와 카드와 점수 원을
  // 동일하게 그린다. navigate state 가 회복·점수 데이터를 이미 들고 있으면
  // 호출하지 않는다 — 정상 완료 흐름의 추가 네트워크/지연 비용을 만들지 않기 위함.
  const [serverRecovery, setServerRecovery] = useState<RecoveryRawMetrics | null>(null);
  const [serverScore, setServerScore] = useState<MetricsScore | null>(null);
  const sessionIdForFetch = state?.sessionId;
  const stateProvidedRecovery = state?.recoverySegments !== undefined;
  const stateProvidedDisplayScore = state?.displayScore != null;
  // 한쪽이라도 누락되면 같은 응답으로 둘 다 채우므로 묶어서 한 번만 호출한다.
  const needsServerFetch =
    Boolean(sessionIdForFetch) &&
    (!stateProvidedRecovery || !stateProvidedDisplayScore);
  useEffect(() => {
    if (!needsServerFetch || !sessionIdForFetch) return;
    // sessionId 가 바뀌어 다시 fetch 가 필요해지면 이전 응답 잔재로 점수/회복이
    // 잠깐 잘못 보이지 않도록 먼저 비워둔다 (컴포넌트 인스턴스 재사용 안전망).
    setServerRecovery(null);
    setServerScore(null);
    let cancelled = false;
    (async () => {
      const res = await api
        .get<{ raw: RawMetrics | null; score: MetricsScore | null }>(
          `/metrics/session/${sessionIdForFetch}`,
        )
        .catch(() => null);
      if (cancelled || !res || !res.success) return;
      const recovery = res.data?.raw?.recovery;
      // 응답에 recovery 가 없으면(과거 세션) 그대로 폴백한다 — 기존
      // recoveryStats.hasSegments 폴백이 빈 카드를 자연스럽게 처리한다.
      setServerRecovery(recovery ?? null);
      // score 가 없으면(아직 계산 전이거나 과거 누락) null 로 둔다 — 점수 원은
      // 데모 프로필 폴백을 사용한다.
      setServerScore(res.data?.score ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [needsServerFetch, sessionIdForFetch]);

  // 재진입 시 직전 점수 채우기 (Task #95 → Task #114):
  // navigate state 가 displayScore 를 이미 들고 있는 정상 완료 흐름에선 추가
  // 호출을 하지 않는다. 재진입 흐름에서만 세션 단건 직전 점수 엔드포인트
  // (`GET /metrics/session/:sessionId/previous-score`) 를 호출해 받은 값을
  // 그대로 채운다. 클라이언트가 페이징·정렬을 다루지 않으므로 사용자가 50회
  // 이상 트레이닝한 뒤 옛날 세션을 다시 열어도 직전 점수가 빠지지 않는다.
  // 직전 세션이 없으면(첫 세션) 응답이 `previousScore: null` → 비교 카드는 숨긴다.
  const [serverPreviousScore, setServerPreviousScore] = useState<number | null>(null);
  const needsPreviousScoreFetch =
    Boolean(sessionIdForFetch) &&
    !stateProvidedDisplayScore &&
    state?.previousScore == null;
  useEffect(() => {
    if (!needsPreviousScoreFetch || !sessionIdForFetch) return;
    // sessionId 가 바뀌어 새로 조회가 필요해지면 이전 결과를 비워
    // 다른 세션의 직전 점수가 잠깐 노출되는 것을 막는다.
    setServerPreviousScore(null);
    let cancelled = false;
    (async () => {
      const res = await api
        .get<{ previousScore: number | null }>(
          `/metrics/session/${sessionIdForFetch}/previous-score`,
        )
        .catch(() => null);
      if (cancelled) return;
      if (!res || !res.success || !res.data) return;
      const prev = res.data.previousScore;
      if (typeof prev === 'number') {
        setServerPreviousScore(prev);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsPreviousScoreFetch, sessionIdForFetch]);

  // 서버 score 로부터 종합 점수(6대 지표 평균) 산출. 정의돼 있는 항목만
  // 평균에 포함한다 — server/routes/metrics.ts 의 세션 점수 갱신 로직과 동일.
  const serverComputedDisplayScore = useMemo(() => {
    if (!serverScore) return undefined;
    const scores = [
      serverScore.memory,
      serverScore.comprehension,
      serverScore.focus,
      serverScore.judgment,
      serverScore.agility,
      serverScore.endurance,
    ].filter((s): s is number => typeof s === 'number');
    if (scores.length === 0) return undefined;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }, [serverScore]);

  // 점수 데이터 우선순위: navigate state(정상 완료) → 서버 응답(재진입) →
  // 데모 프로필. 마지막 폴백은 어떤 경로로도 점수를 못 받았을 때만 노출된다.
  const todayScore =
    state?.displayScore ?? serverComputedDisplayScore ?? DEMO_PROFILE.brainIndex;
  // 직전 점수 결정 (Task #95 / Task #113):
  // - navigate state.previousScore 가 있으면 그대로 사용한다.
  //   정상 완료 흐름에서도 TrainingSessionPlay 가 서버 이력에서 진짜 직전
  //   점수를 미리 채워 넣는다 (Task #113 — 가짜 `todayScore - 12` 폴백 제거).
  // - 재진입 흐름(state.displayScore 미존재)에서는 서버 이력 결과만 신뢰한다.
  // - 어느 경로로도 직전 점수를 못 얻으면(첫 세션·이력 조회 실패) 비교 카드를
  //   숨긴다 — 가짜 비교를 보여 사용자를 오인시키지 않기 위함.
  let resolvedPreviousScore: number | undefined;
  if (state?.previousScore != null) {
    resolvedPreviousScore = state.previousScore;
  } else if (serverPreviousScore != null) {
    resolvedPreviousScore = serverPreviousScore;
  }
  const hasPreviousScore = resolvedPreviousScore !== undefined;
  const prevScore = resolvedPreviousScore ?? 0;
  const diff = hasPreviousScore ? todayScore - prevScore : 0;
  const pctChange =
    hasPreviousScore && prevScore > 0
      ? Math.round((diff / prevScore) * 1000) / 10
      : 0;
  const nextMilestone = Math.ceil((todayScore + 5) / 5) * 5;

  // BLE 단절 회복 안내(Task #27, Task #36): 회복 구간이 1초 이상 누적된 세션에만 노출.
  // 1초 미만은 사용자가 인지하지도 못한 일시적 신호 흔들림이므로 굳이 알리지 않는다.
  // 표기 단위는 사용자 가독성을 위해 초 단위로 올림 처리.
  // 우선순위: navigate state(방금 끝낸 세션) → 서버 응답(재진입). 둘 다 없으면 0.
  const recoveryExcludedMs =
    state?.recoveryExcludedMs ?? serverRecovery?.excludedMs ?? 0;
  const recoveryWindows = state?.recoveryWindows ?? serverRecovery?.windows ?? 0;
  const recoverySegments =
    state?.recoverySegments ?? serverRecovery?.segments ?? [];
  const showRecoveryBanner = recoveryExcludedMs >= 1000;
  const recoveryExcludedSec = Math.ceil(recoveryExcludedMs / 1000);

  // 펼침/접힘 상태 — 기본은 접힘. 카드 헤더(요약)를 누르면 세부 타임라인이 펼쳐진다.
  const [recoveryExpanded, setRecoveryExpanded] = useState(false);

  // 평균/최장 회복 시간 — segments 가 있을 때만 의미가 있다 (과거 페이로드는 폴백 0).
  const recoveryStats = useMemo(() => {
    const segs = recoverySegments.filter((s) => s.durationMs > 0);
    if (segs.length === 0) return { avgMs: 0, maxMs: 0, hasSegments: false };
    const total = segs.reduce((a, s) => a + s.durationMs, 0);
    const max = segs.reduce((a, s) => Math.max(a, s.durationMs), 0);
    return { avgMs: Math.round(total / segs.length), maxMs: max, hasSegments: true };
  }, [recoverySegments]);

  const showEnvCheck = recoveryWindows >= RECOVERY_ENV_CHECK_THRESHOLD;

  // 부분 결과 안내(Task #23): 백그라운드로 끊겨 부분 진행률만 저장된 세션은
  // 점수 원 위에 "부분 결과 · X%" 배지를 노출해, 사용자가 점수가 낮게 보여도
  // "왜 이러지?" 가 아니라 "아, 일찍 끊긴 세션이구나" 로 맥락을 이해하게 한다.
  // 진행률은 0~100 정수로 정규화 — 잘못된 값(NaN/음수/100 초과)은 안전하게 보정.
  const isPartial = state?.isPartial === true;
  const rawPartialPct = state?.partialProgressPct;
  const partialProgressPct =
    isPartial && typeof rawPartialPct === 'number' && Number.isFinite(rawPartialPct)
      ? Math.max(0, Math.min(100, Math.round(rawPartialPct)))
      : undefined;

  // ENDURANCE 부분 저장 Late 신뢰도 안내(Task #54).
  // 부분 저장 임계가 90% 인 ENDURANCE 에서 90~91% 부근에 멈추면 Late 구간(200~300s)
  // 표본이 1~2개에 그쳐 Late 의존 점수 항(maintainRatio/lateStability/lateSpeed)이
  // 우연성에 좌우될 수 있다. 표본 수를 알 수 없는 구버전 페이로드(undefined)는
  // 안내를 띄우지 않는다 — 잘못된 신뢰도 인상은 오히려 혼란을 키운다.
  const showEnduranceLowSampleBanner =
    state?.apiMode === 'ENDURANCE' &&
    typeof state?.enduranceLateSampleCount === 'number' &&
    !isEnduranceLateConfident(state.enduranceLateSampleCount);

  // idempotency 캐시 hit 안내(Task #65) — 사용자가 "재시도" 버튼을 반복해서 눌렀지만
  // 사실 첫 요청이 이미 서버에 도달해 같은 결과가 저장되었던 케이스.
  // 점수/배지 위에 1회성 subtle hint 로 노출해 "방금 다시 저장된 게 아니라
  // 같은 결과를 다시 불러온 것" 임을 명확히 한다. 사용자 흐름은 막지 않는다.
  const showReplayedHint = state?.replayed === true;

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
        <div className="max-w-md mx-auto px-4 pb-12 text-center" style={{ paddingTop: 'calc(3rem + env(safe-area-inset-top))' }}>
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
        <div className="max-w-md mx-auto px-4 pb-12" style={{ paddingTop: 'calc(3rem + env(safe-area-inset-top))' }}>
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
          paddingTop: 'env(safe-area-inset-top)',
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

          {/* idempotency 캐시 hit 안내(Task #65) — "재시도" 를 반복했지만 사실
              첫 요청이 이미 서버에 저장되어 있던 케이스. 흐름을 막지 않는 1회성
              subtle hint 로, 부분 결과 배지/점수보다도 위에 배치해 사용자가 맨
              먼저 맥락을 알아채게 한다. 색상은 점수 원의 라임/회복 카드의 호박색,
              부분 결과 배지의 연보라와 모두 겹치지 않는 차분한 회청색 톤을 사용. */}
          {showReplayedHint && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              role="status"
              data-testid="replayed-hint"
              aria-label="이미 저장된 결과를 불러왔습니다"
              className="flex justify-center mb-3"
            >
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium"
                style={{
                  backgroundColor: 'rgba(124,217,255,0.10)',
                  color: '#9CC8DC',
                  border: '1px solid rgba(124,217,255,0.30)',
                }}
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: '#9CC8DC' }}
                />
                이미 저장된 결과를 불러왔어요
              </span>
            </motion.div>
          )}

          {/* 부분 결과 배지(Task #23) — 점수 원 바로 위에 노출.
              "수고했어요" 헤더 톤(축하)과 점수(낮을 수 있음) 사이에 배지를 끼워
              사용자가 점수를 보기 직전에 맥락을 인지하게 한다. 색상은 회복 배너와
              겹치지 않게 보라/연보라 톤을 써서 "오류" 가 아니라 "안내" 임을 전한다. */}
          {isPartial && partialProgressPct !== undefined && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.18 }}
              role="status"
              aria-label={`부분 결과 ${partialProgressPct} 퍼센트 진행`}
              className="flex justify-center mb-3"
            >
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold"
                style={{
                  backgroundColor: 'rgba(155,127,230,0.15)',
                  color: '#C9B8FF',
                  border: '1px solid rgba(155,127,230,0.45)',
                }}
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: '#C9B8FF' }}
                />
                부분 결과 · {partialProgressPct}% 진행
              </span>
            </motion.div>
          )}

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

          {/* BLE 단절 회복 안내(Task #27, Task #36) — 채점에서 제외된 시간을 솔직히
              알리고, 펼치면 "언제·얼마나 끊겼는지" 타임라인과 평균/최장 회복 시간까지
              볼 수 있다. 회복이 3회 이상이면 환경 점검 안내가 추가로 노출된다. */}
          {showRecoveryBanner && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.25 }}
              role="status"
              data-testid="recovery-card"
              className="rounded-xl mb-3 text-xs overflow-hidden"
              style={{
                backgroundColor: '#3A2A00',
                color: '#FFD66B',
                border: '1px solid #5A4500',
              }}
            >
              <button
                type="button"
                onClick={() => setRecoveryExpanded((v) => !v)}
                aria-expanded={recoveryExpanded}
                aria-controls="recovery-details"
                disabled={recoverySegments.length === 0}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                style={{
                  cursor: recoverySegments.length === 0 ? 'default' : 'pointer',
                }}
              >
                <span className="flex-1 leading-snug">
                  기기 연결 회복 구간 {recoveryExcludedSec}초
                  {recoveryWindows > 1 ? ` (${recoveryWindows}회)` : ''}
                  {' '}이(가) 채점에서 제외됐어요
                </span>
                {recoverySegments.length > 0 && (
                  <span
                    aria-hidden
                    className="text-[10px] inline-block transition-transform"
                    style={{ transform: recoveryExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  >
                    ▼
                  </span>
                )}
              </button>

              <AnimatePresence initial={false}>
                {recoveryExpanded && recoverySegments.length > 0 && (
                  <motion.div
                    key="details"
                    id="recovery-details"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="px-3 pb-3"
                  >
                    {recoveryStats.hasSegments && (
                      <div
                        className="flex justify-between gap-2 py-2 mb-2 text-[11px]"
                        style={{ borderTop: '1px solid #5A4500', borderBottom: '1px solid #5A4500' }}
                      >
                        <SummaryStat label="평균" value={formatRecoveryDuration(recoveryStats.avgMs)} />
                        <SummaryStat label="최장" value={formatRecoveryDuration(recoveryStats.maxMs)} />
                        <SummaryStat label="횟수" value={`${recoveryWindows}회`} />
                      </div>
                    )}

                    <ul
                      data-testid="recovery-segment-list"
                      className="space-y-1"
                      style={{ listStyle: 'none', padding: 0, margin: 0 }}
                    >
                      {recoverySegments.map((seg, i) => (
                        <li
                          key={i}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <span style={{ color: '#E8C77A' }}>
                            {i + 1}. {formatRecoveryStart(seg.startedAt)} 시점
                          </span>
                          <span className="font-semibold">
                            {seg.durationMs > 0
                              ? formatRecoveryDuration(seg.durationMs)
                              : '진행 중'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* "환경을 점검해 보세요" 안내(Task #36) — 회복 ≥ 3회 임계값을 넘기면
                  접힘 상태에서도 항상 노출한다. 카드를 펼치는 인터랙션을 모르는
                  사용자도 신호를 볼 수 있어야 하고, segments 가 없는 과거 세션도
                  windows 카운트만으로 안내가 켜져야 가치가 있다. */}
              {showEnvCheck && (
                <div
                  data-testid="recovery-env-check"
                  className="px-3 py-2 text-[11px] leading-relaxed"
                  style={{ borderTop: '1px solid #5A4500', color: '#FFE6A8' }}
                >
                  💡 환경을 점검해 보세요 — 블루투스 간섭, 기기 배터리, 또는
                  디바이스와의 거리가 끊김의 원인일 수 있어요.
                </div>
              )}
            </motion.div>
          )}

          {/* ENDURANCE 부분 저장 Late 신뢰도 안내(Task #54) — Late 구간 표본이
              임계 미만이면 점수 해석에 주의하라는 신호를 솔직히 보여준다.
              점수 산식은 Late 의존 항을 제외하고 재정규화하지만, 사용자에게도
              왜 Late 점수가 그렇게 보이는지 설명이 필요하다. */}
          {showEnduranceLowSampleBanner && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.27 }}
              role="status"
              data-testid="endurance-late-low-sample-banner"
              className="rounded-xl px-3 py-2 mb-3 text-xs text-center"
              style={{
                backgroundColor: '#2A2230',
                color: '#D7B8FF',
                border: '1px solid #4A3A5C',
              }}
            >
              Late 구간 표본 부족 — 후반부 데이터가 적어 Late 의존 점수의 신뢰도가 낮아요
            </motion.div>
          )}

          {/* 비교 카드 — 직전 점수를 모를 때(첫 세션이거나 이력 조회 실패)는
              가짜 비교를 그려 사용자를 오인시키지 않도록 카드 자체를 숨긴다 (Task #95). */}
          {hasPreviousScore && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              data-testid="prev-vs-today-card"
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
          )}

          {/* 코칭 메시지 — 직전 점수를 모를 땐 "직전 대비" 문장은 빼고, 다음
              마일스톤 안내만 노출해 의미 없는 비교 수치를 보여주지 않는다 (Task #95). */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="rounded-2xl p-3 mb-4"
            style={{ backgroundColor: '#1A1A1A' }}
          >
            {hasPreviousScore ? (
              <p className="text-xs text-gray-300 leading-relaxed">
                💡 직전 대비{' '}
                <span className="font-bold" style={{ color: '#AAED10' }}>
                  {pctChange > 0 ? '+' : ''}
                  {pctChange}% 향상
                </span>
                됐어요. 꾸준한 훈련이 효과를 내고 있습니다. 이 추세라면 다음 회차에서{' '}
                <span className="font-bold text-white">{nextMilestone}점 돌파</span>도 기대할 수 있어요.
              </p>
            ) : (
              <p className="text-xs text-gray-300 leading-relaxed">
                💡 오늘 점수가 기록됐어요. 다음 회차에서{' '}
                <span className="font-bold text-white">{nextMilestone}점 돌파</span>를 노려봐요.
              </p>
            )}
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

/** 회복 카드 요약 라벨/값 한 쌍 (평균/최장/횟수). */
function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center flex-1">
      <span className="text-[10px]" style={{ color: '#C9A85F' }}>{label}</span>
      <span className="font-semibold text-[12px]">{value}</span>
    </div>
  );
}

/** 회복 시작 시점(세션 시작으로부터 경과 ms) → "0:14" 같은 분:초 표기. */
function formatRecoveryStart(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/** 회복 길이 표기 — 1초 미만은 "0.5초" 처럼 소수, 그 이상은 정수 초로. */
function formatRecoveryDuration(ms: number): string {
  if (ms <= 0) return '0초';
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}초`;
  return `${Math.round(ms / 1000)}초`;
}
