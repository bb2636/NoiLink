import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import api from "../utils/api";
import RadarChart from "../components/RadarChart";
import MultiTrendChart, {
  type TrendPoint,
} from "../components/MultiTrendChart/MultiTrendChart";
import { calculateBrainAge } from "../utils/brainAge";
import { getBrainimalIcon, DEFAULT_BRAINIMAL } from "../utils/brainimalIcons";
import { DEMO_PROFILE, DEMO_METRICS } from "../utils/demoProfile";
import {
  getMockMember,
  buildMockMemberReport,
  buildMockMemberTrend,
} from "../utils/mockMembers";
import ComprehensiveEvaluation from "../components/ComprehensiveEvaluation";
import RoleModelCard from "../components/RoleModelCard";
import { MobileLayout } from "../components/Layout";
import type { Report, MetricsScore, Session } from "@noilink/shared";

// TODO: 실제 API 데이터로 교체 — 홈/랭킹과 동일한 단일 데모 프로필 사용
const MOCK_PERSONAL_REPORT: Report = {
  id: "mock-report-001",
  userId: "mock-user",
  reportVersion: 12,
  brainimalType: DEMO_PROFILE.brainimalType,
  confidence: DEMO_PROFILE.confidence,
  metricsScore: {
    sessionId: "mock-session",
    userId: "mock-user",
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
    "최근 12회의 종합 트레이닝 결과, 평균 종합 점수는 80.3점으로 동연령대 상위 22% 수준입니다. 특히 순발력과 집중력에서 안정적으로 높은 수치를 유지하고 있습니다.",
  lifeText:
    "단기 변동에 일희일비하지 않는 우직함이 버핏을 만들었습니다. 당신의 꾸준함도 곧 거대한 성과가 될 거예요.",
  hintText:
    "아침 5분의 가벼운 인지 워밍업과 충분한 수분 섭취가 오후 집중력 유지에 효과적입니다. 주 3회 이상 종합 트레이닝을 권장드립니다.",
  strengthText:
    "순발력(91점)과 집중력(88점)이 또래 평균보다 12점 이상 높습니다. 빠른 의사결정이 필요한 상황에서 강점을 발휘합니다.",
  weaknessText:
    "지구력(69점)이 상대적으로 낮습니다. 짧고 강한 트레이닝보다 중간 강도의 긴 세션을 통해 점진적으로 끌어올리는 것을 추천드립니다.",
  metricEvidenceCards: [
    {
      key: "memory",
      label: "기억력",
      body: "최근 5세션 평균 78점 — 숫자 회상 과제에서 안정적 수행을 보였습니다.",
    },
    {
      key: "focus",
      label: "집중력",
      body: "주의 유지 과제 정답률 92% — 상위 15% 수준입니다.",
    },
    {
      key: "agility",
      label: "순발력",
      body: "평균 반응속도 412ms로 동연령대 대비 18% 빠릅니다.",
    },
    {
      key: "endurance",
      label: "지구력",
      body: "5분 이상 세션에서 후반부 정확도 하락 폭이 평균보다 큽니다.",
    },
  ],
  recommendedRoleModel: {
    name: "워런 버핏",
    oneLiner: "원칙이 있으면 흔들리지 않는다!",
    description: "흔들리지 않는 원칙, 복리의 마법으로 돌아옵니다.",
  },
  recommendedBPM: DEMO_PROFILE.bpmAvg,
  createdAt: new Date().toISOString(),
};

// TODO: 실제 API 데이터로 교체 — 데모용 변화 추이 (최근 10회)
const MOCK_TREND_POINTS: TrendPoint[] = Array.from({ length: 10 }).map(
  (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (9 - i) * 3);
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
  },
);

/**
 * 개인 리포트 — 명세: 프로필 요약, 6대 지표(꼭짓점 툴팁), 변화추이, 종합 평가, 롤모델, 면책
 */
