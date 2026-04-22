/**
 * 데모/시연용 단일 사용자(test@test.com — "테스트 사용자") 프로필.
 *
 * 홈 / 랭킹 / 리포트 / 결과 화면이 동일한 수치를 보여주도록 모든 목업 값을
 * 이 파일 한 곳에서 정의합니다. 실제 API가 붙기 전까지는 아래 값을 단일 출처로 사용하세요.
 *
 * TODO: 실제 API 연동 시 이 파일은 제거하고 각 화면이 서버 응답을 직접 사용하도록 전환할 것.
 */
import type { BrainimalType } from '@noilink/shared';

// 6대 지표 (평균 = (78+82+88+74+91+69)/6 ≈ 80.33 → 종합 80점)
export const DEMO_METRICS = {
  memory: 78,
  comprehension: 82,
  focus: 88,
  judgment: 74,
  agility: 91,
  endurance: 69,
} as const;

const METRIC_AVG =
  (DEMO_METRICS.memory +
    DEMO_METRICS.comprehension +
    DEMO_METRICS.focus +
    DEMO_METRICS.judgment +
    DEMO_METRICS.agility +
    DEMO_METRICS.endurance) /
  6;

export const DEMO_PROFILE = {
  // 정체성
  brainimalType: 'FOX_BALANCED' as BrainimalType,
  confidence: 86,

  // 핵심 점수
  brainIndex: Math.round(METRIC_AVG), // 80
  bpmAvg: 92,
  weeklyChange: 12,
  scoreUpDelta: 20,

  // 연속/출석
  streakDays: 5,
  attendanceRate: 90,
  checkedDays: [true, true, true, true, true, false, false] as boolean[],

  // 누적
  totalTimeHours: 4,   // 개인 회원: 합계 시간(시간)
  totalSessionsOrg: 14, // 기관 회원: 합계 트레이닝 횟수

  // 랭킹
  rankByTab: { composite: 13, time: 27, streak: 19 } as Record<'composite' | 'time' | 'streak', number>,

  // 트렌드
  trendPoints: [62, 66, 70, 68, 72, 75, 78, 80] as number[],

  // 자주하는 트레이닝
  topTrainings: ['기억력 트레이닝', '집중력 트레이닝', '프리트레이닝'] as string[],
} as const;
