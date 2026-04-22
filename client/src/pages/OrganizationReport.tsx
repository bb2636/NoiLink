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
  const report: OrganizationInsightReport = MOCK_REPORT;
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
    <div className="px-4 py-6 space-y-4" style={{ paddingBottom: '120px', color: '#fff' }}>
      {/* 제목 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
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
      >
        <div
          className="rounded-xl p-4 flex items-center justify-between"
          style={{ backgroundColor: '#0F0F0F' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-md flex items-center justify-center text-lg"
              style={{ backgroundColor: '#264213', color: '#AAED10' }}
            >
              📋
            </div>
            <div>
              <p className="text-base font-semibold text-white">{report.organizationName}</p>
              <p className="text-xs mt-1 text-gray-400">총 관리 인원</p>
            </div>
          </div>
          <span className="text-base font-semibold text-white">
            {report.managedMemberCount}명
          </span>
        </div>

        <div
          className="mt-3 rounded-xl px-4 py-3 flex items-center justify-between"
          style={{ backgroundColor: '#0F0F0F', border: '1px solid #2A2A2A' }}
        >
          <div className="flex items-center gap-2">
            {repInfo.icon ? (
              <img src={repInfo.icon} alt="" className="w-5 h-5 object-contain" />
            ) : (
              <span>{repInfo.emoji}</span>
            )}
            <span className="text-sm" style={{ color: '#AAED10' }}>
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
      </CollapsibleCard>

      {/* 조직 평균 생체 나이 */}
      <CollapsibleCard title="조직 평균 생체 나이" open onToggle={() => {}}>
        <div
          className="rounded-xl p-4 flex items-center justify-between"
          style={{ backgroundColor: '#0F0F0F' }}
        >
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

      {/* 탭 스트립 */}
      <div
        className="grid grid-cols-5 gap-1 rounded-xl p-1"
        style={{ backgroundColor: '#0F0F0F' }}
      >
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="rounded-lg py-2 px-1 text-[11px] font-medium leading-tight whitespace-pre-line text-center transition-colors"
              style={{
                backgroundColor: active ? '#1F2A0E' : 'transparent',
                color: active ? '#AAED10' : '#888',
              }}
            >
              {t.label}
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
        <BrainimalTabSection report={report} />
      )}

      {(tab === 'all' || tab === 'comprehensive') && (
        <ComprehensiveTabSection report={report} />
      )}

      {(tab === 'all' || tab === 'members') && (
        <MembersTabSection members={members} />
      )}

      <div
        className="rounded-2xl p-4 border text-[11px] leading-relaxed"
        style={{ backgroundColor: '#0F0F0F', borderColor: '#2A2A2A', color: '#888' }}
      >
        <p className="font-semibold text-white mb-1">의료 면책 조항 (Disclaimer)</p>
        본 리포트는 웰니스 및 건강 관리를 위한 참고 자료이며, 전문적인 의료적 진단이나 치료를 대신할 수 없습니다.
        측정 결과는 환경에 따라 달라질 수 있으며, 의학적 소견이 필요한 경우 반드시 전문의와 상담하시기 바랍니다.
      </div>
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
    <section
      className="rounded-2xl p-4 border space-y-5"
      style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
    >
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
        <div className="flex items-center gap-1.5 mb-2">
          <h4 className="text-sm font-semibold text-white">변화 추이</h4>
          <HelpDot text="최근 세션을 기준으로 표시된 팀 평균 변화추이 입니다" />
        </div>
        {trendPoints.length > 0 ? (
          <MultiTrendChart data={trendPoints} height={200} />
        ) : (
          <p className="text-sm text-gray-400 py-4 text-center">
            팀 추이를 그릴 만큼의 최근 세션이 아직 없습니다.
          </p>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// 브레이니멀 유형 분포 탭
// =============================================================================
function BrainimalTabSection({ report }: { report: OrganizationInsightReport }) {
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

  return (
    <section
      className="rounded-2xl p-4 border space-y-4"
      style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
    >
      <h3 className="text-base font-bold text-white">브레이니멀 유형 분포</h3>

      <div className="flex items-center gap-4">
        {/* 도넛 */}
        <DonutChart slices={slices} size={140} />

        {/* 범례 */}
        <div className="flex-1 grid grid-cols-2 gap-x-2 gap-y-1.5">
          <p className="text-[11px] text-gray-400 col-span-2 mb-0.5">분포 현황</p>
          {slices.map((s) => (
            <div key={s.type} className="flex items-center gap-1.5 text-[11px]">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-white font-semibold">{s.percent}%</span>
              <span className="text-gray-400 truncate">{getBrainimalIcon(s.type).name}</span>
            </div>
          ))}
        </div>
      </div>

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
function ComprehensiveTabSection({ report }: { report: OrganizationInsightReport }) {
  const { user } = useAuth();
  const myBrainimal = user?.brainimalType
    ? getBrainimalIcon(user.brainimalType)
    : DEFAULT_BRAINIMAL;
  const myScore = user?.brainAge ?? '-';

  return (
    <section
      className="rounded-2xl p-4 border space-y-5"
      style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
    >
      {/* 본인 브레이니멀 카드 */}
      <div
        className="rounded-2xl p-5 text-center"
        style={{
          background: 'radial-gradient(circle at top, #1f3a14 0%, #0F0F0F 70%)',
          border: '1px solid #2A4A14',
        }}
      >
        <p className="text-xs text-gray-400 mb-2">홀길동님, 축하해요</p>
        <div className="flex justify-center mb-2">
          {myBrainimal.icon ? (
            <img src={myBrainimal.icon} alt="" className="w-12 h-12 object-contain" />
          ) : (
            <span className="text-4xl">{myBrainimal.emoji}</span>
          )}
        </div>
        <h4 className="text-lg font-bold" style={{ color: '#AAED10' }}>
          {myBrainimal.name}
        </h4>
        <p className="text-[11px] text-gray-500 mt-1">
          현재 LV.{user?.streak ?? 1} 동급생 중 1등 / 1명 중
        </p>
      </div>

      {/* 뇌지컬 종합 평가 헤더 */}
      <h3 className="text-base font-bold text-white">뇌지컬 종합 평가</h3>

      {/* 상세 분석 */}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 mb-2">📊 상세 분석</h4>
        <div className="space-y-2">
          <EvalRow icon="📈" title="쉽게 휘둘리지 않는 무뚝뚝" body={report.factText} />
          <EvalRow icon="💎" title="화려한 일렉보다는 잔잔한 신뢰감" body={report.lifeText} />
          <EvalRow icon="🪨" title="판단 시간만 잡은 명품 보고하면 학생 회무로" body={report.strengthText} />
        </div>
      </div>

      {/* 강점 분석 */}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 mb-2">💪 강점 분석</h4>
        <div className="grid grid-cols-3 gap-2">
          <MiniGauge label="감정 안정성" value={88} />
          <MiniGauge label="집중력 유지" value={75} />
          <MiniGauge label="적응력 회복" value={45} />
        </div>
      </div>

      {/* 약점 분석 */}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 mb-2">🎯 약점 분석</h4>
        <div className="rounded-xl p-3" style={{ backgroundColor: '#0F0F0F' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-white">반응 시간 변동성</span>
            <span className="text-sm font-bold text-white">35점</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#2A2A2A' }}>
            <div className="h-full rounded-full" style={{ width: '35%', backgroundColor: '#fb923c' }} />
          </div>
          <div className="flex items-center justify-between mt-3 mb-1">
            <span className="text-sm text-white">긍정성</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: '#2A2A2A' }}>
            <div className="h-full rounded-full" style={{ width: '50%', backgroundColor: '#fb923c' }} />
          </div>
        </div>
      </div>

      {/* 생활 밀착 피드백 */}
      <div>
        <h4 className="text-xs font-semibold text-gray-400 mb-2">💡 생활 밀착 피드백</h4>
        <div className="space-y-2">
          <FeedbackStep n={1} title="5시간마다 스트레칭하기" />
          <FeedbackStep n={2} title="새로운 선택 도전하기" />
          <FeedbackStep n={3} title="주변에 도움 요청하기" />
        </div>
      </div>

      {/* 본인 점수 표시 */}
      <div
        className="rounded-xl p-3 text-center"
        style={{ backgroundColor: '#0F0F0F' }}
      >
        <p className="text-xs text-gray-400">내 뇌지컬 나이</p>
        <p className="text-2xl font-bold mt-1" style={{ color: '#AAED10' }}>
          {myScore}{typeof myScore === 'number' ? '세' : ''}
        </p>
      </div>
    </section>
  );
}

// =============================================================================
// 소속 인원 현황 탭
// =============================================================================
function MembersTabSection({ members }: { members: User[] }) {
  return (
    <section
      className="rounded-2xl border overflow-hidden"
      style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
    >
      <div className="p-4 pb-2">
        <h3 className="text-base font-bold text-white mb-1">소속 인원 현황</h3>
        <p className="text-xs text-gray-400">총 {members.length}명</p>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-gray-400 p-4 text-center">소속 인원 데이터가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: '#0F0F0F', color: '#888' }}>
                <th className="text-left py-2 px-3 font-medium">이름</th>
                <th className="text-right py-2 px-3 font-medium">뇌지컬 점수</th>
                <th className="text-left py-2 px-3 font-medium">브레이니멀</th>
                <th className="text-left py-2 px-3 font-medium">생년</th>
                <th className="text-left py-2 px-3 font-medium">최근 검사일</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const info = m.brainimalType ? getBrainimalIcon(m.brainimalType) : null;
                const birthYear = m.age != null ? new Date().getFullYear() - m.age : null;
                const lastTest = m.lastTrainingDate
                  ? formatShortDate(m.lastTrainingDate)
                  : '-';
                return (
                  <tr
                    key={m.id}
                    className="border-t"
                    style={{ borderColor: '#2A2A2A' }}
                  >
                    <td className="py-2 px-3 text-white font-medium">{m.name}</td>
                    <td className="py-2 px-3 text-right">
                      {m.brainAge != null ? (
                        <span className="text-white font-semibold">{m.brainAge}점</span>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {info ? (
                        <span className="text-gray-300">{info.name}</span>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-gray-300">
                      {birthYear ? `${birthYear}` : '-'}
                    </td>
                    <td className="py-2 px-3 text-gray-300">{lastTest}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-3 text-[10px] text-gray-500">
        ※ 정확한 생년월일은 회원 프로필 입력 후 표시됩니다 (현재는 만 나이 기반 추정).
      </p>
    </section>
  );
}

// =============================================================================
// 공용 컴포넌트
// =============================================================================
// 헤더 옆 작은 도움말 점(?) — 폰트 크기와 비슷한 크기로 유지
function HelpDot({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="도움말"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="w-3.5 h-3.5 rounded-full inline-flex items-center justify-center text-[9px] font-bold leading-none"
        style={{ backgroundColor: '#FFFFFF', color: '#000000' }}
      >
        ?
      </button>
      {open && (
        <span
          className="absolute left-5 top-1/2 -translate-y-1/2 z-20 inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[10px]"
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

function CollapsibleCard({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl border"
      style={{ backgroundColor: '#1A1A1A', borderColor: '#2A2A2A' }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4"
      >
        <span className="text-sm font-semibold text-white">{title}</span>
        <span className="text-gray-400 text-xs">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-2">{children}</div>}
    </section>
  );
}

function DonutChart({
  slices,
  size,
}: {
  slices: { type: string; color: string; percent: number; startAngle: number; endAngle: number }[];
  size: number;
}) {
  const STROKE = 22;
  const R = (size - STROKE) / 2;
  const C = size / 2;

  return (
    <svg width={size} height={size} className="-rotate-90">
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

function EvalRow({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div
      className="rounded-xl p-3 flex items-start gap-2"
      style={{ backgroundColor: '#0F0F0F' }}
    >
      <span className="text-base">{icon}</span>
      <div className="flex-1">
        <p className="text-xs font-semibold text-white">{title}</p>
        <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{body}</p>
      </div>
    </div>
  );
}

function MiniGauge({ label, value }: { label: string; value: number }) {
  const SIZE = 70;
  const STROKE = 5;
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
            stroke="#AAED10"
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-white">{value}</span>
        </div>
      </div>
      <span className="text-[10px] text-gray-400 mt-1 text-center">{label}</span>
    </div>
  );
}

function FeedbackStep({ n, title }: { n: number; title: string }) {
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{ backgroundColor: '#0F0F0F' }}
    >
      <span
        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{ backgroundColor: '#264213', color: '#AAED10' }}
      >
        0{n}
      </span>
      <span className="text-sm text-white">{title}</span>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}