// 제목 + "?" + 안내 말풍선(타이틀 줄 아래에 좌측 정렬로 표시) — 첨부 이미지와 동일
function HelpTooltip({
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
          style={{
            backgroundColor: "#FFFFFF",
            color: "#000000",
            width: 14,
            height: 14,
            minWidth: 14,
            minHeight: 14,
            padding: 0,
            fontSize: 9,
            lineHeight: "14px",
          }}
        >
          ?
        </button>
      </div>
      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-20 inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-0.5 text-[11px] leading-none"
          style={{ backgroundColor: "#2A2A2A", color: "#E5E5E5" }}
        >
          <span>{text}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            aria-label="닫기"
            className="text-[11px] leading-none"
            style={{ color: "#888" }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// 사용자/리포트 단위 모듈 캐시 — 탭 재진입 시 즉시 이전 데이터 노출
const reportCache = new Map<
  string,
  { report: Report | null; trendPoints: TrendPoint[] }
>();
const reportInFlight = new Map<string, boolean>();

export default function Report() {
  const { reportId } = useParams<{ reportId?: string }>();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const cacheKey = user ? `${user.id}:${reportId ?? "latest"}` : "";
  const cached = cacheKey ? reportCache.get(cacheKey) : undefined;
  const [report, setReport] = useState<Report | null>(cached?.report ?? null);
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>(
    cached?.trendPoints ?? [],
  );
  const [loading, setLoading] = useState<boolean>(!!cacheKey && !cached);

  // 캐시 키 변경 시 새 키의 캐시로 즉시 상태 재수화
  const lastKeyRef = useRef<string>(cacheKey);
  if (lastKeyRef.current !== cacheKey) {
    lastKeyRef.current = cacheKey;
    const c = cacheKey ? reportCache.get(cacheKey) : undefined;
    setReport(c?.report ?? null);
    setTrendPoints(c?.trendPoints ?? []);
    setLoading(!!cacheKey && !c);
  }

  useEffect(() => {
    loadReport();
  }, [reportId, user?.id]);

  const loadReport = async () => {
    if (!user) return;
    const key = `${user.id}:${reportId ?? "latest"}`;
    if (reportInFlight.get(key)) return;
    reportInFlight.set(key, true);

    const hasCache = !!reportCache.get(key);
    try {
      if (!hasCache) setLoading(true);

      // 소속 인원 현황에서 클릭한 더미 회원이면 합성 데이터 사용 (API 호출 안 함)
      const mockMember = getMockMember(reportId);
      if (mockMember) {
        const synth = buildMockMemberReport(mockMember);
        const synthTrend = buildMockMemberTrend(mockMember);
        setReport(synth);
        setTrendPoints(synthTrend);
        reportCache.set(key, { report: synth, trendPoints: synthTrend });
        return;
      }

      let nextReport: Report | null = null;
      if (reportId) {
        const reportRes = await api.get<Report>(`/reports/${reportId}`);
        if (reportRes.success && reportRes.data) {
          nextReport = reportRes.data;
          setReport(nextReport);
        }
      } else {
        const reportsRes = await api.getUserReports(user.id, 1);
        if (
          reportsRes.success &&
          reportsRes.data &&
          reportsRes.data.length > 0
        ) {
          nextReport = reportsRes.data[0];
          setReport(nextReport);
        } else {
          const generateRes = await api.generateReport(user.id);
          if (generateRes.success && generateRes.data) {
            nextReport = generateRes.data;
            setReport(nextReport);
          }
        }
      }

      // 변화 추이는 종합/단일 트레이닝 모두 포함하여 최근 10회를 사용
      // (isComposite 필터를 걸면 단일 지표 트레이닝 기록이 빠져 추이가 비어보임)
      const sessionsRes = await api.getUserSessions(user.id, {
        limit: 10,
      });

      if (sessionsRes.success && sessionsRes.data) {
        const sessions = [...sessionsRes.data].sort(
          (a: Session, b: Session) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        type SessionMetricsPayload = {
          raw: unknown;
          score: MetricsScore | null;
        };
        const metricsResults = await Promise.all(
          sessions.map((s: Session) =>
            api.get<SessionMetricsPayload>(`/metrics/session/${s.id}`),
          ),
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
        const prev = reportCache.get(key);
        reportCache.set(key, {
          report: nextReport ?? prev?.report ?? null,
          trendPoints: points.length > 0 ? points : (prev?.trendPoints ?? []),
        });
      } else {
        const prev = reportCache.get(key);
        reportCache.set(key, {
          report: nextReport ?? prev?.report ?? null,
          trendPoints: prev?.trendPoints ?? [],
        });
      }

      await refreshUser();
    } catch (error) {
      console.error("Failed to load report:", error);
    } finally {
      reportInFlight.set(key, false);
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center justify-center min-h-[50vh]"
        style={{ color: "#999" }}
      >
        로딩 중...
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="max-w-md mx-auto px-4"
        style={{
          backgroundColor: "#0A0A0A",
          minHeight: "70vh",
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        {/* 헤더 */}
        <div className="flex items-center pt-4 pb-2">
          <svg
            className="w-4 h-4 mr-1.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            style={{ color: "#FFFFFF" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 17v-2a4 4 0 014-4h6m-6-4h6M5 7h2m-2 4h2m-2 4h2"
            />
          </svg>
          <h1 className="text-[15px] font-semibold text-white">리포트</h1>
        </div>

        {/* 빈 상태 카드 */}
        <div
          className="rounded-2xl p-5 mt-4"
          style={{ backgroundColor: "#1A1A1A", border: "1px solid #262626" }}
        >
          <div className="flex flex-col items-center text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: "#262626" }}
            >
              <svg
                className="w-7 h-7"
                fill="none"
                stroke="#AAED10"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 17v-6h13M9 11V5h13M3 6h.01M3 12h.01M3 18h.01"
                />
              </svg>
            </div>
            <h3 className="text-white font-semibold text-base mb-2">
              아직 리포트가 없어요
            </h3>
            <p
              className="text-[13px] leading-relaxed mb-5"
              style={{ color: "#9CA3AF" }}
            >
              종합 트레이닝 유효 세션{" "}
              <span style={{ color: "#AAED10" }}>3회</span>와<br />
              각 세션의 지표(메트릭) 계산이 쌓이면
              <br />
              리포트가 자동으로 생성됩니다.
            </p>

            <button
              type="button"
              onClick={() => navigate("/training")}
              className="w-full py-3 rounded-xl font-semibold text-[15px] mb-2"
              style={{ backgroundColor: "#AAED10", color: "#0A0A0A" }}
            >
              트레이닝 하러 가기
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="w-full py-3 rounded-xl font-medium text-[14px]"
              style={{
                backgroundColor: "transparent",
                color: "#E5E7EB",
                border: "1px solid #2f2f2f",
              }}
            >
              홈으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 소속 인원 현황에서 진입한 경우 → 해당 멤버 정보로 프로필 표기 오버라이드
  const viewingMember = getMockMember(reportId);

  // TODO: 실제 리포트 생성 시 목업 제거 — 데모 환경에서 빈 화면 방지
  const effectiveReport: Report = report ?? {
    ...MOCK_PERSONAL_REPORT,
    userId: user.id,
  };
  // 세션은 있지만 모든 포인트의 6대 지표가 비어있는 경우(점수 미산출)에는
  // 빈 그래프 대신 MOCK 데이터로 폴백한다.
  const hasAnyMetric = trendPoints.some(
    (p) =>
      typeof p.memory === 'number' ||
      typeof p.comprehension === 'number' ||
      typeof p.focus === 'number' ||
      typeof p.judgment === 'number' ||
      typeof p.agility === 'number' ||
      typeof p.endurance === 'number',
  );
  const effectiveTrendPoints: TrendPoint[] =
    hasAnyMetric ? trendPoints : MOCK_TREND_POINTS;

  // 표시용 사용자 정보 — 멤버 보기일 땐 멤버 데이터 사용
  const displayUser = {
    name: viewingMember?.name ?? user.name,
    age: viewingMember?.age ?? user.age,
    brainAge: viewingMember?.brainAge ?? user.brainAge,
    previousBrainAge: viewingMember ? undefined : user.previousBrainAge,
    organizationName: viewingMember
      ? (user.organizationName ?? "소속 기관")
      : user.organizationName,
    organizationId: viewingMember ? user.organizationId : user.organizationId,
  };

  const brainimalInfo = effectiveReport.brainimalType
    ? getBrainimalIcon(effectiveReport.brainimalType)
    : DEFAULT_BRAINIMAL;

  const displayBrainAge =
    displayUser.brainAge ??
    calculateBrainAge(effectiveReport.metricsScore, displayUser.age);
  // 내 프로필 카드용: 실제 나이 대비 뇌지컬 나이 차이
  // diff = 뇌지컬 나이 - 실제 나이
  // diff <= 0 (뇌지컬이 어리거나 같음) → 파란색
  // diff > 0  (뇌지컬이 더 많음)         → 빨간색
  const brainAgeVsActualDiff =
    typeof displayUser.age === "number" && typeof displayBrainAge === "number"
      ? displayBrainAge - displayUser.age
      : null;

  const evidenceCards =
    effectiveReport.metricEvidenceCards &&
    effectiveReport.metricEvidenceCards.length > 0
      ? effectiveReport.metricEvidenceCards
      : [
          {
            key: "summary",
            label: "종합",
            body: "세션 데이터가 쌓이면 지표별 근거 카드가 생성됩니다.",
          },
        ];
  // 롤모델은 추후 동물 타입별로 추가 예정 — 현재는 워런 버핏 하드코딩
  // (effectiveReport.recommendedRoleModel은 일단 사용 안 함)

  const orgLabel =
    displayUser.organizationName ||
    (displayUser.organizationId ? "소속 기관" : null);

  const handleShare = async () => {
    const shareData = {
      title: "NoiLink 개인 리포트",
      text: `${displayUser.name || "내"} 뇌지컬 리포트`,
      url: window.location.href,
    };
    try {
      if (typeof navigator !== "undefined" && (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share) {
        await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share(shareData);
        return;
      }
    } catch {
      // 사용자가 공유 시트를 닫은 경우 — 무시
      return;
    }
    try {
      await navigator.clipboard.writeText(shareData.url);
      alert("링크가 복사됐어요");
    } catch {
      alert(shareData.url);
    }
  };

  return (
    <MobileLayout hideBottomNav>
    <div style={{ color: "#fff" }}>
      {/* 상단 고정 헤더 — 휴대폰 상태바(safe-area) 분리 + 본문과 구분되는 보더 */}
      <header
        className="sticky top-0 z-30"
        style={{
          backgroundColor: "#0A0A0A",
          paddingTop: "env(safe-area-inset-top)",
          borderBottom: "1px solid #1A1A1A",
        }}
      >
        <div className="px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
              style={{ color: "#AAED10" }}
              aria-hidden
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M9 18v-3" />
              <path d="M12 18v-6" />
              <path d="M15 18v-2" />
            </svg>
            <span className="text-[15px] font-semibold text-white">
              개인 리포트
            </span>
          </div>
          <button
            type="button"
            onClick={handleShare}
            className="p-2 -mr-2 rounded-full"
            aria-label="리포트 공유"
            style={{ color: "#fff" }}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
          </button>
        </div>
      </header>

      <div
        className="px-4 pb-6 space-y-5"
        style={{
          paddingTop: "1rem",
          paddingBottom: "120px",
        }}
      >
      {/* 내 프로필 */}
      <section>
        <h3 className="text-base font-bold text-white mb-2">내 프로필</h3>
        <div
          className="rounded-2xl p-4 border"
          style={{ backgroundColor: "#1A1A1A", borderColor: "#2A2A2A" }}
        >
          {/* 상단: 아바타 + 이름/소속 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-full overflow-hidden flex items-center justify-center"
                style={{ backgroundColor: "#2A2A2A" }}
              >
                {brainimalInfo.icon ? (
                  <img
                    src={brainimalInfo.icon}
                    alt={brainimalInfo.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span
                    className="text-xl font-bold"
                    style={{ color: "#AAED10" }}
                  >
                    {displayUser.name.charAt(0)}
                  </span>
                )}
              </div>
              <span className="text-white font-semibold text-[15px]">
                {displayUser.name} 님
              </span>
            </div>
            {orgLabel && (
              <span className="text-xs" style={{ color: "#B6B6B9" }}>
                소속 <span className="text-white ml-1">{orgLabel}</span>
              </span>
            )}
          </div>

          {/* 나이 / 뇌지컬 나이 한 줄 */}
          <div
            className="flex items-center justify-between rounded-xl px-4 py-3 mb-3"
            style={{ backgroundColor: "#0F0F0F" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-xs" style={{ color: "#888" }}>
                나이
              </span>
              <span className="text-white font-semibold text-sm">
                {displayUser.age != null ? `${displayUser.age}세` : "-"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: "#888" }}>
                뇌지컬 나이
              </span>
              <span className="text-white font-semibold text-sm">
                {displayBrainAge}세
              </span>
              {brainAgeVsActualDiff !== null && (
                <span
                  className="text-xs font-medium"
                  style={{
                    color: brainAgeVsActualDiff <= 0 ? "#60A5FA" : "#f87171",
                  }}
                >
                  ({brainAgeVsActualDiff > 0 ? "+" : ""}
                  {brainAgeVsActualDiff})
                </span>
              )}
            </div>
          </div>

          {/* 브레이니멀 라벨 + 모든 타입 보기 */}
          <div className="flex items-center justify-between">
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ backgroundColor: "#2A2A2A", color: brainimalInfo.color }}
            >
              {brainimalInfo.icon && (
                <img
                  src={brainimalInfo.icon}
                  alt=""
                  className="w-4 h-4 rounded-full object-cover"
                />
              )}
              {brainimalInfo.name}
            </span>
            <button
              type="button"
              onClick={() => navigate("/profile")}
              className="text-xs font-medium"
              style={{ color: "#B6B6B9" }}
            >
              모든 타입 보기 &gt;
            </button>
          </div>
        </div>
      </section>

      {/* 6대 지표 그래프 — 카드 테두리 제거 */}
      <section>
        <h3 className="text-base font-bold text-white mb-2">6대 지표 그래프</h3>
        <p className="text-sm font-semibold text-white mb-3">
          핵심 두뇌 능력 결과
        </p>
        <div className="flex justify-center">
          <RadarChart data={effectiveReport.metricsScore} size={280} />
        </div>
        <p className="text-[11px] mt-3" style={{ color: "#666" }}>
          그래프 끝(꼭짓점)을 누르면 해당 항목의 점수가 표시됩니다.
        </p>
      </section>

      {/* 변화추이 — 카드 테두리 제거. 타이틀과 "전체" 드롭다운을 한 줄로 */}
      <section>
        <MultiTrendChart
          data={effectiveTrendPoints}
          height={220}
          headerLeft={
            <HelpTooltip
              text={`최근 ${orgLabel ? `‘${orgLabel}’` : "세션"}을 기준으로 표시된 변화추이 입니다`}
            >
              <h3 className="text-lg font-bold text-white">변화 추이</h3>
            </HelpTooltip>
          }
        />
      </section>

      {/* 브레이니멀 결과 히어로 카드 */}
      <section>
        <div
          className="rounded-2xl p-5 flex flex-col items-center text-center"
          style={{
            background:
              "radial-gradient(120% 100% at 50% 0%, rgba(170,237,16,0.22) 0%, rgba(170,237,16,0.06) 45%, #1A1A1A 80%)",
            border: "1px solid #2A3A12",
          }}
        >
          <p className="text-xs mb-4" style={{ color: "#B6B6B9" }}>
            {displayUser.name}님, 축하드려요.
          </p>
          <div
            className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center mb-4"
            style={{ backgroundColor: "#0F0F0F", border: "1px solid #2A2A2A" }}
          >
            {brainimalInfo.icon ? (
              <img
                src={brainimalInfo.icon}
                alt={brainimalInfo.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-3xl">{brainimalInfo.emoji}</span>
            )}
          </div>
          <p className="text-2xl font-bold mb-3" style={{ color: "#AAED10" }}>
            {brainimalInfo.name}
          </p>
          {brainAgeVsActualDiff !== null && (
            <>
              <p className="text-xs" style={{ color: "#B6B6B9" }}>
                {brainAgeVsActualDiff === 0
                  ? "두뇌 나이 평균과"
                  : "두뇌 나이 평균보다"}
              </p>
              <p className="text-base font-bold text-white mt-0.5">
                {brainAgeVsActualDiff < 0
                  ? `${Math.abs(brainAgeVsActualDiff)}살 더 젊어요!`
                  : brainAgeVsActualDiff > 0
                    ? `${brainAgeVsActualDiff}살 더 많아요`
                    : "같아요"}
              </p>
            </>
          )}
        </div>
      </section>

      {/* 뇌지컬 종합 평가 — 약점 분석은 개인 리포트 전용 상세 카드로 표시 */}
      <ComprehensiveEvaluation
        metricsScore={effectiveReport.metricsScore}
        evidenceDetails={evidenceCards.slice(0, 3).map((c) => ({
          title: c.label,
          description: c.body,
        }))}
        weaknessDetails={[
          {
            icon: "🌀",
            iconBg: "#1E2B4E",
            title: "변화 감지 민감도",
            description: "급격한 환경 변화에 적응 속도가 느린 편이에요.",
          },
          {
            icon: "🤝",
            iconBg: "#3D2E1A",
            title: "공동성",
            description:
              "혼자 집중할 때 최고 성과를 내지만, 그룹 활동에서는 에너지가 분산되는 경향이 있어요.",
          },
        ]}
      />

      {/* 추천 롤모델 — 추후 동물별 롤모델 추가 예정. 현재는 워런 버핏 하드코딩. */}
      <RoleModelCard
        subtitle={`${displayUser.name ?? "회원"}님의 롤모델`}
        name="워런 버핏"
        quote="원칙이 있으면 흔들리지 않는다!"
        traits={["꾸준함", "장기 사고", "원칙 고수"]}
        connectionHeadline="흔들리지 않는 원칙, 복리의 마법으로 돌아옵니다."
        connectionDetail="단기 변동에 일희일비하지 않는 우직함이 버핏을 만들었습니다. 당신의 꾸준함도 곧 거대한 성과가 될 거예요."
      />

      {/* 의료 면책 조항 */}
      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: "#1A1A1A", borderColor: "#2A2A2A" }}
      >
        <p className="text-[13px] font-bold text-white mb-2">
          의료 면책 조항 (Disclaimer)
        </p>
        <p className="text-[12px] leading-relaxed" style={{ color: "#888" }}>
          본 리포트는 웰니스 및 건강 관리를 위한 참고 자료이며, 전문적인 의료적
          진단이나 치료를 대신할 수 없습니다. 측정 결과는 환경에 따라 달라질 수
          있으며, 의학적 소견이 필요한 경우 반드시 전문의와 상담하시기 바랍니다.
          (주)노이랩은 본 리포트의 해석 및 활용 결과에 대해 법적인 책임을 지지
          않습니다.
        </p>
      </section>
      </div>
    </div>
    </MobileLayout>
  );
}
