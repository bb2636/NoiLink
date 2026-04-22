import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import RadarChart from '../components/RadarChart';
import MultiTrendChart, { type TrendPoint } from '../components/MultiTrendChart/MultiTrendChart';
import { calculateBrainAge, calculateBrainAgeChange } from '../utils/brainAge';
import { getBrainimalIcon, DEFAULT_BRAINIMAL } from '../utils/brainimalIcons';
import { DEMO_PROFILE, DEMO_METRICS } from '../utils/demoProfile';
import type { Report, MetricsScore, Session } from '@noilink/shared';

// TODO: 실제 API 데이터로 교체 — 홈/랭킹과 동일한 단일 데모 프로필 사용
const MOCK_PERSONAL_REPORT: Report = {
  id: 'mock-report-001',
  userId: 'mock-user',
  reportVersion: 12,
  brainimalType: DEMO_PROFILE.brainimalType,
  confidence: DEMO_PROFILE.confidence,
  metricsScore: {
    sessionId: 'mock-session',
    userId: 'mock-user',
    memory: DEMO_METRICS.memory,
    comprehension: DEMO_METRICS.comprehension,
    focus: DEMO_METRICS.focus,
    judgment: DEMO_METRICS.judgment,
    agility: DEMO_METRICS.agility,
    endurance: DEMO_METRICS.endurance,
    rhythm: DEMO_PROFILE.brainIndex,
    createdAt: new Date().toISOString(),
  },
  factText:
    '최근 12회의 종합 트레이닝 결과, 평균 종합 점수는 80.3점으로 동연령대 상위 22% 수준입니다. 특히 순발력과 집중력에서 안정적으로 높은 수치를 유지하고 있습니다.',
  lifeText:
    '반응 속도와 주의 유지력이 우수한 편입니다. 다만 장시간 과제에서는 후반부 정확도가 약 8% 감소하는 경향이 관찰되어, 지구력 보강 트레이닝이 도움이 될 수 있습니다.',
  hintText:
    '아침 5분의 가벼운 인지 워밍업과 충분한 수분 섭취가 오후 집중력 유지에 효과적입니다. 주 3회 이상 종합 트레이닝을 권장드립니다.',
  strengthText:
    '순발력(91점)과 집중력(88점)이 또래 평균보다 12점 이상 높습니다. 빠른 의사결정이 필요한 상황에서 강점을 발휘합니다.',
  weaknessText:
    '지구력(69점)이 상대적으로 낮습니다. 짧고 강한 트레이닝보다 중간 강도의 긴 세션을 통해 점진적으로 끌어올리는 것을 추천드립니다.',
  metricEvidenceCards: [
    { key: 'memory', label: '기억력', body: '최근 5세션 평균 78점 — 숫자 회상 과제에서 안정적 수행을 보였습니다.' },
    { key: 'focus', label: '집중력', body: '주의 유지 과제 정답률 92% — 상위 15% 수준입니다.' },
    { key: 'agility', label: '순발력', body: '평균 반응속도 412ms로 동연령대 대비 18% 빠릅니다.' },
    { key: 'endurance', label: '지구력', body: '5분 이상 세션에서 후반부 정확도 하락 폭이 평균보다 큽니다.' },
  ],
  recommendedRoleModel: {
    name: '균형잡힌 여우형',
    oneLiner: '순발력과 집중력이 균형 잡힌 분석가형',
    description:
      '빠른 판단과 안정된 집중력을 동시에 요구하는 분야에서 두각을 나타냅니다. 데이터 분석가, 응급의료, 트레이더 등이 대표적인 롤모델입니다.',
  },
  recommendedBPM: DEMO_PROFILE.bpmAvg,
  createdAt: new Date().toISOString(),
};

