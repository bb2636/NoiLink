/**
 * ORG_REPORT_001 대시보드 KPI, 트렌드(신호등), 코치 액션, 리스크 멤버
 */
import type { MetricsScore, OrgReport, RiskMember, Session, User } from '@noilink/shared';

const MS_DAY = 24 * 60 * 60 * 1000;

function latestMetricsForUser(
  userId: string,
  sessions: Session[],
  metricsScores: MetricsScore[]
): MetricsScore | null {
  const userSessions = sessions
    .filter((s) => s.userId === userId && s.isComposite && s.isValid)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  for (const s of userSessions) {
    const m = metricsScores.find((ms) => ms.sessionId === s.id);
    if (m) return m;
  }
  return null;
}

function countLowMetrics(m: MetricsScore | null): number {
  if (!m) return 0;
  const vals = [
    m.memory,
    m.comprehension,
    m.focus,
    m.judgment,
    m.agility,
    m.endurance,
  ].filter((v): v is number => typeof v === 'number');
  return vals.filter((v) => v < 55).length;
}

function compositeScoreDrop(sessions: Session[], userId: string): number {
  const list = sessions
    .filter((s) => s.userId === userId && s.isComposite && s.isValid && s.score !== undefined && s.score !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (list.length < 2) return 0;
  const latest = list[0].score ?? 0;
  const prevAvg =
    list.slice(1, 4).reduce((s, x) => s + (x.score ?? 0), 0) / Math.min(3, list.length - 1);
  return latest - prevAvg;
}

function daysSinceLastSession(sessions: Session[], userId: string, now: number): number | null {
  const userSess = sessions.filter((s) => s.userId === userId);
  if (userSess.length === 0) return null;
  const last = Math.max(...userSess.map((s) => new Date(s.createdAt).getTime()));
  return Math.floor((now - last) / MS_DAY);
}

function evaluateRiskMember(
  organizationId: string,
  member: User,
  sessions: Session[],
  metricsScores: MetricsScore[],
  now: number
): RiskMember | null {
  const latest = latestMetricsForUser(member.id, sessions, metricsScores);
  const low = countLowMetrics(latest);
  const drop = compositeScoreDrop(sessions, member.id);
  const days = daysSinceLastSession(sessions, member.id, now);
  const conf = member.brainimalConfidence ?? 0;

  const reasons: string[] = [];
  let level: 'WARN' | 'WATCH' | null = null;

  const warnLow = low >= 3;
  const warnDrop = drop < -10;
  const warnIdle = days !== null && days >= 14;

  const watchLow = low >= 2;
  const watchIdle = days !== null && days >= 7;
  const watchConf = conf > 0 && conf < 40;

  if (warnLow) reasons.push(`6대 지표 중 ${low}개가 55점 미만`);
  if (warnDrop) reasons.push(`최근 종합 점수 급락(Δ ${Math.round(drop)}점)`);
  if (warnIdle) reasons.push(`${days}일 이상 미참여`);

  if (warnLow || warnDrop || warnIdle) {
    level = 'WARN';
  } else {
    if (watchLow) reasons.push(`6대 지표 중 ${low}개가 55점 미만`);
    if (watchIdle) reasons.push(`${days}일 이상 미참여`);
    if (watchConf) reasons.push(`데이터 신뢰도 부족(Confidence ${conf})`);
    if (watchLow || watchIdle || watchConf) level = 'WATCH';
  }

  if (!level) return null;

  const lastS = sessions
    .filter((s) => s.userId === member.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return {
    userId: member.id,
    organizationId,
    riskLevel: level,
    reasons: reasons.length ? reasons : ['리스크 조건 충족'],
    lastTrainingDate: lastS?.createdAt,
    lowMetricsCount: low,
    scoreDrop: Math.round(drop),
    confidence: conf,
    detectedAt: new Date().toISOString(),
  };
}

function orgAvgCompositeScore(
  sessions: Session[],
  memberIds: Set<string>,
  start: number,
  end: number
): number | null {
  const list = sessions.filter((s) => {
    if (!memberIds.has(s.userId)) return false;
    if (!s.isComposite || !s.isValid || s.score === undefined || s.score === null) return false;
    const t = new Date(s.createdAt).getTime();
    return t >= start && t < end;
  });
  if (list.length === 0) return null;
  return list.reduce((a, s) => a + (s.score as number), 0) / list.length;
}

function metricSpreadAcrossTeam(
  members: User[],
  sessions: Session[],
  metricsScores: MetricsScore[]
): { label: string; key: keyof MetricsScore; spread: number } | null {
  const keys: { key: keyof MetricsScore; label: string }[] = [
    { key: 'memory', label: '기억력' },
    { key: 'comprehension', label: '이해력' },
    { key: 'focus', label: '집중력' },
    { key: 'judgment', label: '판단력' },
    { key: 'agility', label: '멀티태스킹' },
    { key: 'endurance', label: '지구력' },
  ];
  let best: { label: string; key: keyof MetricsScore; spread: number } | null = null;
  for (const { key, label } of keys) {
    const vals: number[] = [];
    for (const m of members) {
      const ms = latestMetricsForUser(m.id, sessions, metricsScores);
      const v = ms?.[key];
      if (typeof v === 'number') vals.push(v);
    }
    if (vals.length < 2) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const varc = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    const spread = Math.sqrt(varc) * 1.25;
    if (!best || spread > best.spread) best = { label, key, spread };
  }
  return best;
}

function buildCoachAction(
  members: User[],
  sessions: Session[],
  metricsScores: MetricsScore[],
  trendScore: number,
  trendStatus: OrgReport['trendStatus']
): string {
  const spread = metricSpreadAcrossTeam(members, sessions, metricsScores);
  if (spread && spread.spread >= 12) {
    return `${spread.label} 편차가 크니(Spread ${Math.round(spread.spread)}) 난이도 층화 운영을 권장합니다.`;
  }
  if (trendStatus === 'DOWN') {
    return `팀 평균 점수 추세가 하락(Trend ${trendScore >= 0 ? '+' : ''}${Math.round(trendScore * 10) / 10})입니다. 종합 트레이닝 주 2회 이상·회복일 운영을 검토하세요.`;
  }
  if (trendStatus === 'UP') {
    return `팀 평균이 상승세입니다. 현재 난이도를 유지하되, 개인 편차가 큰 구성원은 보조 과제를 배정하세요.`;
  }
  return '팀 지표가 안정권입니다. 주간 미션·소그룹 챌린지로 참여 동기를 유지하세요.';
}

export function buildOrgDashboardPayload(
  organizationId: string,
  members: User[],
  sessions: Session[],
  metricsScores: MetricsScore[]
): { orgReport: OrgReport; riskMembers: RiskMember[] } {
  const now = Date.now();
  const memberIds = new Set(members.map((m) => m.id));
  const sevenAgo = now - 7 * MS_DAY;
  const fourteenAgo = now - 14 * MS_DAY;

  const activeMembers = members.filter((m) =>
    sessions.some(
      (s) =>
        s.userId === m.id && new Date(s.createdAt).getTime() >= sevenAgo
    )
  ).length;

  const participationRate =
    members.length > 0 ? activeMembers / members.length : 0;

  const compositeTrained = members.filter((m) =>
    sessions.some(
      (s) =>
        s.userId === m.id &&
        s.isComposite &&
        s.isValid &&
        new Date(s.createdAt).getTime() >= fourteenAgo
    )
  ).length;
  const compositeCompletionRate =
    members.length > 0 ? compositeTrained / members.length : 0;

  const compositeScoresLast30 = sessions
    .filter(
      (s) =>
        memberIds.has(s.userId) &&
        s.isComposite &&
        s.isValid &&
        s.score !== undefined &&
        s.score !== null &&
        new Date(s.createdAt).getTime() >= now - 30 * MS_DAY
    )
    .map((s) => s.score as number);
  const teamAvgScore =
    compositeScoresLast30.length > 0
      ? Math.round(
          compositeScoresLast30.reduce((a, b) => a + b, 0) /
            compositeScoresLast30.length
        )
      : 0;

  const confs = members
    .map((m) => m.brainimalConfidence)
    .filter((c): c is number => typeof c === 'number' && c > 0);
  const teamAvgConfidence =
    confs.length > 0
      ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length)
      : 0;

  const riskMembers: RiskMember[] = [];
  for (const m of members) {
    const r = evaluateRiskMember(organizationId, m, sessions, metricsScores, now);
    if (r) riskMembers.push(r);
  }
  const riskMemberCount = riskMembers.length;

  const recentAvg = orgAvgCompositeScore(sessions, memberIds, sevenAgo, now);
  const prevAvg = orgAvgCompositeScore(sessions, memberIds, fourteenAgo, sevenAgo);
  const trendScore =
    recentAvg !== null && prevAvg !== null
      ? recentAvg - prevAvg
      : recentAvg !== null
        ? recentAvg - teamAvgScore
        : 0;
  let trendStatus: OrgReport['trendStatus'] = 'FLAT';
  if (trendScore >= 3) trendStatus = 'UP';
  else if (trendScore <= -3) trendStatus = 'DOWN';

  const coachAction = buildCoachAction(members, sessions, metricsScores, trendScore, trendStatus);

  const orgReport: OrgReport = {
    id: `org_kpi_${organizationId}_${Date.now()}`,
    organizationId,
    activeMembers,
    participationRate,
    compositeCompletionRate,
    teamAvgScore,
    teamAvgConfidence,
    riskMemberCount,
    trendScore: Math.round(trendScore * 10) / 10,
    trendStatus,
    coachAction,
    createdAt: new Date().toISOString(),
  };

  return { orgReport, riskMembers };
}
