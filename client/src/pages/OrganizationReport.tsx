import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import Button from '../components/Button';
import RadarChart from '../components/RadarChart';
import MultiTrendChart, { type TrendPoint } from '../components/MultiTrendChart/MultiTrendChart';
import { getBrainimalIcon } from '../utils/brainimalIcons';
import type { OrganizationInsightReport } from '@noilink/shared';

/**
 * 기관 리포트 — 팀 요약, 6대 지표(평균), 추이, 브레이니멀 분포, 종합 평가, 소속 현황
 */
export default function OrganizationReport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [report, setReport] = useState<OrganizationInsightReport | null>(null);
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [radarTip, setRadarTip] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.organizationId) return;
    loadOrgReport();
  }, [user?.organizationId]);

  const loadOrgReport = async () => {
    if (!user?.organizationId) return;
    try {
      setLoading(true);
      const res = await api.getOrganizationInsightReport(user.organizationId);
      if (res.success && res.data) {
        setReport(res.data);
      } else {
        const gen = await api.generateOrganizationInsightReport(user.organizationId);
        if (gen.success && gen.data) {
          setReport(gen.data);
        }
      }

      const sessionsRes = await api.getOrganizationSessionsForTrend(user.organizationId);
      if (sessionsRes.success && sessionsRes.data) {
        setTrendPoints(sessionsRes.data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return null;
  }

  if (!user.organizationId) {
    return (
      <div className="px-4 py-10 text-center" style={{ color: '#999' }}>
        기관 소속 계정에서만 이용할 수 있습니다.
        <div className="mt-4">
          <Button onClick={() => navigate('/profile')}>프로필로</Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]" style={{ color: '#999' }}>
        로딩 중...
      </div>
    );
  }

  if (!report) {
    return (
      <div className="px-4 py-10 text-center space-y-4">
        <p style={{ color: '#999' }}>
          기관 리포트를 만들 데이터가 부족합니다. 소속 인원의 종합 트레이닝·지표가 쌓이면 자동으로 생성됩니다.
        </p>
        <Button
          onClick={async () => {
            const gen = await api.generateOrganizationInsightReport(user.organizationId!);
            if (gen.success && gen.data) setReport(gen.data);
          }}
        >
          다시 생성 시도
        </Button>
      </div>
    );
  }

  const repInfo = getBrainimalIcon(report.representativeBrainimal);
  const delta = report.brainAgeVsChronologicalDelta;
  const deltaGood = delta <= 0;

  return (
    <div className="px-4 py-6 space-y-5" style={{ paddingBottom: '120px', color: '#fff' }}>
      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <div className="flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: '#2A2A2A' }}
          >
            {repInfo.icon ? (
              <img src={repInfo.icon} alt="" className="w-10 h-10 object-contain" />
            ) : (
              <span className="text-2xl">{repInfo.emoji}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-white">{report.organizationName}</h2>
            <p className="text-sm mt-1" style={{ color: '#B6B6B9' }}>
              관리 인원 {report.managedMemberCount}명
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-base font-semibold">
                평균 뇌지컬 나이 {report.avgBrainAge}세
              </span>
              <span className="text-sm" style={{ color: '#888' }}>
                (실제 평균 {report.cohortActualAvgAge}세 대비{' '}
                <span style={{ color: deltaGood ? '#AAED10' : '#f87171' }}>
                  {delta > 0 ? '+' : ''}
                  {delta}세)
                </span>
              </span>
            </div>
            <p className="text-sm mt-1" style={{ color: '#B6B6B9' }}>
              대표 브레이니멀:{' '}
              <span style={{ color: '#AAED10' }}>{report.representativeBrainimalLabel}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
            style={{ borderColor: '#444', color: '#fff' }}
          >
            모든 타입 보기
          </button>
          <button
            type="button"
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
            style={{ backgroundColor: '#AAED10', color: '#000' }}
            onClick={() => {
              if (navigator.share) {
                void navigator.share({
                  title: 'NoiLink 기관 리포트',
                  text: `${report.organizationName} 팀 리포트`,
                });
              }
            }}
          >
            공유하기
          </button>
        </div>
      </section>

      {report.orgReport && (
        <section
          className="rounded-2xl p-4 border space-y-4"
          style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
        >
          <h3 className="text-lg font-bold text-white">기관 대시보드 (ORG_REPORT_001)</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Kpi label="활성 인원(7일)" value={`${report.orgReport.activeMembers}명`} />
            <Kpi
              label="참여율(7일)"
              value={`${Math.round(report.orgReport.participationRate * 100)}%`}
            />
            <Kpi
              label="종합 수행률(14일)"
              value={`${Math.round(report.orgReport.compositeCompletionRate * 100)}%`}
            />
            <Kpi label="팀 평균 점수" value={`${report.orgReport.teamAvgScore}점`} />
            <Kpi label="팀 평균 신뢰도" value={`${report.orgReport.teamAvgConfidence}`} />
            <Kpi label="위험 인원" value={`${report.orgReport.riskMemberCount}명`} />
          </div>
          <div
            className="flex items-center gap-3 rounded-xl px-3 py-2"
            style={{ backgroundColor: '#0A0A0A' }}
          >
            <span className="text-xs font-semibold" style={{ color: '#888' }}>
              팀 추세
            </span>
            <span
              className="text-sm font-bold px-2 py-0.5 rounded"
              style={{
                backgroundColor:
                  report.orgReport.trendStatus === 'UP'
                    ? '#14532d'
                    : report.orgReport.trendStatus === 'DOWN'
                      ? '#450a0a'
                      : '#333',
                color:
                  report.orgReport.trendStatus === 'UP'
                    ? '#86efac'
                    : report.orgReport.trendStatus === 'DOWN'
                      ? '#fca5a5'
                      : '#ccc',
              }}
            >
              {report.orgReport.trendStatus} ({report.orgReport.trendScore >= 0 ? '+' : ''}
              {report.orgReport.trendScore})
            </span>
            <span className="text-xs" style={{ color: '#888' }}>
              UP ≥ +3 · DOWN ≤ −3
            </span>
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-1" style={{ color: '#AAED10' }}>
              코치 액션
            </h4>
            <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
              {report.orgReport.coachAction}
            </p>
          </div>
        </section>
      )}

      {report.riskMembers && report.riskMembers.length > 0 && (
        <section
          className="rounded-2xl p-4 border space-y-3"
          style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
        >
          <h3 className="text-lg font-bold text-white">리스크 멤버</h3>
          <ul className="space-y-2">
            {report.riskMembers.map((r) => (
              <li
                key={`${r.userId}-${r.detectedAt}`}
                className="rounded-xl p-3 text-sm"
                style={{
                  backgroundColor: '#0A0A0A',
                  borderLeft: `4px solid ${r.riskLevel === 'WARN' ? '#f87171' : '#fbbf24'}`,
                }}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-white">{r.userId}</span>
                  <span style={{ color: r.riskLevel === 'WARN' ? '#f87171' : '#fbbf24' }}>
                    {r.riskLevel}
                  </span>
                </div>
                <ul className="mt-1 list-disc list-inside" style={{ color: '#B6B6B9' }}>
                  {r.reasons.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <h3 className="text-lg font-bold mb-2 text-white">6대 지표 (팀 평균)</h3>
        <p className="text-xs mb-3" style={{ color: '#888' }}>
          꼭짓점을 누르면 평균 점수를 확인할 수 있습니다.
        </p>
        <div className="flex justify-center">
          <RadarChart
            data={report.avgMetricsScore}
            size={280}
            onPointClick={(label, value) => setRadarTip(`${label} 평균 ${Math.round(value)}점`)}
          />
        </div>
        {radarTip && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 text-center text-sm font-semibold py-2 rounded-xl"
            style={{ backgroundColor: '#2A2A2A', color: '#AAED10' }}
          >
            {radarTip}
          </motion.div>
        )}
      </section>

      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <h3 className="text-lg font-bold mb-2 text-white">변화추이</h3>
        <p className="text-xs mb-3" style={{ color: '#888' }}>
          기관 소속 세션을 날짜순으로 묶은 추세(데이터가 있을 때 표시)
        </p>
        {trendPoints.length > 0 ? (
          <MultiTrendChart data={trendPoints} height={220} />
        ) : (
          <p className="text-sm" style={{ color: '#888' }}>
            팀 추이를 그릴 만큼의 최근 세션이 아직 없습니다.
          </p>
        )}
      </section>

      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <h3 className="text-lg font-bold mb-3 text-white">브레이니멀 유형 분포</h3>
        <div className="space-y-2">
          {report.brainimalDistribution.map((row) => (
            <div key={row.type} className="flex items-center gap-2 text-sm">
              <span className="w-36 truncate" style={{ color: '#B6B6B9' }}>
                {getBrainimalIcon(row.type).name}
              </span>
              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#333' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, row.percent)}%`, backgroundColor: '#AAED10' }}
                />
              </div>
              <span className="w-12 text-right text-white">{row.percent}%</span>
            </div>
          ))}
        </div>
      </section>

      <section
        className="rounded-2xl p-4 border space-y-5"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <h3 className="text-lg font-bold text-white">뇌지컬 종합 평가</h3>

        <div>
          <h4 className="text-sm font-semibold mb-2" style={{ color: '#AAED10' }}>
            지표별 근거 (팀 평균)
          </h4>
          <div className="grid gap-2">
            {report.metricEvidenceCards.map((c) => (
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
            {report.factText}
          </p>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-white mb-1">상세 분석</h4>
          <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
            {report.lifeText}
          </p>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-white mb-1">강점</h4>
          <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
            {report.strengthText}
          </p>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-white mb-1">보완점</h4>
          <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
            {report.weaknessText}
          </p>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-white mb-1">생활 밀착 피드백</h4>
          <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
            {report.hintText}
          </p>
        </div>
      </section>

      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <h3 className="text-lg font-bold mb-2 text-white">소속 인원 현황</h3>
        <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
          {report.memberStatusSummary}
        </p>
      </section>

      <p className="text-[11px] text-center leading-relaxed px-2" style={{ color: '#666' }}>
        본 검사 결과는 의학적 진단을 대체하지 않으며, 참고용으로만 사용하시기 바랍니다.
      </p>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: '#0A0A0A' }}>
      <div className="text-[11px] mb-1" style={{ color: '#888' }}>
        {label}
      </div>
      <div className="text-base font-bold text-white">{value}</div>
    </div>
  );
}
