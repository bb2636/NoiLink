/**
 * 리포트 생성 시스템
 * 기능 명세서 3.2절 문장 생성 시스템 구현
 */

import type {
  Report,
  MetricsScore,
  BrainimalType,
  TrainingMode,
  Level,
} from '@noilink/shared';

/**
 * 리포트 템플릿
 */
interface ReportTemplate {
  fact: string[];
  life: string[];
  hint: string[];
}

/**
 * 브레이니멀 타입별 리포트 템플릿
 */
const REPORT_TEMPLATES: Record<BrainimalType, ReportTemplate> = {
  OWL_FOCUS: {
    fact: [
      '{name}님의 집중력 점수는 {focus}점입니다. 방해 자극을 잘 걸러내는 능력이 뛰어나세요.',
      '{name}님은 주의력이 높아 {focus}점의 집중력 점수를 기록했습니다.',
    ],
    life: [
      '일상에서도 방해 요소를 잘 무시하고 중요한 일에 집중할 수 있는 능력이 있습니다.',
      '멀티태스킹보다는 한 가지 일에 깊이 몰입하는 스타일이 적합합니다.',
    ],
    hint: [
      '집중력이 강점이니, 더 복잡한 과제나 긴 시간의 트레이닝에 도전해보세요.',
      '현재 집중력이 우수하니, 다른 지표(예: 멀티태스킹)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
    ],
  },
  
  CHEETAH_JUDGMENT: {
    fact: [
      '{name}님의 판단력 점수는 {judgment}점입니다. 빠른 의사결정 능력이 뛰어나세요.',
      '{name}님은 {judgment}점의 판단력으로 신속하고 정확한 판단을 내립니다.',
    ],
    life: [
      '실생활에서도 빠른 상황 판단과 결정이 필요한 상황에서 강점을 발휘합니다.',
      '시간이 촉박한 환경에서도 효율적으로 일을 처리할 수 있습니다.',
    ],
    hint: [
      '판단력이 강점이니, 더 복잡한 판단 과제나 시간 제한이 있는 트레이닝에 도전해보세요.',
      '빠른 판단력과 함께 정확도를 더 높이면 완벽한 의사결정 능력을 갖출 수 있습니다.',
    ],
  },
  
  BEAR_ENDURANCE: {
    fact: [
      '{name}님의 지구력 점수는 {endurance}점입니다. 장시간 집중력을 유지하는 능력이 뛰어나세요.',
      '{name}님은 {endurance}점의 지구력으로 피로에도 불구하고 일관된 수행을 보입니다.',
    ],
    life: [
      '장시간 작업이나 지속적인 집중이 필요한 업무에서 강점을 발휘합니다.',
      '피로도가 누적되어도 초반과 비슷한 수준의 능력을 유지할 수 있습니다.',
    ],
    hint: [
      '지구력이 강점이니, 더 긴 시간의 트레이닝이나 종합 트레이닝에 도전해보세요.',
      '현재 지구력이 우수하니, 다른 지표(예: 반응속도)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
    ],
  },
  
  DOLPHIN_BRILLIANT: {
    fact: [
      '{name}님의 기억력({memory}점)과 이해력({comprehension}점)이 모두 뛰어납니다.',
      '{name}님은 {memory}점의 기억력과 {comprehension}점의 이해력으로 학습 능력이 탁월합니다.',
    ],
    life: [
      '새로운 정보를 빠르게 이해하고 오래 기억하는 능력이 뛰어납니다.',
      '학습이나 교육 환경에서 빠른 성장을 보일 수 있습니다.',
    ],
    hint: [
      '기억력과 이해력이 모두 강점이니, 복합적인 인지 과제나 종합 트레이닝에 도전해보세요.',
      '현재 학습 능력이 우수하니, 다른 지표(예: 집중력, 판단력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
    ],
  },
  
  TIGER_STRATEGIC: {
    fact: [
      '{name}님의 이해력({comprehension}점)과 멀티태스킹({multitasking}점) 능력이 뛰어납니다.',
      '{name}님은 {comprehension}점의 이해력과 {multitasking}점의 멀티태스킹으로 전략적 사고가 우수합니다.',
    ],
    life: [
      '복잡한 상황을 빠르게 이해하고 여러 작업을 동시에 처리할 수 있습니다.',
      '전략적 계획과 실행이 필요한 업무에서 강점을 발휘합니다.',
    ],
    hint: [
      '이해력과 멀티태스킹이 강점이니, 더 복잡한 전환 과제나 종합 트레이닝에 도전해보세요.',
      '현재 전략적 능력이 우수하니, 다른 지표(예: 지구력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
    ],
  },
  
  FOX_BALANCED: {
    fact: [
      '{name}님은 모든 지표에서 균형잡힌 능력을 보입니다. 평균 점수는 {avg}점입니다.',
      '{name}님의 6대 지표가 모두 고르게 발달되어 있어 안정적인 인지 능력을 갖추고 있습니다.',
    ],
    life: [
      '다양한 상황에서 일관된 성과를 보일 수 있는 균형잡힌 능력을 갖추고 있습니다.',
      '어떤 환경에서도 적응력이 뛰어나 안정적인 수행을 보입니다.',
    ],
    hint: [
      '모든 지표가 균형잡혀 있으니, 종합 트레이닝을 통해 전반적인 능력을 더 향상시켜보세요.',
      '현재 균형이 좋으니, 특정 지표를 더 강화하여 전문성을 갖추는 것도 좋은 방법입니다.',
    ],
  },
  
  CAT_DELICATE: {
    fact: [
      '{name}님의 기억력 점수는 {memory}점입니다. 섬세하고 정확한 기억 능력이 뛰어나세요.',
      '{name}님은 {memory}점의 기억력으로 세부사항을 잘 기억하고 재현합니다.',
    ],
    life: [
      '세밀한 작업이나 정확성이 중요한 업무에서 강점을 발휘합니다.',
      '디테일에 집중하는 능력이 뛰어나 품질 높은 결과를 만들어냅니다.',
    ],
    hint: [
      '기억력이 강점이니, 더 긴 순서나 복잡한 패턴의 트레이닝에 도전해보세요.',
      '현재 기억력이 우수하니, 다른 지표(예: 반응속도)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
    ],
  },
  
  EAGLE_INSIGHT: {
    fact: [
      '{name}님의 이해력 점수는 {comprehension}점입니다. 빠른 학습과 적응 능력이 뛰어나세요.',
      '{name}님은 {comprehension}점의 이해력으로 규칙 변화에 빠르게 적응합니다.',
    ],
    life: [
      '새로운 환경이나 규칙에 빠르게 적응하고 학습할 수 있는 능력이 뛰어납니다.',
      '변화가 많은 상황에서도 빠르게 이해하고 대응할 수 있습니다.',
    ],
    hint: [
      '이해력이 강점이니, 더 복잡한 규칙 전환 과제나 종합 트레이닝에 도전해보세요.',
      '현재 이해력이 우수하니, 다른 지표(예: 지구력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
    ],
  },
  
  LION_BOLD: {
    fact: [
      '{name}님의 판단력 점수는 {judgment}점입니다. 대담하고 빠른 의사결정 능력이 뛰어나세요.',
      '{name}님은 {judgment}점의 판단력으로 신속한 결정을 내립니다.',
    ],
    life: [
      '리더십이나 빠른 결정이 필요한 상황에서 강점을 발휘합니다.',
      '위험을 감수하고 도전하는 용기가 있어 새로운 기회를 만들어냅니다.',
    ],
    hint: [
      '판단력이 강점이니, 더 복잡한 판단 과제나 시간 제한이 있는 트레이닝에 도전해보세요.',
      '빠른 판단력과 함께 정확도를 더 높이면 더 완벽한 의사결정 능력을 갖출 수 있습니다.',
    ],
  },
  
  DOG_SOCIAL: {
    fact: [
      '{name}님의 멀티태스킹 점수는 {multitasking}점입니다. 여러 작업을 동시에 처리하는 능력이 뛰어나세요.',
      '{name}님은 {multitasking}점의 멀티태스킹으로 다양한 작업을 효율적으로 처리합니다.',
    ],
    life: [
      '여러 프로젝트를 동시에 진행하거나 다양한 역할을 수행하는 환경에서 강점을 발휘합니다.',
      '협업이나 팀 작업에서 다양한 작업을 동시에 처리할 수 있습니다.',
    ],
    hint: [
      '멀티태스킹이 강점이니, 더 복잡한 동시 작업 과제나 종합 트레이닝에 도전해보세요.',
      '현재 멀티태스킹이 우수하니, 다른 지표(예: 집중력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
    ],
  },
  
  KOALA_CALM: {
    fact: [
      '{name}님은 안정적이고 일관된 수행을 보입니다. 평균 점수는 {avg}점입니다.',
      '{name}님의 반응이 안정적이고 오류가 적어 신뢰할 수 있는 능력을 보입니다.',
    ],
    life: [
      '안정적이고 신뢰할 수 있는 수행이 필요한 업무에서 강점을 발휘합니다.',
      '일관된 품질의 결과를 만들어내는 능력이 뛰어납니다.',
    ],
    hint: [
      '안정성이 강점이니, 더 긴 시간의 트레이닝이나 종합 트레이닝에 도전해보세요.',
      '현재 안정성이 우수하니, 반응속도를 더 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
    ],
  },
  
  WOLF_CREATIVE: {
    fact: [
      '{name}님의 기억력({memory}점)과 멀티태스킹({multitasking}점) 능력이 뛰어납니다.',
      '{name}님은 {memory}점의 기억력과 {multitasking}점의 멀티태스킹으로 창의적 사고가 우수합니다.',
    ],
    life: [
      '다양한 정보를 기억하고 동시에 처리하는 능력이 뛰어나 창의적인 해결책을 만들어냅니다.',
      '복잡한 문제를 다양한 각도에서 접근할 수 있는 능력이 있습니다.',
    ],
    hint: [
      '기억력과 멀티태스킹이 강점이니, 더 복잡한 복합 과제나 종합 트레이닝에 도전해보세요.',
      '현재 창의적 능력이 우수하니, 다른 지표(예: 지구력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
    ],
  },
};

