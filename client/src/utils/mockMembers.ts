/**
 * 소속 인원 더미 데이터 + 해당 인원 클릭 시 표시할 개인 리포트/추이 더미 생성기.
 *  - OrganizationReport: 소속 인원 목록을 표시하는 데 사용
 *  - Report: reportId가 mock member id와 일치하면 API 대신 합성 데이터 사용
 */
import type { BrainimalType, Report, User } from '@noilink/shared';
import type { TrendPoint } from '../components/MultiTrendChart/MultiTrendChart';
import { getBrainimalIcon } from './brainimalIcons';

function daysAgo(d: number): string {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return x.toISOString();
}

// 생년월일(YYYY.MM.DD) — 데모용으로 age로 역산하여 고정값 반환
function birthDateString(age: number, monthDay: string): string {
  const year = new Date().getFullYear() - age;
  return `${year}.${monthDay}`;
}

export type MockMember = User & {
  birthDate: string; // 표시용
};

export const MOCK_MEMBERS: MockMember[] = [
  { id: 'm1',  username: 'kim01',  name: '김순자', userType: 'ORGANIZATION', age: 78, brainAge: 76, brainimalType: 'FOX_BALANCED',     streak: 5, createdAt: '', lastTrainingDate: daysAgo(0), birthDate: birthDateString(78, '09.04') },
  { id: 'm2',  username: 'lee02',  name: '이영희', userType: 'ORGANIZATION', age: 82, brainAge: 84, brainimalType: 'BEAR_ENDURANCE',   streak: 3, createdAt: '', lastTrainingDate: daysAgo(1), birthDate: birthDateString(82, '09.04') },
  { id: 'm3',  username: 'park03', name: '박정수', userType: 'ORGANIZATION', age: 75, brainAge: 71, brainimalType: 'OWL_FOCUS',        streak: 8, createdAt: '', lastTrainingDate: daysAgo(0), birthDate: birthDateString(75, '09.04') },
  { id: 'm4',  username: 'choi04', name: '최말순', userType: 'ORGANIZATION', age: 80, brainAge: 81, brainimalType: 'KOALA_CALM',       streak: 2, createdAt: '', lastTrainingDate: daysAgo(2), birthDate: birthDateString(80, '09.04') },
  { id: 'm5',  username: 'jung05', name: '정복례', userType: 'ORGANIZATION', age: 77, brainAge: 75, brainimalType: 'FOX_BALANCED',     streak: 6, createdAt: '', lastTrainingDate: daysAgo(1), birthDate: birthDateString(77, '09.04') },
  { id: 'm6',  username: 'kang06', name: '강만수', userType: 'ORGANIZATION', age: 84, brainAge: 87, brainimalType: 'CHEETAH_JUDGMENT', streak: 1, createdAt: '', lastTrainingDate: daysAgo(4), birthDate: birthDateString(84, '09.04') },
  { id: 'm7',  username: 'shin07', name: '신옥자', userType: 'ORGANIZATION', age: 79, brainAge: 78, brainimalType: 'DOLPHIN_BRILLIANT',streak: 4, createdAt: '', lastTrainingDate: daysAgo(0), birthDate: birthDateString(79, '09.04') },
  { id: 'm8',  username: 'song08', name: '송상철', userType: 'ORGANIZATION', age: 76, brainAge: 73, brainimalType: 'TIGER_STRATEGIC',  streak: 7, createdAt: '', lastTrainingDate: daysAgo(1), birthDate: birthDateString(76, '09.04') },
  { id: 'm9',  username: 'oh09',   name: '오금자', userType: 'ORGANIZATION', age: 81, brainAge: 82, brainimalType: 'CAT_DELICATE',     streak: 2, createdAt: '', lastTrainingDate: daysAgo(3), birthDate: birthDateString(81, '09.04') },
  { id: 'm10', username: 'yoon10', name: '윤덕수', userType: 'ORGANIZATION', age: 78, brainAge: 76, brainimalType: 'EAGLE_INSIGHT',    streak: 5, createdAt: '', lastTrainingDate: daysAgo(0), birthDate: birthDateString(78, '09.04') },
  { id: 'm11', username: 'lim11',  name: '임순녀', userType: 'ORGANIZATION', age: 83, brainAge: 86, brainimalType: 'LION_BOLD',        streak: 1, createdAt: '', lastTrainingDate: daysAgo(5), birthDate: birthDateString(83, '09.04') },
  { id: 'm12', username: 'han12',  name: '한봉수', userType: 'ORGANIZATION', age: 75, brainAge: 72, brainimalType: 'DOG_SOCIAL',       streak: 9, createdAt: '', lastTrainingDate: daysAgo(0), birthDate: birthDateString(75, '09.04') },
];

export function getMockMember(id: string | undefined): MockMember | null {
  if (!id) return null;
  return MOCK_MEMBERS.find((m) => m.id === id) ?? null;
}

// 결정론적(시드 기반) 의사 난수 — 같은 멤버 id면 항상 같은 값
function seedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function pseudo(seed: number, i: number): number {
  const x = Math.sin(seed * 9301 + i * 49297) * 233280;
  return x - Math.floor(x);
}

