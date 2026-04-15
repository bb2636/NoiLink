/**
 * 기관 인사이트 리포트 생성·조회
 */
import { db } from '../db.js';
import type {
  BrainimalType,
  MetricsScore,
  OrganizationInsightReport,
  Session,
  User,
} from '@noilink/shared';
import {
  buildMetricEvidenceCards,
  buildStrengthWeakness,
  generateOrganizationNarrative,
} from './report-generator.js';
import { computeBrainAge } from '../utils/brain-age.js';
import { buildOrgDashboardPayload } from './org-report-dashboard.js';

const BRAINIMAL_LABEL: Record<BrainimalType, string> = {
  OWL_FOCUS: '집중하는 부엉이',
  CHEETAH_JUDGMENT: '판단력의 치타',
  BEAR_ENDURANCE: '끈기있는 곰',
  DOLPHIN_BRILLIANT: '명석한 돌고래',
  TIGER_STRATEGIC: '전략적인 호랑이',
  FOX_BALANCED: '균형적인 여우',
  CAT_DELICATE: '섬세한 고양이',
  EAGLE_INSIGHT: '통찰력의 독수리',
  LION_BOLD: '대담한 사자',
  DOG_SOCIAL: '사회적인 강아지',
  KOALA_CALM: '침착한 코알라',
  WOLF_CREATIVE: '창의적인 늑대',
};

function averageMetricsScores(
  list: MetricsScore[],
  organizationId: string
): MetricsScore {
  const keys = [
    'memory',
    'comprehension',
    'focus',
    'judgment',
    'agility',
    'endurance',
  ] as const;
  const out: Partial<MetricsScore> = {
    sessionId: `org_aggregate_${organizationId}`,
    userId: organizationId,
    createdAt: new Date().toISOString(),
  };
  for (const k of keys) {
    const vals = list.map((m) => m[k]).filter((v): v is number => typeof v === 'number');
    if (vals.length > 0) {
      out[k] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
  }
  return out as MetricsScore;
}

function latestMetricsForUser(
  userId: string,
  sessions: Session[],
  metricsScores: MetricsScore[]
): MetricsScore | null {
  const userSessions = sessions
    .filter((s) => s.userId === userId && s.isComposite && s.isValid)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  for (const s of userSessions) {
    const m = metricsScores.find((ms) => ms.sessionId === s.id);
    if (m) return m;
  }
  return null;
}

export async function generateAndSaveOrganizationInsightReport(
  organizationId: string
): Promise<OrganizationInsightReport | null> {
  const users: User[] = (await db.get('users')) || [];
  const members = users.filter(
    (u) => u.organizationId === organizationId && !u.isDeleted
  );
  if (members.length === 0) return null;

  const sessions: Session[] = (await db.get('sessions')) || [];
  const metricsScores: MetricsScore[] = (await db.get('metricsScores')) || [];

  const latestList: MetricsScore[] = [];
  for (const m of members) {
    const lm = latestMetricsForUser(m.id, sessions, metricsScores);
    if (lm) latestList.push(lm);
  }

  if (latestList.length === 0) return null;

  const avgMetrics = averageMetricsScores(latestList, organizationId);

  const dist = new Map<BrainimalType, number>();
  for (const m of members) {
    if (m.brainimalType) {
      dist.set(m.brainimalType, (dist.get(m.brainimalType) || 0) + 1);
    }
  }

  let representativeBrainimal: BrainimalType = 'FOX_BALANCED';
  let maxC = 0;
  for (const [t, c] of dist.entries()) {
    if (c > maxC) {
      maxC = c;
      representativeBrainimal = t;
    }
  }

  const ages = members.map((m) => m.age).filter((a): a is number => typeof a === 'number');
  const cohortActualAvgAge =
    ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 30;

  const brainAges: number[] = [];
  for (const m of members) {
    const lm = latestMetricsForUser(m.id, sessions, metricsScores);
    if (lm) {
      brainAges.push(computeBrainAge(lm, m.age));
    }
  }
  const avgBrainAge =
    brainAges.length > 0
      ? Math.round(brainAges.reduce((a, b) => a + b, 0) / brainAges.length)
      : computeBrainAge(avgMetrics, cohortActualAvgAge);

  const brainAgeVsChronologicalDelta = avgBrainAge - cohortActualAvgAge;

  const orgName =
    members.find((m) => m.organizationName)?.organizationName || '소속 기관';

  const version = latestList.length + members.length;
  const { factText, lifeText, hintText } = generateOrganizationNarrative(
    orgName,
    representativeBrainimal,
    avgMetrics,
    version
  );
  const { strength, weakness } = buildStrengthWeakness(avgMetrics);
  const metricEvidenceCards = buildMetricEvidenceCards(avgMetrics);

  const withType = members.filter((m) => m.brainimalType).length;
  let brainimalDistribution = Array.from(dist.entries()).map(([type, count]) => ({
    type,
    count,
    percent: withType > 0 ? Math.round((count / withType) * 1000) / 10 : 0,
  }));
  if (brainimalDistribution.length === 0) {
    brainimalDistribution = [
      {
        type: representativeBrainimal,
        count: members.length,
        percent: 100,
      },
    ];
  }

  const trained = latestList.length;
  const memberStatusSummary = `등록된 소속 인원 ${members.length}명 중, 최근 종합 트레이닝 지표가 있는 인원은 ${trained}명입니다. 데이터가 있는 인원을 기준으로 팀 평균을 산출했습니다.`;

  const { orgReport, riskMembers } = buildOrgDashboardPayload(
    organizationId,
    members,
    sessions,
    metricsScores
  );

  const report: OrganizationInsightReport = {
    id: `org_report_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    organizationId,
    organizationName: orgName,
    managedMemberCount: members.length,
    avgBrainAge,
    cohortActualAvgAge,
    brainAgeVsChronologicalDelta,
    representativeBrainimal,
    representativeBrainimalLabel: BRAINIMAL_LABEL[representativeBrainimal],
    avgMetricsScore: avgMetrics,
    factText,
    lifeText,
    hintText,
    strengthText: strength,
    weaknessText: weakness,
    metricEvidenceCards,
    brainimalDistribution,
    memberStatusSummary,
    orgReport,
    riskMembers,
    createdAt: new Date().toISOString(),
  };

  const store: OrganizationInsightReport[] =
    (await db.get('organizationInsightReports')) || [];
  store.push(report);
  await db.set('organizationInsightReports', store);

  return report;
}

export async function getLatestOrganizationInsightReport(
  organizationId: string
): Promise<OrganizationInsightReport | null> {
  const store: OrganizationInsightReport[] =
    (await db.get('organizationInsightReports')) || [];
  const mine = store
    .filter((r) => r.organizationId === organizationId)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  return mine[0] || null;
}