// TODO: 실제 API 데이터로 교체 — 데모용 변화 추이 (최근 8회)
const MOCK_TREND_POINTS: TrendPoint[] = Array.from({ length: 8 }).map((_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (7 - i) * 3);
  const base = 65 + i * 2;
  return {
    date: d.toISOString(),
    memory: base + Math.round(Math.sin(i) * 4) + 6,
    comprehension: base + Math.round(Math.cos(i) * 3) + 8,
    focus: base + 10 + Math.round(Math.sin(i + 1) * 3),
    judgment: base + 2 + Math.round(Math.cos(i + 1) * 4),
    agility: base + 14 + Math.round(Math.sin(i + 2) * 2),
    endurance: base - 4 + Math.round(Math.cos(i + 2) * 3),
  };
});

/**
 * 개인 리포트 — 명세: 프로필 요약, 6대 지표(꼭짓점 툴팁), 변화추이, 종합 평가, 롤모델, 면책
 */
// 흰 원 + 검은 물음표 — 호버/클릭 시 안내 말풍선 표시
function HelpTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="도움말"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[10px] font-bold leading-none"
        style={{ backgroundColor: '#FFFFFF', color: '#000000' }}
      >
        ?
      </button>
      {open && (
        <span
          className="absolute left-6 top-1/2 -translate-y-1/2 z-20 inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs"
          style={{ backgroundColor: '#2A2A2A', color: '#E5E5E5', border: '1px solid #3A3A3A' }}
        >
          {text}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            className="text-[10px]"
            style={{ color: '#888' }}
          >
            ✕
          </button>
        </span>
      )}
    </span>
  );
}