const TOTAL_SCORE_BY_TYPE: Partial<Record<BrainimalType, number>> = {
  FOX_BALANCED: 76,
  BEAR_ENDURANCE: 84,
  OWL_FOCUS: 71,
  KOALA_CALM: 81,
  CHEETAH_JUDGMENT: 79,
  DOLPHIN_BRILLIANT: 86,
  TIGER_STRATEGIC: 88,
  CAT_DELICATE: 74,
  EAGLE_INSIGHT: 82,
  LION_BOLD: 80,
  DOG_SOCIAL: 77,
};

export function getMockMemberTotalScore(member: MockMember): number {
  if (!member.brainimalType) return 75;
  return TOTAL_SCORE_BY_TYPE[member.brainimalType] ?? 75;
}

/** 멤버에 맞춰 합성한 개인 리포트(목업). */
export function buildMockMemberReport(member: MockMember): Report {
  const seed = seedFromId(member.id);
  const total = getMockMemberTotalScore(member);
  const variance = (i: number, range = 12) =>
    Math.round((pseudo(seed, i) - 0.5) * range);

  const memory = clamp(total + variance(1));
  const comprehension = clamp(total + variance(2));
  const focus = clamp(total + variance(3));
  const judgment = clamp(total + variance(4));
  const agility = clamp(total + variance(5));
  const endurance = clamp(total + variance(6));

  const info = getBrainimalIcon(member.brainimalType ?? 'FOX_BALANCED');
  const orderedScores: { label: string; value: number }[] = [
    { label: '기억력', value: memory },
    { label: '이해력', value: comprehension },
    { label: '집중력', value: focus },
    { label: '판단력', value: judgment },
    { label: '순발력', value: agility },
    { label: '지구력', value: endurance },
  ];
  const top = [...orderedScores].sort((a, b) => b.value - a.value)[0];
  const bottom = [...orderedScores].sort((a, b) => a.value - b.value)[0];

  return {
    id: `mock-report-${member.id}`,
    userId: member.id,
    reportVersion: 1,
    brainimalType: member.brainimalType ?? 'FOX_BALANCED',
    confidence: 0.82,
    metricsScore: {
      sessionId: `mock-session-${member.id}`,
      userId: member.id,
      memory,
      comprehension,
      focus,
      judgment,
      agility,
      endurance,
      rhythm: total,
      createdAt: new Date().toISOString(),
    },
    factText: `최근 트레이닝 결과 ${member.name} 님의 종합 점수는 ${total}점으로 ${info.name} 유형의 특징이 잘 드러나는 결과입니다.`,
    lifeText: `${top.label}이(가) 가장 두드러진 강점이며, ${bottom.label}은(는) 보완이 필요한 영역으로 관찰됩니다. 꾸준한 트레이닝으로 균형을 맞추는 것을 권장드립니다.`,
    hintText: '아침 5분의 가벼운 인지 워밍업과 충분한 수분 섭취가 오후 집중력 유지에 효과적입니다. 주 3회 이상 종합 트레이닝을 권장드립니다.',
    strengthText: `${top.label}(${top.value}점)이 또래 평균 대비 안정적으로 높습니다.`,
    weaknessText: `${bottom.label}(${bottom.value}점)은 상대적으로 낮은 영역으로, 짧은 세션을 자주 반복하는 트레이닝이 도움이 됩니다.`,
    metricEvidenceCards: [
      { key: 'memory', label: '기억력', body: `최근 5세션 평균 ${memory}점 — 안정적 수행을 보였습니다.` },
      { key: 'focus', label: '집중력', body: `주의 유지 과제 정답률 ${Math.min(99, focus + 8)}% 수준입니다.` },
      { key: 'agility', label: '순발력', body: `평균 반응속도 ${500 - agility * 2}ms 내외로 측정되었습니다.` },
      { key: 'endurance', label: '지구력', body: `긴 세션 후반부 정확도 변동 폭 ±${Math.max(3, 12 - Math.round(endurance / 10))}% 수준입니다.` },
    ],
    recommendedRoleModel: {
      name: info.name,
      oneLiner: info.description.slice(0, 48) + (info.description.length > 48 ? '…' : ''),
      description: info.description,
    },
    recommendedBPM: 72,
    createdAt: new Date().toISOString(),
  };
}

/** 멤버에 맞춘 변화 추이(최근 10회) 목업. */
export function buildMockMemberTrend(member: MockMember): TrendPoint[] {
  const seed = seedFromId(member.id);
  const total = getMockMemberTotalScore(member);
  return Array.from({ length: 10 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (9 - i) * 2);
    const drift = i * 0.6; // 점진적 향상
    const noise = (k: number) => Math.round((pseudo(seed, i * 10 + k) - 0.5) * 10);
    return {
      date: d.toISOString(),
      memory: clamp(total - 6 + drift + noise(1)),
      comprehension: clamp(total - 4 + drift + noise(2)),
      focus: clamp(total + 2 + drift + noise(3)),
      judgment: clamp(total - 8 + drift + noise(4)),
      agility: clamp(total + 4 + drift + noise(5)),
      endurance: clamp(total - 10 + drift + noise(6)),
    };
  });
}

function clamp(v: number, min = 30, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(v)));
}
