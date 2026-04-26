import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import type {
  Session,
  MetricsScore,
  RawMetrics,
  RecoveryRawMetrics,
  TrainingMode,
} from '@noilink/shared';
import {
  aggregateRecoveryStats,
  type AggregatedRecoveryStats,
  isoToKstLocalDate,
  kstStartOfWeekMonYmd,
  kstYmdDiffDays,
} from '@noilink/shared';

export interface DerivedUserStats {
  hasData: boolean;
  trendPoints: number[];
  bpmAvg: number | null;
  weeklyChange: number | null;
  scoreUpDelta: number | null;
  brainIndex: number | null;
  topTrainings: string[];
  checkedDays: boolean[];
  /**
   * 최근 세션들의 BLE 재연결 회복 누적 통계.
   * 사용자 대시보드 안내(누적 N초 / N회) 및 "환경 점검" 코칭 신호의 단일 출처로 사용.
   */
  recoveryStats: AggregatedRecoveryStats;
  loading: boolean;
}

const MODE_LABELS: Record<TrainingMode, string> = {
  MEMORY: '기억력 트레이닝',
  COMPREHENSION: '이해력 트레이닝',
  FOCUS: '집중력 트레이닝',
  JUDGMENT: '판단력 트레이닝',
  AGILITY: '순발력 트레이닝',
  ENDURANCE: '지구력 트레이닝',
  COMPOSITE: '종합 트레이닝',
  FREE: '프리 트레이닝',
};

// 사용자별 캐시 — 탭 전환 시 즉시 표시
const cache = new Map<string, DerivedUserStats>();
const inFlight = new Map<string, boolean>();

function deriveStats(
  sessions: Session[],
  metrics: (MetricsScore | null)[],
  recoveries: (RecoveryRawMetrics | null | undefined)[],
): DerivedUserStats {
  // 시간순 정렬 (오래된→최신)
  const indexed = sessions
    .map((s, i) => ({ s, m: metrics[i] }))
    .sort((a, b) => new Date(a.s.createdAt).getTime() - new Date(b.s.createdAt).getTime());

  // 점수 시계열: session.score 우선, 없으면 metrics 6대 평균
  const scoreOf = (s: Session, m: MetricsScore | null): number | null => {
    if (typeof s.score === 'number' && s.score > 0) return Math.round(s.score);
    if (m) {
      const vals = [m.memory, m.comprehension, m.focus, m.judgment, m.agility, m.endurance].filter(
        (v): v is number => typeof v === 'number',
      );
      if (vals.length > 0) return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    return null;
  };

  const scored = indexed
    .map((x) => ({ ...x, score: scoreOf(x.s, x.m) }))
    .filter((x): x is typeof x & { score: number } => x.score !== null);

  const trendPoints = scored.slice(-8).map((x) => x.score);

  // BPM 평균 — 최근 7개
  const recentBpm = indexed.slice(-7).map((x) => x.s.bpm).filter((b) => typeof b === 'number' && b > 0);
  const bpmAvg = recentBpm.length > 0
    ? Math.round(recentBpm.reduce((a, b) => a + b, 0) / recentBpm.length)
    : null;

  // 주간 변화: 최신 점수 - 7개 전 점수 (없으면 첫 점수)
  let weeklyChange: number | null = null;
  let scoreUpDelta: number | null = null;
  if (scored.length >= 2) {
    const last = scored[scored.length - 1].score;
    const ref = scored[Math.max(0, scored.length - 8)].score;
    weeklyChange = last - ref;
    scoreUpDelta = last - scored[scored.length - 2].score;
  }

  // 브레인 인덱스 — 최근 3회 평균
  const brainIndex = scored.length > 0
    ? Math.round(
        scored.slice(-3).reduce((acc, x) => acc + x.score, 0) /
          Math.min(3, scored.length),
      )
    : null;

  // 자주하는 트레이닝 — 모드 빈도수 상위 3개
  const counts = new Map<TrainingMode, number>();
  for (const x of indexed) counts.set(x.s.mode, (counts.get(x.s.mode) ?? 0) + 1);
  const topTrainings = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => MODE_LABELS[m] ?? '트레이닝');

  // 이번 주 출석(월~일) — KST(`Asia/Seoul`) 기준으로 잠가 디바이스 시간대 흔들림을 막는다 (Task #144).
  //  - 자정 직전(KST) 에 끝낸 세션이 UTC 디바이스에서 다른 요일/주 칸으로 떨어지던 어긋남을 회귀 방지.
  //  - 결과 화면 비교 카드(Task #132) 와 같은 헬퍼(`isoToKstLocalDate`) 위에 쌓아 두 화면이 항상 같은 주를 가리킨다.
  //  - 헬퍼가 `null` 을 돌려주는 비정상 입력은 조용히 건너뛰고 7칸 모두 비워둔다 — 가짜 체크를 만들지 않는다.
  const checkedDays = [false, false, false, false, false, false, false];
  const weekStartYmd = kstStartOfWeekMonYmd(new Date().toISOString());
  if (weekStartYmd) {
    for (const x of indexed) {
      const sessYmd = isoToKstLocalDate(x.s.createdAt);
      if (!sessYmd) continue;
      const diffDays = kstYmdDiffDays(sessYmd, weekStartYmd);
      if (diffDays !== null && diffDays >= 0 && diffDays < 7) {
        checkedDays[diffDays] = true;
      }
    }
  }

  // 회복 통계: 세션 1개당 recoveries 1개 항목(없으면 null)을 그대로 넘긴다 —
  // aggregateRecoveryStats 는 입력 길이를 분모로 써 "최근 전체 세션 평균" 을 계산한다.
  const recoveryStats = aggregateRecoveryStats(recoveries);

  return {
    hasData: scored.length > 0,
    trendPoints,
    bpmAvg,
    weeklyChange,
    scoreUpDelta,
    brainIndex,
    topTrainings,
    checkedDays,
    recoveryStats,
    loading: false,
  };
}

