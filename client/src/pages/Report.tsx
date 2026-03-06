import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import Card from '../components/Card';
import Button from '../components/Button';
import RadarChart from '../components/RadarChart';
import LineChart from '../components/LineChart';
import { calculateBrainAge, calculateBrainAgeChange } from '../utils/brainAge';
import { getBrainimalIcon, DEFAULT_BRAINIMAL } from '../utils/brainimalIcons';
import type { Report, MetricsScore, Session } from '@noilink/shared';

/**
 * 개인 리포트 페이지
 * 기능 명세서 기반 구현
 */
export default function Report() {
  const { reportId } = useParams<{ reportId?: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<MetricsScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const [visibleMetrics, setVisibleMetrics] = useState<Record<string, boolean>>({
    memory: true,
    comprehension: true,
    focus: true,
    judgment: true,
    agility: true,
    endurance: true,
  });

  useEffect(() => {
    loadReport();
  }, [reportId, user]);

  const loadReport = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // 리포트 조회
      if (reportId) {
        const reportRes = await api.get<Report>(`/reports/${reportId}`);
        if (reportRes.success && reportRes.data) {
          setReport(reportRes.data);
        }
      } else {
        // 최신 리포트 생성 또는 조회
        const reportsRes = await api.getUserReports(user.id, 1);
        if (reportsRes.success && reportsRes.data && reportsRes.data.length > 0) {
          setReport(reportsRes.data[0]);
        } else {
          // 리포트 생성
          const generateRes = await api.generateReport(user.id);
          if (generateRes.success && generateRes.data) {
            setReport(generateRes.data);
          }
        }
      }

      // 히스토리 로드 (최근 10회)
      const sessionsRes = await api.getUserSessions(user.id, {
        limit: 10,
        isComposite: true,
      });

      if (sessionsRes.success && sessionsRes.data) {
        const sessionIds = sessionsRes.data.map((s: Session) => s.id);
        const metricsPromises = sessionIds.map((id: string) =>
          api.get<MetricsScore>(`/metrics/session/${id}`)
        );
        const metricsResults = await Promise.all(metricsPromises);
        const metrics = metricsResults
          .filter((r) => r.success && r.data)
          .map((r) => r.data!)
          .filter(Boolean);
        setHistory(metrics);
      }
    } catch (error) {
      console.error('Failed to load report:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">로딩 중...</div>
      </div>
    );
  }

  if (!report || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">리포트를 불러올 수 없습니다.</p>
          <Button onClick={() => navigate('/')}>홈으로</Button>
        </div>
      </div>
    );
  }

  const brainimalInfo = report.brainimalType
    ? getBrainimalIcon(report.brainimalType)
    : DEFAULT_BRAINIMAL;

  const currentBrainAge = calculateBrainAge(report.metricsScore, user.age);
  const brainAgeChange = calculateBrainAgeChange(
    currentBrainAge,
    user.previousBrainAge
  );

  // 히스토리 데이터 변환
  const historyData = history.map((score, index) => ({
    date: new Date(Date.now() - (history.length - index - 1) * 86400000).toISOString(),
    value: score.memory || 0,
  }));

  const metricLabels: Record<string, string> = {
    memory: '기억력',
    comprehension: '이해력',
    focus: '집중력',
    judgment: '판단력',
    agility: '순발력',
    endurance: '지구력',
  };

  return (
    <div className="min-h-screen p-4 space-y-6">
      {/* 프로필 요약 카드 */}
      <Card>
        <div className="flex items-center gap-4 mb-4">
          <div
            className="w-16 h-16 flex items-center justify-center"
            style={{ color: brainimalInfo.color }}
          >
            {brainimalInfo.icon ? (
              <img 
                src={brainimalInfo.icon} 
                alt={brainimalInfo.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-6xl">{brainimalInfo.emoji}</span>
            )}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold">{user.name}</h2>
            {user.age && <p className="text-gray-600">{user.age}세</p>}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-lg font-semibold">뇌지컬 나이: {currentBrainAge}세</span>
              {brainAgeChange && (
                <span
                  className={`text-sm ${
                    brainAgeChange.isImproved ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {brainAgeChange.isImproved ? '↓' : '↑'} {brainAgeChange.value}세
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">브레이니멀 타입</p>
            <p className="font-semibold">{brainimalInfo.name}</p>
          </div>
          {user.organizationId && (
            <div>
              <p className="text-sm text-gray-600">소속 기관</p>
              <p className="font-semibold">기관명</p>
            </div>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={() => navigate('/profile')}>
            모든 타입 보기
          </Button>
          <Button variant="outline" size="sm">
            공유하기
          </Button>
        </div>
      </Card>

      {/* 6대 지표 그래프 */}
      <Card>
        <h3 className="text-xl font-bold mb-4">6대 지표</h3>
        <div className="flex justify-center mb-4">
          <RadarChart
            data={report.metricsScore}
            size={280}
            onPointHover={(metric, value) => {
              setSelectedMetric(`${metric}: ${Math.round(value)}점`);
              setTimeout(() => setSelectedMetric(null), 2000);
            }}
          />
        </div>
        {selectedMetric && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center text-primary-600 font-medium"
          >
            {selectedMetric}
          </motion.div>
        )}
      </Card>

      {/* 변화추이 */}
      <Card>
        <h3 className="text-xl font-bold mb-4">변화추이</h3>
        <div className="space-y-4">
          {Object.entries(metricLabels).map(([key, label]) => (
            <LineChart
              key={key}
              data={historyData.map((d, i) => {
                const metricValue = history[i]?.[key as keyof MetricsScore];
                return {
                  date: d.date,
                  value: typeof metricValue === 'number' ? metricValue : 0,
                };
              })}
              label={label}
              showToggle
              onToggle={(visible) => {
                setVisibleMetrics({ ...visibleMetrics, [key]: visible });
              }}
            />
          ))}
        </div>
      </Card>

      {/* 뇌지컬 종합 평가 */}
      <Card>
        <h3 className="text-xl font-bold mb-4">뇌지컬 종합 평가</h3>
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold mb-2">종합 평가</h4>
            <p className="text-gray-700">{report.factText}</p>
          </div>
          <div>
            <h4 className="font-semibold mb-2">상세 분석</h4>
            <p className="text-gray-700">{report.lifeText}</p>
          </div>
          <div>
            <h4 className="font-semibold mb-2">생활 밀착 피드백</h4>
            <p className="text-gray-700">{report.hintText}</p>
          </div>
        </div>
      </Card>

      {/* 추천 롤모델 */}
      <Card>
        <h3 className="text-xl font-bold mb-4">추천 롤모델</h3>
        <div className="text-center py-8 text-gray-500">
          롤모델 카드 (템플릿 기반, 추후 구현)
        </div>
      </Card>

      {/* 의료 면책 조항 */}
      <div className="text-xs text-gray-500 text-center py-4">
        본 검사 결과는 의학적 진단을 대체하지 않으며, 참고용으로만 사용하시기 바랍니다.
      </div>
    </div>
  );
}
