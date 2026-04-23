/**
 * 기관 리포트 — 5개 탭 구성
 *
 *  [전체] [6대 지표] [브레이니멀 유형] [뇌지컬 종합 평가] [소속 인원 현황]
 *
 *  - 전체: 모든 섹션 한 화면 요약
 *  - 6대 지표: 레이더 + 변화추이 (개인 페이지와 동일 컴포넌트 재사용)
 *  - 브레이니멀 유형: 분포 도넛 + 범례 + 대표 유형
 *  - 뇌지컬 종합 평가: 본인의 브레이니멀 + Fact/Life/Hint/강점/보완점
 *  - 소속 인원 현황: 이름 / 뇌지컬 점수 / 브레이니멀 / 생년월일(추정) / 최근 검사일
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import RadarChart from '../components/RadarChart';
import MultiTrendChart, { type TrendPoint } from '../components/MultiTrendChart/MultiTrendChart';
import { getBrainimalIcon, DEFAULT_BRAINIMAL } from '../utils/brainimalIcons';
import type { BrainimalType, OrganizationInsightReport, User } from '@noilink/shared';

// =============================================================================
// 데모용 하드코딩 데이터 (이미지 시안 그대로)
// TODO: 실제 API 데이터로 교체
// =============================================================================
const MOCK_REPORT: OrganizationInsightReport = {
  id: 'mock-org-report',
  organizationId: 'demo-org-001',
  organizationName: '데모 기업',
  managedMemberCount: 12,
  avgBrainAge: 79.9,
  cohortActualAvgAge: 79.7,
  brainAgeVsChronologicalDelta: 0.2,
  representativeBrainimal: 'FOX_BALANCED',
  representativeBrainimalLabel: '균형 잡힌 여우',
  avgMetricsScore: {
    memory: 82,
    comprehension: 76,
    focus: 88,
    judgment: 71,
    agility: 68,
    endurance: 74,
  } as never,
  factText: '쉽게 휘둘리지 않는 무뚝뚝한 안정감을 보여줍니다. 어떤 상황에서도 평정심을 잃지 않고 일관된 판단을 내립니다.',
  lifeText: '화려한 일렉보다는 잔잔한 신뢰감을 주는 인상입니다. 주변 사람들이 의지할 수 있는 든든한 존재로 인식됩니다.',
  hintText: '판단 시간이 다른 사람보다 약간 길지만, 한 번 결정하면 끝까지 책임지는 모범적인 회무 스타일을 보입니다.',
  strengthText: '감정 안정성과 집중력이 매우 우수합니다.',
  weaknessText: '순발력과 유연성을 보완하면 더 좋은 결과를 낼 수 있습니다.',
  metricEvidenceCards: [],
  brainimalDistribution: [
    { type: 'FOX_BALANCED',      count: 8, percent: 25 },
    { type: 'OWL_FOCUS',         count: 5, percent: 15 },
    { type: 'BEAR_ENDURANCE',    count: 4, percent: 13 },
    { type: 'KOALA_CALM',        count: 4, percent: 11 },
    { type: 'CHEETAH_JUDGMENT',  count: 3, percent: 9 },
    { type: 'DOLPHIN_BRILLIANT', count: 2, percent: 7 },
    { type: 'TIGER_STRATEGIC',   count: 2, percent: 7 },
    { type: 'CAT_DELICATE',      count: 2, percent: 5 },
    { type: 'EAGLE_INSIGHT',     count: 1, percent: 4 },
    { type: 'LION_BOLD',         count: 1, percent: 3 },
    { type: 'DOG_SOCIAL',        count: 1, percent: 2 },
    { type: 'WOLF_CREATIVE',     count: 0, percent: 1 },
  ],
  memberStatusSummary: '소속 인원 현황',
  createdAt: new Date().toISOString(),
};

const MOCK_TREND: TrendPoint[] = (() => {
  const today = new Date();
  return Array.from({ length: 10 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (9 - i));
    return {
      date: d.toISOString(),
      memory:        70 + Math.round(Math.sin(i * 0.7) * 6 + i * 1.2),
      comprehension: 65 + Math.round(Math.cos(i * 0.5) * 5 + i * 1.4),
      focus:         78 + Math.round(Math.sin(i * 0.4) * 4 + i * 0.9),
      judgment:      62 + Math.round(Math.cos(i * 0.6) * 6 + i * 1.5),
      agility:       60 + Math.round(Math.sin(i * 0.8) * 5 + i * 1.0),
      endurance:     68 + Math.round(Math.cos(i * 0.3) * 5 + i * 1.1),
    };
  });
})();

const MOCK_MEMBERS: User[] = [
  { id: 'm1',  username: 'kim01',  name: '김순자', userType: 'ORGANIZATION', age: 78, brainAge: 76, brainimalType: 'FOX_BALANCED',     streak: 5, createdAt: '', lastTrainingDate: daysAgo(0)  },
  { id: 'm2',  username: 'lee02',  name: '이영희', userType: 'ORGANIZATION', age: 82, brainAge: 84, brainimalType: 'BEAR_ENDURANCE',   streak: 3, createdAt: '', lastTrainingDate: daysAgo(1)  },
  { id: 'm3',  username: 'park03', name: '박정수', userType: 'ORGANIZATION', age: 75, brainAge: 71, brainimalType: 'OWL_FOCUS',        streak: 8, createdAt: '', lastTrainingDate: daysAgo(0)  },
  { id: 'm4',  username: 'choi04', name: '최말순', userType: 'ORGANIZATION', age: 80, brainAge: 81, brainimalType: 'KOALA_CALM',       streak: 2, createdAt: '', lastTrainingDate: daysAgo(2)  },
  { id: 'm5',  username: 'jung05', name: '정복례', userType: 'ORGANIZATION', age: 77, brainAge: 75, brainimalType: 'FOX_BALANCED',     streak: 6, createdAt: '', lastTrainingDate: daysAgo(1)  },
  { id: 'm6',  username: 'kang06', name: '강만수', userType: 'ORGANIZATION', age: 84, brainAge: 87, brainimalType: 'CHEETAH_JUDGMENT', streak: 1, createdAt: '', lastTrainingDate: daysAgo(4)  },
  { id: 'm7',  username: 'shin07', name: '신옥자', userType: 'ORGANIZATION', age: 79, brainAge: 78, brainimalType: 'DOLPHIN_BRILLIANT',streak: 4, createdAt: '', lastTrainingDate: daysAgo(0)  },
  { id: 'm8',  username: 'song08', name: '송상철', userType: 'ORGANIZATION', age: 76, brainAge: 73, brainimalType: 'TIGER_STRATEGIC',  streak: 7, createdAt: '', lastTrainingDate: daysAgo(1)  },
  { id: 'm9',  username: 'oh09',   name: '오금자', userType: 'ORGANIZATION', age: 81, brainAge: 82, brainimalType: 'CAT_DELICATE',     streak: 2, createdAt: '', lastTrainingDate: daysAgo(3)  },
  { id: 'm10', username: 'yoon10', name: '윤덕수', userType: 'ORGANIZATION', age: 78, brainAge: 76, brainimalType: 'EAGLE_INSIGHT',    streak: 5, createdAt: '', lastTrainingDate: daysAgo(0)  },
  { id: 'm11', username: 'lim11',  name: '임순녀', userType: 'ORGANIZATION', age: 83, brainAge: 86, brainimalType: 'LION_BOLD',        streak: 1, createdAt: '', lastTrainingDate: daysAgo(5)  },
  { id: 'm12', username: 'han12',  name: '한봉수', userType: 'ORGANIZATION', age: 75, brainAge: 72, brainimalType: 'DOG_SOCIAL',       streak: 9, createdAt: '', lastTrainingDate: daysAgo(0)  },
];
function daysAgo(d: number): string {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return x.toISOString();
}
void ({} as BrainimalType); // keep import alive

// 도넛 색상 팔레트 (브레이니멀 분포용)
const DONUT_COLORS = [
  '#AAED10', '#22d3ee', '#a78bfa', '#fb923c',
  '#f472b6', '#38bdf8', '#facc15', '#34d399',
  '#fb7185', '#818cf8', '#94a3b8', '#fbbf24',
];

type TabKey = 'all' | 'metrics' | 'brainimal' | 'comprehensive' | 'members';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'metrics', label: '6대 지표\n그래프' },
  { key: 'brainimal', label: '브레이니멀\n유형' },
  { key: 'comprehensive', label: '뇌지컬\n종합 평가' },
  { key: 'members', label: '소속\n인원 현황' },
];

export default function OrganizationReport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // 데모: 항상 하드코딩 데이터 표시 (실 API 연동은 추후 교체)
  // 단, 회사명은 로그인한 기업 회원의 실제 소속명으로 덮어씀.
  const report: OrganizationInsightReport = useMemo(
    () => ({
      ...MOCK_REPORT,
      organizationName: user?.organizationName ?? MOCK_REPORT.organizationName,
    }),
    [user?.organizationName],
  );
  const trendPoints: TrendPoint[] = MOCK_TREND;
  const members: User[] = MOCK_MEMBERS;
  const [tab, setTab] = useState<TabKey>('all');
  const [orgInfoOpen, setOrgInfoOpen] = useState(true);

  if (!user) return null;

  // 기업 리포트는 기업 관리자(ORGANIZATION) 전용 — 개인 회원(소속 여부 무관)은 접근 불가
  if (user.userType !== 'ORGANIZATION' || !user.organizationId) {
    return (
      <div className="px-4 py-10 text-center" style={{ color: '#fff' }}>
        <p className="text-base font-semibold mb-2">접근 권한이 없습니다</p>
        <p className="text-sm text-gray-400 mb-6">기업 리포트는 기업 관리자만 볼 수 있습니다.</p>
        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="px-6 py-2 rounded-full text-sm font-semibold"
          style={{ backgroundColor: '#AAED10', color: '#000' }}
        >
          마이페이지로
        </button>
      </div>
    );
  }

  const repInfo = getBrainimalIcon(report.representativeBrainimal);
  const delta = report.brainAgeVsChronologicalDelta;
  const deltaGood = delta <= 0;

  return (
    <div className="px-4 pb-6 space-y-4" style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))', paddingBottom: '120px', color: '#fff' }}>
      {/* 제목 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M9 18v-3" />
            <path d="M12 18v-6" />
            <path d="M15 18v-2" />
          </svg>
          <h1 className="text-lg font-bold">{report.organizationName} 리포트</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            if (navigator.share) {
              void navigator.share({
                title: 'NoiLink 기관 리포트',
                text: `${report.organizationName} 팀 리포트`,
              });
            }
          }}
          className="text-white"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M16 6l-4-4m0 0L8 6m4-4v13" />
          </svg>
        </button>
      </div>

      {/* 기업 정보 카드 (접이식) */}
      <CollapsibleCard
        title="기업 정보"
        open={orgInfoOpen}
        onToggle={() => setOrgInfoOpen((v) => !v)}
        footer={
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ backgroundColor: '#1F2A0E' }}
          >
            <div className="flex items-center gap-2">
              {repInfo.icon ? (
                <img src={repInfo.icon} alt="" className="w-5 h-5 object-contain" />
              ) : (
                <span>{repInfo.emoji}</span>
              )}
              <span className="text-sm font-medium" style={{ color: '#AAED10' }}>
                {report.representativeBrainimalLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="text-xs text-gray-400"
            >
              모든 타입 보기 &gt;
            </button>
          </div>
        }
      >
        {/* 상단: 아바타 + 기관명 */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: '#264213' }}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#AAED10" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 12h.01M9 15h.01M13 9h.01M13 12h.01M13 15h.01" />
            </svg>
          </div>
          <p className="text-base font-semibold text-white">{report.organizationName}</p>
        </div>

        {/* 구분선 */}
        <div className="h-px my-4" style={{ backgroundColor: '#262626' }} />

        {/* 총 관리 인원 */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">총 관리 인원</span>
          <span className="text-base font-semibold text-white">
            {report.managedMemberCount}명
          </span>
        </div>
      </CollapsibleCard>

      {/* 조직 평균 생체 나이 */}
      <CollapsibleCard title="조직 평균 생체 나이" open onToggle={() => {}}>
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-3">
            <span className="text-xl">🧠</span>
            <span className="text-sm text-white">평균 뇌지컬 나이</span>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold" style={{ color: '#AAED10' }}>
              {report.avgBrainAge.toFixed(1)}
            </span>
            <span className="text-base text-white"> 세</span>
            <span className="text-xs ml-2" style={{ color: deltaGood ? '#AAED10' : '#f87171' }}>
              ({delta > 0 ? '+' : ''}
              {delta})
            </span>
            <p className="text-[11px] text-gray-500 mt-0.5">
              실제 평균 ({report.cohortActualAvgAge.toFixed(1)}세) 대비
            </p>
          </div>
        </div>
      </CollapsibleCard>

      {/* 탭 스트립 — 밑줄형 */}
      <div
        className="grid grid-cols-5"
        style={{ borderBottom: '1px solid #2A2A2A' }}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="relative py-3 px-1 text-[11px] font-medium leading-tight whitespace-pre-line text-center transition-colors"
              style={{
                color: active ? '#FFFFFF' : '#888',
                fontWeight: active ? 700 : 500,
              }}
            >
              {t.label}
              {active && (
                <span
                  className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full"
                  style={{ backgroundColor: '#AAED10' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 탭 콘텐츠 */}
      {(tab === 'all' || tab === 'metrics') && (
        <MetricsTabSection
          report={report}
          trendPoints={trendPoints}
          showTitle={tab === 'metrics' || tab === 'all'}
        />
      )}

      {(tab === 'all' || tab === 'brainimal') && (
        <BrainimalTabSection report={report} totalMembers={members.length} />
      )}

      {(tab === 'all' || tab === 'comprehensive') && (
        <ComprehensiveTabSection report={report} />
      )}

      {(tab === 'all' || tab === 'members') && (
        <MembersTabSection members={members} />
      )}

      {/* 모든 탭 공통 푸터: 의료 면책 조항 */}
      <DisclaimerFooter />
    </div>
  );
}

// =============================================================================
// 6대 지표 + 변화추이 탭
// =============================================================================
function MetricsTabSection({
  report,
  trendPoints,
  showTitle,
}: {
  report: OrganizationInsightReport;
  trendPoints: TrendPoint[];
  showTitle: boolean;
}) {
  return (
    <section className="space-y-5">
      {showTitle && <h3 className="text-base font-bold text-white">6대 지표 그래프</h3>}

      <div>
        <p className="text-xs mb-2 text-gray-400">분석 결과</p>
        <p className="text-xs mb-3" style={{ color: '#666' }}>
          꼭짓점을 누르면 해당 지표의 팀 평균 점수가 표시됩니다.
        </p>
        <div className="flex justify-center">
          <RadarChart data={report.avgMetricsScore} size={260} />
        </div>
      </div>

      <div>
        {trendPoints.length > 0 ? (
          <MultiTrendChart
            data={trendPoints}
            height={200}
            headerLeft={
              <HelpDot text={`최근 '${report.organizationName}'를 기준으로 표시된 변화추이 입니다`}>
                <h4 className="text-sm font-semibold text-white">변화 추이</h4>
              </HelpDot>
            }
          />
        ) : (
          <>
            <div className="mb-2">
              <HelpDot text={`최근 '${report.organizationName}'를 기준으로 표시된 변화추이 입니다`}>
                <h4 className="text-sm font-semibold text-white">변화 추이</h4>
              </HelpDot>
            </div>
            <p className="text-sm text-gray-400 py-4 text-center">
              팀 추이를 그릴 만큼의 최근 세션이 아직 없습니다.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// 브레이니멀 유형 분포 탭
// =============================================================================
function BrainimalTabSection({
  report,
  totalMembers,
}: {
  report: OrganizationInsightReport;
  totalMembers: number;
}) {
  const repInfo = getBrainimalIcon(report.representativeBrainimal);

  // 도넛 데이터
  const total = report.brainimalDistribution.reduce((sum, r) => sum + r.percent, 0) || 100;
  const slices = useMemo(() => {
    let acc = 0;
    return report.brainimalDistribution.map((row, i) => {
      const start = (acc / total) * 360;
      acc += row.percent;
      const end = (acc / total) * 360;
      return {
        ...row,
        color: DONUT_COLORS[i % DONUT_COLORS.length],
        startAngle: start,
        endAngle: end,
      };
    });
  }, [report.brainimalDistribution, total]);

  const [hoveredType, setHoveredType] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const hoveredSlice = hoveredType
    ? slices.find((s) => s.type === hoveredType) ?? null
    : null;
  const hoveredCount = hoveredSlice
    ? Math.max(1, Math.round((hoveredSlice.percent / 100) * (totalMembers || 0)))
    : 0;
  const hoveredInfo = hoveredSlice ? getBrainimalIcon(hoveredSlice.type) : null;

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between"
      >
        <h3 className="text-base font-bold text-white">브레이니멀 유형 분포</h3>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9CA3AF"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {!collapsed && (
      <div className="flex items-center justify-around gap-2 relative">
        {/* 도넛 */}
        <div className="relative shrink-0">
          <DonutChart
            slices={slices}
            size={160}
            onHover={setHoveredType}
          />
          {/* 호버 툴팁 */}
          {hoveredSlice && hoveredInfo && (
            <div
              className="absolute z-10 pointer-events-none rounded-lg px-3 py-2 shadow-lg whitespace-nowrap"
              style={{
                left: '100%',
                top: -6,
                transform: 'translateX(8px)',
                backgroundColor: '#2A2A2A',
                border: '1px solid #3A3A3A',
              }}
            >
              <div className="flex items-center gap-1.5 text-[12px]">
                {hoveredInfo.icon ? (
                  <img src={hoveredInfo.icon} alt="" className="w-4 h-4 object-contain" />
                ) : (
                  <span>{hoveredInfo.emoji}</span>
                )}
                <span className="font-semibold text-white">{hoveredInfo.name}</span>
              </div>
              <div className="text-[11px] text-gray-300 mt-0.5 text-center">
                {hoveredCount}명
              </div>
            </div>
          )}
        </div>

        {/* 범례 — % 만 표시 (이름 제거), 우측 정렬 */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 shrink-0">
          <p className="text-[11px] text-gray-400 col-span-2 mb-1">분포 현황</p>
          {slices.map((s) => (
            <div key={s.type} className="flex items-center gap-1.5 text-[11px] py-0.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-white font-semibold">{s.percent}%</span>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* 대표 유형 카드 */}
      <div
        className="rounded-xl p-3 flex items-center gap-2 text-sm"
        style={{ backgroundColor: '#0F0F0F' }}
      >
        {repInfo.icon ? (
          <img src={repInfo.icon} alt="" className="w-5 h-5 object-contain" />
        ) : (
          <span>{repInfo.emoji}</span>
        )}
        <span className="text-gray-300">
          귀사는{' '}
          <span className="font-semibold" style={{ color: '#AAED10' }}>
            {`'${report.representativeBrainimalLabel}'`}
          </span>{' '}
          유형이 가장 많습니다.
        </span>
      </div>
    </section>
  );
}

// =============================================================================
// 뇌지컬 종합 평가 탭 (본인 브레이니멀 + 평가)
// =============================================================================
function ComprehensiveTabSection({ report: _report }: { report: OrganizationInsightReport }) {
  const { user } = useAuth();
  const myBrainimal = user?.brainimalType
    ? getBrainimalIcon(user.brainimalType)
    : DEFAULT_BRAINIMAL;
  const userName = user?.name ?? '홍길동';
  const ageDelta = (() => {
    if (!user?.brainAge || !user?.age) return 1;
    const d = user.age - user.brainAge;
    return d > 0 ? d : 1;
  })();

  const [evalOpen, setEvalOpen] = useState(true);
  const [selectedFeedback, setSelectedFeedback] = useState(0);

  return (
    <div className="space-y-4">
      {/* 본인 브레이니멀 카드 — 마스코트 + 두뇌나이 */}
      <section
        className="rounded-2xl p-6 text-center"
        style={{
          background: 'radial-gradient(circle at top, #14331c 0%, #0F1A12 70%)',
          border: '1px solid #2A4A14',
        }}
      >
        <p className="text-xs text-gray-300 mb-3">{userName}님, 축하드려요.</p>
        <div className="flex justify-center mb-3">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: '#0F0F0F',
              border: '2px solid #AAED10',
              boxShadow: '0 0 0 3px rgba(170,237,16,0.15)',
            }}
          >
            {myBrainimal.icon ? (
              <img src={myBrainimal.icon} alt="" className="w-12 h-12 object-contain" />
            ) : (
              <span className="text-4xl">{myBrainimal.emoji}</span>
            )}
          </div>
        </div>
        <h4 className="text-2xl font-extrabold" style={{ color: '#AAED10' }}>
          {myBrainimal.name}
        </h4>
        <p className="text-xs text-gray-400 mt-3">두뇌 나이 평균보다</p>
        <p className="text-base font-semibold text-white mt-0.5">
          {ageDelta}살 더 젊어요!
        </p>
      </section>

      {/* 뇌지컬 종합 평가 — 외곽 카드 테두리 제거(내부 상세분석 카드는 유지) */}
      <section>
        <button
          type="button"
          onClick={() => setEvalOpen((v) => !v)}
          className="w-full flex items-center justify-between"
        >
          <span className="text-base font-bold text-white">뇌지컬 종합 평가</span>
          <span className="text-gray-400">{evalOpen ? '⌃' : '⌄'}</span>
        </button>

        {evalOpen && (
          <div className="pt-4 space-y-5">
            {/* 상세 분석 — 외곽 카드로 감싼 영역 */}
            <div>
              <h4
                className="text-xs text-gray-300 mb-2 pl-2 border-l-2"
                style={{ borderColor: '#AAED10' }}
              >
                상세 분석
              </h4>
              <div
                className="rounded-2xl p-3 space-y-2"
                style={{ backgroundColor: '#202024', border: '1px solid #2A2A2A' }}
              >
                <EvalRowV2
                  iconType="trend"
                  iconColor="#AAED10"
                  title="쉽게 포기하지 않는 꾸준형"
                />
                <EvalRowV2
                  iconType="shield"
                  iconColor="#5EEAD4"
                  title="화려한 말뿐보다는 행동으로 보여주는 신뢰형"
                />
                <EvalRowV2
                  iconType="flag"
                  iconColor="#A78BFA"
                  title="한번 시작한 일은 끝을 보고야 마는 완주형"
                />
              </div>
            </div>

            {/* 강점 분석 */}
            <div>
              <h4
                className="text-xs text-gray-300 mb-3 pl-2 border-l-2"
                style={{ borderColor: '#AAED10' }}
              >
                강점 분석
              </h4>
              <div className="grid grid-cols-3 gap-2">
                <StrengthGauge
                  value={92}
                  status="탁월함"
                  label="강인한 인내심"
                  color="#AAED10"
                />
                <StrengthGauge
                  value={78}
                  status="안정적"
                  label="집중력 유지"
                  color="#5EEAD4"
                />
                <StrengthGauge
                  value={55}
                  status="성장 중"
                  label="정보 처리 속도"
                  color="#D9F779"
                />
              </div>
            </div>

            {/* 약점 분석 */}
            <div>
              <h4
                className="text-xs text-gray-300 mb-3 pl-2 border-l-2"
                style={{ borderColor: '#AAED10' }}
              >
                약점 분석
              </h4>
              <div className="space-y-2">
                <WeaknessRow label="변화 감지 민감도" value={35} />
                <WeaknessRow label="공동성" value={28} />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 생활 밀착 피드백 */}
      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
      >
        <h4 className="text-xs text-gray-400 mb-3 pl-2 border-l-2" style={{ borderColor: '#AAED10' }}>
          생활 밀착 피드백
        </h4>
        <div className="space-y-2">
          {[
            { n: 1, icon: '🧘', title: '1시간마다 스트레칭하기' },
            { n: 2, icon: '🎯', title: '새로운 선택 도전해보기' },
            { n: 3, icon: '🤝', title: '주변에 도움 요청하기' },
          ].map((f, i) => (
            <FeedbackStepV2
              key={f.n}
              n={f.n}
              icon={f.icon}
              title={f.title}
              selected={i === selectedFeedback}
              onClick={() => setSelectedFeedback(i)}
            />
          ))}
        </div>
      </section>

      {/* 롤모델 */}
      <section
        className="rounded-2xl p-6 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
      >
        <div className="text-center">
          <p className="text-xs" style={{ color: '#888' }}>
            {user?.organizationName ?? '송산치매안심센터'}님의 롤모델
          </p>
          <h4 className="text-3xl font-extrabold text-white mt-2">워런 버핏</h4>
          <p className="text-sm mt-4" style={{ color: '#AAED10' }}>
            "원칙이 있으면 흔들리지 않는다!"
          </p>
        </div>

        <div
          className="my-5 h-px"
          style={{ backgroundColor: '#2A2A2A' }}
        />

        <div className="space-y-5">
          <div>
            <p className="text-[13px] mb-2.5">
              <span className="font-semibold mr-2" style={{ color: '#AAED10' }}>
                01
              </span>
              <span className="text-white font-medium">핵심특성</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {['꾸준함', '장기 사고', '원칙 고수'].map((t) => (
                <span
                  key={t}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: '#1F2A0E',
                    color: '#AAED10',
                    border: '1px solid #3A5C1A',
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[13px] mb-2.5">
              <span className="font-semibold mr-2" style={{ color: '#AAED10' }}>
                02
              </span>
              <span className="text-white font-medium">뇌지컬 연결성</span>
            </p>
            <p className="text-sm font-semibold text-white leading-relaxed">
              흔들리지 않는 원칙, 복리의 마법으로 돌아옵니다.
            </p>
            <p className="text-xs mt-2 leading-relaxed" style={{ color: '#888' }}>
              단기 변동에 일희일비하지 않는 우직함이 버핏을 만들었습니다.
              당신의 꾸준함도 곧 거대한 성과가 될 거예요.
            </p>
          </div>
        </div>
      </section>

    </div>
  );
}

// =============================================================================
// 의료 면책 조항 — 모든 탭 공통 푸터
// =============================================================================
function DisclaimerFooter() {
  return (
    <section
      className="rounded-2xl p-4 border"
      style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
    >
      <p className="text-[13px] font-bold text-white mb-2">
        의료 면책 조항 (Disclaimer)
      </p>
      <p className="text-[12px] leading-relaxed" style={{ color: '#888' }}>
        본 리포트는 웰니스 및 건강 관리를 위한 참고 자료이며, 전문적인 의료적
        진단이나 치료를 대신할 수 없습니다. 측정 결과는 환경에 따라 달라질 수
        있으며, 의학적 소견이 필요한 경우 반드시 전문의와 상담하시기 바랍니다.
        (주)노이랩은 본 리포트의 해석 및 활용 결과에 대해 법적인 책임을 지지
        않습니다.
      </p>
    </section>
  );
}

// =============================================================================
// 소속 인원 현황 탭
// =============================================================================
function MembersTabSection({ members }: { members: User[] }) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const COLLAPSED_LIMIT = 5;

  const visibleMembers = expanded ? members : members.slice(0, COLLAPSED_LIMIT);
  const hasMore = members.length > COLLAPSED_LIMIT;

  return (
    <section>
      {/* 카드 밖 헤더 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-1 pb-2"
      >
        <span className="text-sm font-semibold text-white">소속 인원 현황</span>
        <span className="text-gray-400 text-xs">{open ? '⌃' : '⌄'}</span>
      </button>

      {open && (
        <>
          {members.length === 0 ? (
            <p
              className="text-sm text-gray-400 p-4 text-center rounded-2xl border"
              style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
            >
              소속 인원 데이터가 없습니다.
            </p>
          ) : (
            <div
              className="rounded-2xl border overflow-hidden"
              style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
            >
              <div className="divide-y" style={{ borderColor: '#2A2A2A' }}>
                {visibleMembers.map((m) => (
                  <div
                    key={m.id}
                    className="border-b last:border-b-0"
                    style={{ borderColor: '#2A2A2A' }}
                  >
                    <MemberRow member={m} />
                  </div>
                ))}
              </div>
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="w-full flex items-center justify-center gap-1 py-3 text-xs text-gray-300 border-t"
                  style={{ borderColor: '#2A2A2A' }}
                >
                  {expanded ? '접기' : '더보기'}
                  <span className="text-gray-400">{expanded ? '⌃' : '⌄'}</span>
                </button>
              )}
            </div>
          )}
          <p className="mt-3 text-[10px] text-gray-500">
            ※ 정확한 생년월일은 회원 프로필 입력 후 표시됩니다 (현재는 만 나이 기반 추정).
          </p>
        </>
      )}
    </section>
  );
}

function MemberRow({ member }: { member: User }) {
  const navigate = useNavigate();
  const info = member.brainimalType ? getBrainimalIcon(member.brainimalType) : null;
  const birthYear =
    member.age != null ? new Date().getFullYear() - member.age : null;
  const birthDateStr = birthYear ? `${birthYear}.09.04` : '-';
  const lastTestStr = member.lastTrainingDate
    ? formatLongDate(member.lastTrainingDate)
    : '-';

  return (
    <button
      type="button"
      onClick={() => navigate(`/report/${member.id}`)}
      className="w-full text-left p-4 transition-colors hover:bg-white/[0.02] active:bg-white/[0.04]"
    >
      {/* 상단 행: 이름님 / 뇌지컬 점수 */}
      <div className="flex items-start justify-between mb-3">
        <p className="text-base">
          <span className="font-bold text-white">{member.name}</span>
          <span className="text-gray-400"> 님</span>
        </p>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-gray-400">뇌지컬 점수</span>
          <span className="font-bold" style={{ color: '#818cf8' }}>
            {member.brainAge ?? '-'}점
          </span>
          <svg
            className="w-3.5 h-3.5 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </div>

      {/* 하단 행: 메타 정보 / 브레이니멀 pill */}
      <div className="flex items-end justify-between gap-3">
        <div className="text-[12px] space-y-1">
          <div className="flex gap-3">
            <span style={{ color: '#888' }}>생년월일</span>
            <span className="text-white">{birthDateStr}</span>
          </div>
          <div className="flex gap-3">
            <span style={{ color: '#888' }}>최근 검사일</span>
            <span className="text-white">{lastTestStr}</span>
          </div>
        </div>

        {info && (
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium shrink-0"
            style={{ backgroundColor: '#1F2A0E', color: '#AAED10' }}
          >
            {info.icon ? (
              <img src={info.icon} alt="" className="w-4 h-4 object-contain" />
            ) : (
              <span className="text-sm">{info.emoji}</span>
            )}
            {info.name}
          </span>
        )}
      </div>
    </button>
  );
}

// =============================================================================
// 공용 컴포넌트
// =============================================================================
// 헤더 옆 작은 도움말 점(?) — 폰트 크기와 비슷한 크기로 유지
// 제목 + "?" + 안내 말풍선(타이틀 줄 아래에 좌측 정렬로 표시) — 첨부 이미지와 동일
function HelpDot({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="relative inline-block">
      <div className="flex items-center gap-1.5">
        {children}
        <button
          type="button"
          aria-label="도움말"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full inline-flex items-center justify-center font-bold leading-none shrink-0"
          style={{ backgroundColor: '#FFFFFF', color: '#000000', width: 14, height: 14, minWidth: 14, minHeight: 14, padding: 0, fontSize: 9, lineHeight: '14px' }}
        >
          ?
        </button>
      </div>
      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-20 inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-[12px]"
          style={{ backgroundColor: '#2A2A2A', color: '#E5E5E5' }}
        >
          <span>{text}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            aria-label="닫기"
            className="text-[12px] leading-none"
            style={{ color: '#888' }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function CollapsibleCard({
  title,
  open,
  onToggle,
  children,
  footer,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section>
      {/* 카드 밖 헤더: 제목 + 펼침 화살표 */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-1 pb-2"
      >
        <span className="text-sm font-semibold text-white">{title}</span>
        <span className="text-gray-400 text-xs">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
        >
          <div className="p-4 space-y-2">{children}</div>
          {footer}
        </div>
      )}
    </section>
  );
}

function DonutChart({
  slices,
  size,
  onHover,
}: {
  slices: { type: string; color: string; percent: number; startAngle: number; endAngle: number }[];
  size: number;
  onHover?: (type: string | null) => void;
}) {
  const STROKE = 35;
  const R = (size - STROKE) / 2;
  const C = size / 2;

  return (
    <svg
      width={size}
      height={size}
      className="-rotate-90"
      onMouseLeave={() => onHover?.(null)}
    >
      <circle cx={C} cy={C} r={R} stroke="#2A2A2A" strokeWidth={STROKE} fill="none" />
      {slices.map((s) => {
        if (s.endAngle <= s.startAngle) return null;
        return (
          <path
            key={s.type}
            d={describeArcStroke(C, C, R, s.startAngle, s.endAngle)}
            stroke={s.color}
            strokeWidth={STROKE}
            fill="none"
            style={{ cursor: onHover ? 'pointer' : undefined }}
            onMouseEnter={() => onHover?.(s.type)}
            onMouseMove={() => onHover?.(s.type)}
          />
        );
      })}
    </svg>
  );
}

function describeArcStroke(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const start = polar(startDeg);
  const end = polar(endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function EvalRowV2({
  iconType,
  iconColor,
  title,
}: {
  iconType: 'trend' | 'shield' | 'flag';
  iconColor: string;
  title: string;
}) {
  const renderIcon = () => {
    switch (iconType) {
      case 'trend':
        return (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke={iconColor} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 17 9 11 13 15 21 7" />
            <polyline points="14 7 21 7 21 14" />
          </svg>
        );
      case 'shield':
        return (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke={iconColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
          </svg>
        );
      case 'flag':
        return (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke={iconColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 21V4" />
            <path d="M5 4h11l-2 4 2 4H5" />
          </svg>
        );
    }
  };
  return (
    <div
      className="rounded-2xl px-3 py-3 flex items-center gap-3"
      style={{ backgroundColor: '#2D2D33', border: '1px solid #3A3A40' }}
    >
      <span
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
        style={{
          backgroundColor: '#1A1A1A',
          border: `1.5px solid ${iconColor}40`,
        }}
      >
        {renderIcon()}
      </span>
      <p className="text-[13px] text-white">{title}</p>
    </div>
  );
}

function StrengthGauge({
  value,
  status,
  label,
  color,
}: {
  value: number;
  status: string;
  label: string;
  color: string;
}) {
  const SIZE = 88;
  const STROKE = 7;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - value / 100);
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="#2A2A2A" strokeWidth={STROKE} fill="none" />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={color}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ backgroundColor: `${color}26`, color }}
          >
            {status}
          </span>
        </div>
      </div>
      <span className="text-[11px] text-gray-300 mt-2 text-center">{label}</span>
    </div>
  );
}

function WeaknessRow({ label, value }: { label: string; value: number }) {
  const PURPLE = '#A78BFA';
  return (
    <div
      className="rounded-2xl px-3 py-3"
      style={{ backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A' }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ backgroundColor: '#2A1F3D' }}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke={PURPLE}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
        <p className="flex-1 text-[13px] text-white">{label}</p>
        <span className="text-sm font-bold" style={{ color: PURPLE }}>
          {value}점
        </span>
      </div>
      <div
        className="mt-2.5 h-1.5 rounded-full overflow-hidden"
        style={{ backgroundColor: '#2A2A2A' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${value}%`,
            background: `linear-gradient(90deg, #6D4FB8 0%, ${PURPLE} 100%)`,
          }}
        />
      </div>
    </div>
  );
}

function FeedbackStepV2({
  n,
  icon,
  title,
  selected,
  onClick,
}: {
  n: number;
  icon: string;
  title: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl px-3 py-3 flex items-center gap-3 text-left transition-colors"
      style={{
        backgroundColor: selected ? '#1F2D14' : '#0F0F0F',
        border: selected ? '1px solid #AAED10' : '1px solid #1F1F1F',
      }}
    >
      <span
        className="text-xs font-bold shrink-0 w-6"
        style={{ color: selected ? '#AAED10' : '#888' }}
      >
        0{n}
      </span>
      <span className="text-base shrink-0">{icon}</span>
      <span
        className="text-sm flex-1"
        style={{ color: selected ? '#FFFFFF' : '#B6B6B9' }}
      >
        {title}
      </span>
      {selected && (
        <span className="text-xs shrink-0" style={{ color: '#AAED10' }}>
          ✓
        </span>
      )}
    </button>
  );
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}