/**
 * 문자열 해시 함수 (Seed 생성용)
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * 리포트 문장 생성
 */
function generateSentence(
  template: string,
  name: string,
  scores: MetricsScore,
  reportVersion: number
): string {
  const avg = Math.round((
    (scores.memory || 0) +
    (scores.comprehension || 0) +
    (scores.focus || 0) +
    (scores.judgment || 0) +
    (scores.multitasking || 0) +
    (scores.endurance || 0)
  ) / 6);
  
  return template
    .replace(/{name}/g, name)
    .replace(/{memory}/g, String(Math.round(scores.memory || 0)))
    .replace(/{comprehension}/g, String(Math.round(scores.comprehension || 0)))
    .replace(/{focus}/g, String(Math.round(scores.focus || 0)))
    .replace(/{judgment}/g, String(Math.round(scores.judgment || 0)))
    .replace(/{multitasking}/g, String(Math.round(scores.multitasking || 0)))
    .replace(/{endurance}/g, String(Math.round(scores.endurance || 0)))
    .replace(/{avg}/g, String(avg));
}

/**
 * 리포트 생성
 */
export function generateReport(
  userId: string,
  userName: string,
  reportVersion: number,
  brainimalType: BrainimalType,
  metricsScore: MetricsScore,
  confidence: number
): Report {
  const seed = hashString(`${userId}_${reportVersion}_${brainimalType}`);
  const template = REPORT_TEMPLATES[brainimalType];
  
  // Seed 기반 템플릿 선택
  const factIndex = seed % template.fact.length;
  const lifeIndex = (seed * 2) % template.life.length;
  const hintIndex = (seed * 3) % template.hint.length;
  
  const factText = generateSentence(template.fact[factIndex], userName, metricsScore, reportVersion);
  const lifeText = generateSentence(template.life[lifeIndex], userName, metricsScore, reportVersion);
  const hintText = generateSentence(template.hint[hintIndex], userName, metricsScore, reportVersion);
  
  // 추천 트레이닝 결정
  const scores = [
    { mode: 'MEMORY' as TrainingMode, score: metricsScore.memory || 0 },
    { mode: 'COMPREHENSION' as TrainingMode, score: metricsScore.comprehension || 0 },
    { mode: 'FOCUS' as TrainingMode, score: metricsScore.focus || 0 },
    { mode: 'JUDGMENT' as TrainingMode, score: metricsScore.judgment || 0 },
    { mode: 'MULTITASKING' as TrainingMode, score: metricsScore.multitasking || 0 },
    { mode: 'ENDURANCE' as TrainingMode, score: metricsScore.endurance || 0 },
  ];
  
  const weakest = scores.reduce((min, curr) => curr.score < min.score ? curr : min);
  const recommendedMode = weakest.mode;
  
  // 추천 BPM 및 Level (기본값)
  const recommendedBPM = 80;
  const recommendedLevel: Level = 3;
  
  return {
    id: `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId,
    reportVersion,
    brainimalType,
    confidence,
    metricsScore,
    factText,
    lifeText,
    hintText,
    recommendedMode,
    recommendedBPM,
    recommendedLevel,
    createdAt: new Date().toISOString(),
  };
}