export default function Report() {
  const { reportId } = useParams<{ reportId?: string }>();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadReport();
  }, [reportId, user?.id]);

  const loadReport = async () => {
    if (!user) return;

    try {
      setLoading(true);

      if (reportId) {
        const reportRes = await api.get<Report>(`/reports/${reportId}`);
        if (reportRes.success && reportRes.data) {
          setReport(reportRes.data);
        }
      } else {
        const reportsRes = await api.getUserReports(user.id, 1);
        if (reportsRes.success && reportsRes.data && reportsRes.data.length > 0) {
          setReport(reportsRes.data[0]);
        } else {
          const generateRes = await api.generateReport(user.id);
          if (generateRes.success && generateRes.data) {
            setReport(generateRes.data);
          }
        }
      }

      const sessionsRes = await api.getUserSessions(user.id, {
        limit: 10,
        isComposite: true,
      });

      if (sessionsRes.success && sessionsRes.data) {
        const sessions = [...sessionsRes.data].sort(
          (a: Session, b: Session) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        type SessionMetricsPayload = { raw: unknown; score: MetricsScore | null };
        const metricsResults = await Promise.all(
          sessions.map((s: Session) => api.get<SessionMetricsPayload>(`/metrics/session/${s.id}`))
        );
        const points: TrendPoint[] = sessions.map((s: Session, i: number) => {
          const mr = metricsResults[i];
          const m = mr.success && mr.data?.score ? mr.data.score : null;
          return {
            date: s.createdAt,
            memory: m?.memory,
            comprehension: m?.comprehension,
            focus: m?.focus,
            judgment: m?.judgment,
            agility: m?.agility,
            endurance: m?.endurance,
          };
        });
        setTrendPoints(points);
      }

      await refreshUser();
    } catch (error) {
      console.error('Failed to load report:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]" style={{ color: '#999' }}>
        로딩 중...
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="max-w-md mx-auto px-4"
        style={{ backgroundColor: '#0A0A0A', minHeight: '70vh' }}
      >
        {/* 헤더 */}
        <div className="flex items-center pt-4 pb-2">
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: '#FFFFFF' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2a4 4 0 014-4h6m-6-4h6M5 7h2m-2 4h2m-2 4h2" />
          </svg>
          <h1 className="text-[15px] font-semibold text-white">리포트</h1>
        </div>

        {/* 빈 상태 카드 */}
        <div
          className="rounded-2xl p-5 mt-4"
          style={{ backgroundColor: '#1A1A1A', border: '1px solid #262626' }}
        >
          <div className="flex flex-col items-center text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: '#262626' }}
            >
              <svg className="w-7 h-7" fill="none" stroke="#AAED10" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6h13M9 11V5h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </div>
            <h3 className="text-white font-semibold text-base mb-2">
              아직 리포트가 없어요
            </h3>
            <p className="text-[13px] leading-relaxed mb-5" style={{ color: '#9CA3AF' }}>
              종합 트레이닝 유효 세션 <span style={{ color: '#AAED10' }}>3회</span>와<br />
              각 세션의 지표(메트릭) 계산이 쌓이면<br />
              리포트가 자동으로 생성됩니다.
            </p>

            <button
              type="button"
              onClick={() => navigate('/training')}
              className="w-full py-3 rounded-xl font-semibold text-[15px] mb-2"
              style={{ backgroundColor: '#AAED10', color: '#0A0A0A' }}
            >
              트레이닝 하러 가기
            </button>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full py-3 rounded-xl font-medium text-[14px]"
              style={{ backgroundColor: 'transparent', color: '#E5E7EB', border: '1px solid #2f2f2f' }}
            >
              홈으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  // TODO: 실제 리포트 생성 시 목업 제거 — 데모 환경에서 빈 화면 방지
  const effectiveReport: Report = report ?? { ...MOCK_PERSONAL_REPORT, userId: user.id };
  const effectiveTrendPoints: TrendPoint[] =
    trendPoints.length > 0 ? trendPoints : MOCK_TREND_POINTS;

  const brainimalInfo = effectiveReport.brainimalType
    ? getBrainimalIcon(effectiveReport.brainimalType)
    : DEFAULT_BRAINIMAL;

  const displayBrainAge =
    user.brainAge ?? calculateBrainAge(effectiveReport.metricsScore, user.age);
  const brainAgeChange = calculateBrainAgeChange(
    displayBrainAge,
    user.previousBrainAge
  );

  const strengthText =
    effectiveReport.strengthText ??
    '최근 세션 기준으로 상대적으로 높은 지표가 강점으로 나타납니다.';
  const weaknessText =
    effectiveReport.weaknessText ??
    '낮은 지표는 집중 트레이닝으로 단계적으로 끌어올릴 수 있습니다.';
  const evidenceCards =
    effectiveReport.metricEvidenceCards && effectiveReport.metricEvidenceCards.length > 0
      ? effectiveReport.metricEvidenceCards
      : [
          { key: 'summary', label: '종합', body: '세션 데이터가 쌓이면 지표별 근거 카드가 생성됩니다.' },
        ];
  const roleModel =
    effectiveReport.recommendedRoleModel ?? {
      name: brainimalInfo.name,
      oneLiner: brainimalInfo.description.slice(0, 48) + (brainimalInfo.description.length > 48 ? '…' : ''),
      description: brainimalInfo.description,
    };

  const orgLabel = user.organizationName || (user.organizationId ? '소속 기관' : null);

  return (
    <div
      className="px-4 py-6 space-y-5"
      style={{ paddingBottom: '120px', color: '#fff' }}
    >
      {/* 내 프로필 */}
      <section>
        <h3 className="text-base font-bold text-white mb-2">내 프로필</h3>
        <div
          className="rounded-2xl p-4 border"
          style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
        >
          {/* 상단: 아바타 + 이름/소속 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center"
                style={{ backgroundColor: '#2A2A2A' }}
              >
                {brainimalInfo.icon ? (
                  <img
                    src={brainimalInfo.icon}
                    alt={brainimalInfo.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xl font-bold" style={{ color: '#AAED10' }}>
                    {user.name.charAt(0)}
                  </span>
                )}
              </div>
              <span className="text-white font-semibold text-[15px]">
                {user.name} 님
              </span>
            </div>
            {orgLabel && (
              <span className="text-xs" style={{ color: '#B6B6B9' }}>
                소속 <span className="text-white ml-1">{orgLabel}</span>
              </span>
            )}
          </div>

          {/* 나이 / 뇌지컬 나이 한 줄 */}
          <div
            className="flex items-center justify-between rounded-xl px-4 py-3 mb-3"
            style={{ backgroundColor: '#0F0F0F' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: '#888' }}>나이</span>
              <span className="text-white font-semibold text-sm">
                {user.age != null ? `${user.age}세` : '-'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: '#888' }}>뇌지컬 나이</span>
              <span className="text-white font-semibold text-sm">{displayBrainAge}세</span>
              {brainAgeChange && (
                <span
                  className="text-xs font-medium"
                  style={{ color: brainAgeChange.isImproved ? '#AAED10' : '#f87171' }}
                >
                  ({brainAgeChange.isImproved ? '-' : '+'}{brainAgeChange.value})
                </span>
              )}
            </div>
          </div>

          {/* 브레이니멀 라벨 + 모든 타입 보기 */}
          <div className="flex items-center justify-between">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ backgroundColor: '#2A2A2A', color: brainimalInfo.color }}
            >
              {brainimalInfo.icon && (
                <img src={brainimalInfo.icon} alt="" className="w-4 h-4 rounded-full object-cover" />
              )}
              {brainimalInfo.name}
            </span>
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="text-xs font-medium"
              style={{ color: '#B6B6B9' }}
            >
              모든 타입 보기 &gt;
            </button>
          </div>
        </div>
      </section>

      {/* 6대 지표 그래프 */}
      <section>
        <h3 className="text-base font-bold text-white mb-2">6대 지표 그래프</h3>
        <div
          className="rounded-2xl p-4 border"
          style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
        >
          <p className="text-sm font-semibold text-white mb-3">핵심 두뇌 능력 결과</p>
          <div className="flex justify-center">
            <RadarChart data={effectiveReport.metricsScore} size={280} />
          </div>
          <p className="text-[11px] mt-3" style={{ color: '#666' }}>
            그래프 끝(꼭짓점)을 누르면 해당 항목의 점수가 표시됩니다.
          </p>
        </div>
      </section>

      {/* 변화추이 */}
      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 relative">
            <h3 className="text-lg font-bold text-white">변화 추이</h3>
            <HelpTooltip
              text={`최근 ${orgLabel ? `‘${orgLabel}’` : '세션'}을 기준으로 표시된 변화추이 입니다`}
            />
          </div>
        </div>
        <MultiTrendChart data={effectiveTrendPoints} height={220} />
      </section>

      {/* 뇌지컬 종합 평가 */}
      <section
        className="rounded-2xl p-4 border space-y-5"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <h3 className="text-lg font-bold text-white">뇌지컬 종합 평가</h3>

        <div>
          <h4 className="text-sm font-semibold mb-2" style={{ color: '#AAED10' }}>
            지표별 근거
          </h4>
          <div className="grid gap-2">
            {evidenceCards.map((c) => (
              <div
                key={c.key}
                className="rounded-xl p-3 text-sm"
                style={{ backgroundColor: '#0A0A0A', color: '#E5E5E5' }}
              >
                <span className="font-semibold text-white">{c.label}</span>
                <p className="mt-1 leading-relaxed" style={{ color: '#B6B6B9' }}>
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white mb-1">종합 평가</h4>
          <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
            {effectiveReport.factText}
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white mb-1">상세 분석</h4>
          <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
            {effectiveReport.lifeText}
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white mb-1">강점</h4>
          <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
            {strengthText}
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white mb-1">보완점</h4>
          <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
            {weaknessText}
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white mb-1">생활 밀착 피드백</h4>
          <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
            {effectiveReport.hintText}
          </p>
        </div>
      </section>

      {/* 추천 롤모델 */}
      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <h3 className="text-lg font-bold mb-3 text-white">추천 롤모델</h3>
        <div className="rounded-xl p-4" style={{ backgroundColor: '#0A0A0A' }}>
          <p className="text-base font-bold" style={{ color: '#AAED10' }}>
            {roleModel.name}
          </p>
          <p className="text-sm mt-1 text-white">{roleModel.oneLiner}</p>
          <p className="text-sm mt-3 leading-relaxed" style={{ color: '#B6B6B9' }}>
            {roleModel.description}
          </p>
        </div>
      </section>

      <p className="text-[11px] text-center leading-relaxed px-2" style={{ color: '#666' }}>
        본 검사 결과는 의학적 진단을 대체하지 않으며, 참고용으로만 사용하시기 바랍니다.
      </p>
    </div>
  );
}