const EMPTY: DerivedUserStats = {
  hasData: false,
  trendPoints: [],
  bpmAvg: null,
  weeklyChange: null,
  scoreUpDelta: null,
  brainIndex: null,
  topTrainings: [],
  checkedDays: [false, false, false, false, false, false, false],
  recoveryStats: {
    sessionsCount: 0,
    sessionsWithRecovery: 0,
    totalMs: 0,
    windowsTotal: 0,
    avgMsPerSession: 0,
  },
  loading: true,
};

export function useUserStats(userId: string | null): DerivedUserStats {
  const cached = userId ? cache.get(userId) : undefined;
  const [stats, setStats] = useState<DerivedUserStats>(cached ?? EMPTY);

  useEffect(() => {
    if (!userId) {
      setStats({ ...EMPTY, loading: false });
      return;
    }
    if (cached) setStats(cached);
    if (inFlight.get(userId)) return;
    inFlight.set(userId, true);

    (async () => {
      try {
        const sessRes = await api.getUserSessions(userId, { limit: 30 });
        if (!sessRes.success || !sessRes.data) {
          const next = { ...EMPTY, loading: false };
          cache.set(userId, next);
          setStats(next);
          return;
        }
        const sessions: Session[] = sessRes.data;
        // 메트릭 동시 로드 — score 와 raw(recovery 메타) 를 한 번에 받아온다.
        const metricsResults = await Promise.all(
          sessions.map((s) =>
            api
              .get<{ raw: RawMetrics | null; score: MetricsScore | null }>(`/metrics/session/${s.id}`)
              .catch(() => ({ success: false, data: null }) as any),
          ),
        );
        const metrics: (MetricsScore | null)[] = metricsResults.map((r: any) =>
          r?.success && r?.data?.score ? (r.data.score as MetricsScore) : null,
        );
        const recoveries: (RecoveryRawMetrics | null | undefined)[] = metricsResults.map(
          (r: any) => (r?.success && r?.data?.raw?.recovery) || null,
        );
        const derived = deriveStats(sessions, metrics, recoveries);
        cache.set(userId, derived);
        setStats(derived);
      } catch (e) {
        console.error('useUserStats failed:', e);
        const next = { ...EMPTY, loading: false };
        cache.set(userId, next);
        setStats(next);
      } finally {
        inFlight.set(userId, false);
      }
    })();
  }, [userId]);

  return stats;
}
