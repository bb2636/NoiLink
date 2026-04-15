import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import Button from '../components/Button';
import RadarChart from '../components/RadarChart';
import MultiTrendChart, { type TrendPoint } from '../components/MultiTrendChart/MultiTrendChart';
import { calculateBrainAge, calculateBrainAgeChange } from '../utils/brainAge';
import { getBrainimalIcon, DEFAULT_BRAINIMAL } from '../utils/brainimalIcons';
import type { Report, MetricsScore, Session } from '@noilink/shared';

/**
 * 개인 리포트 — 명세: 프로필 요약, 6대 지표(꼭짓점 툴팁), 변화추이, 종합 평가, 롤모델, 면책
 */
export default function Report() {
  const { reportId } = useParams<{ reportId?: string }>();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [radarTip, setRadarTip] = useState<string | null>(null);

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

  if (!report || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-4 max-w-md mx-auto">
        <p className="text-gray-400 mb-3 text-center text-sm leading-relaxed">
          리포트가 없거나 조건이 부족합니다. 종합 트레이닝 유효 세션 3회와 각 세션의 지표(메트릭) 계산이 쌓이면
          자동 생성됩니다.
        </p>
        <Button onClick={() => navigate('/training')}>트레이닝 하러 가기</Button>
        <div className="mt-3">
          <Button onClick={() => navigate('/')}>홈</Button>
        </div>
      </div>
    );
  }

  const brainimalInfo = report.brainimalType
    ? getBrainimalIcon(report.brainimalType)
    : DEFAULT_BRAINIMAL;

  const displayBrainAge =
    user.brainAge ?? calculateBrainAge(report.metricsScore, user.age);
  const brainAgeChange = calculateBrainAgeChange(
    displayBrainAge,
    user.previousBrainAge
  );

  const strengthText =
    report.strengthText ??
    '최근 세션 기준으로 상대적으로 높은 지표가 강점으로 나타납니다.';
  const weaknessText =
    report.weaknessText ??
    '낮은 지표는 집중 트레이닝으로 단계적으로 끌어올릴 수 있습니다.';
  const evidenceCards =
    report.metricEvidenceCards && report.metricEvidenceCards.length > 0
      ? report.metricEvidenceCards
      : [
          { key: 'summary', label: '종합', body: '세션 데이터가 쌓이면 지표별 근거 카드가 생성됩니다.' },
        ];
  const roleModel =
    report.recommendedRoleModel ?? {
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
      {/* 프로필 요약 */}
      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <div className="flex items-start gap-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold shrink-0"
            style={{
              backgroundColor: '#2A2A2A',
              color: '#AAED10',
            }}
          >
            {user.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-white">{user.name}</h2>
            {user.age != null && (
              <p className="text-sm" style={{ color: '#B6B6B9' }}>
                {user.age}세
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-base font-semibold text-white">
                뇌지컬 나이 {displayBrainAge}세
              </span>
              {brainAgeChange && (
                <span
                  className="text-sm font-medium"
                  style={{ color: brainAgeChange.isImproved ? '#AAED10' : '#f87171' }}
                >
                  {brainAgeChange.isImproved ? '↓' : '↑'} {brainAgeChange.value}세 (지난 검사 대비)
                </span>
              )}
            </div>
            <p className="text-sm mt-1" style={{ color: '#B6B6B9' }}>
              브레이니멀:{' '}
              <span style={{ color: '#AAED10' }}>{brainimalInfo.name}</span>
            </p>
            {orgLabel && (
              <p className="text-sm mt-1" style={{ color: '#B6B6B9' }}>
                소속 기관: <span className="text-white">{orgLabel}</span>
              </p>
            )}
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
                  title: 'NoiLink 리포트',
                  text: `${user.name}님의 뇌지컬 리포트`,
                });
              }
            }}
          >
            공유하기
          </button>
        </div>
      </section>

      {/* 6대 지표 */}
      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <h3 className="text-lg font-bold mb-3 text-white">6대 지표</h3>
        <p className="text-xs mb-3" style={{ color: '#888' }}>
          그래프 끝(꼭짓점)을 누르면 해당 지표 점수가 표시됩니다.
        </p>
        <div className="flex justify-center">
          <RadarChart
            data={report.metricsScore}
            size={280}
            onPointClick={(label, value) => {
              setRadarTip(`${label} ${Math.round(value)}점`);
            }}
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

      {/* 변화추이 */}
      <section
        className="rounded-2xl p-4 border"
        style={{ backgroundColor: '#1A1A1A', borderColor: '#333' }}
      >
        <h3 className="text-lg font-bold mb-2 text-white">변화추이</h3>
        <p className="text-xs mb-3" style={{ color: '#888' }}>
          최근 10회차 종합 세션 기준 · 범례를 눌러 지표별 표시를 끄고 켤 수 있습니다.
        </p>
        {trendPoints.length > 0 ? (
          <MultiTrendChart data={trendPoints} height={220} />
        ) : (
          <p className="text-sm" style={{ color: '#888' }}>
            아직 표시할 추이 데이터가 없습니다.
          </p>
        )}
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
            {report.hintText}
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
