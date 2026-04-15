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
  MetricEvidenceCard,
  RecommendedRoleModel,
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
      '{name}님의 {focus}점 집중력은 방해 자극에 대한 저항력이 뛰어나다는 것을 보여줍니다.',
    ],
    life: [
      '일상에서도 방해 요소를 잘 무시하고 중요한 일에 집중할 수 있는 능력이 있습니다.',
      '멀티태스킹보다는 한 가지 일에 깊이 몰입하는 스타일이 적합합니다.',
      '시끄러운 환경이나 여러 자극이 있는 상황에서도 핵심 작업에 집중할 수 있습니다.',
    ],
    hint: [
      '집중력이 강점이니, 더 복잡한 과제나 긴 시간의 트레이닝에 도전해보세요.',
      '현재 집중력이 우수하니, 다른 지표(예: 순발력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
      '집중력 트레이닝을 지속하면 더욱 깊은 몰입 상태를 경험할 수 있습니다.',
    ],
  },
  
  CHEETAH_JUDGMENT: {
    fact: [
      '{name}님의 판단력 점수는 {judgment}점입니다. 빠른 의사결정 능력이 뛰어나세요.',
      '{name}님은 {judgment}점의 판단력으로 신속하고 정확한 판단을 내립니다.',
      '{name}님의 {judgment}점 판단력은 GO/NO-GO 상황에서 뛰어난 선택 능력을 보여줍니다.',
    ],
    life: [
      '실생활에서도 빠른 상황 판단과 결정이 필요한 상황에서 강점을 발휘합니다.',
      '시간이 촉박한 환경에서도 효율적으로 일을 처리할 수 있습니다.',
      '위기 상황이나 긴급한 결정이 필요한 순간에 빠르고 정확하게 대응할 수 있습니다.',
    ],
    hint: [
      '판단력이 강점이니, 더 복잡한 판단 과제나 시간 제한이 있는 트레이닝에 도전해보세요.',
      '빠른 판단력과 함께 정확도를 더 높이면 완벽한 의사결정 능력을 갖출 수 있습니다.',
      '더블탭 과제나 복잡한 판단 상황을 연습하면 반응 속도와 정확도를 동시에 향상시킬 수 있습니다.',
    ],
  },
  
  BEAR_ENDURANCE: {
    fact: [
      '{name}님의 지구력 점수는 {endurance}점입니다. 장시간 집중력을 유지하는 능력이 뛰어나세요.',
      '{name}님은 {endurance}점의 지구력으로 피로에도 불구하고 일관된 수행을 보입니다.',
      '{name}님의 {endurance}점 지구력은 세션 후반부에도 초반과 유사한 성과를 유지하는 능력을 나타냅니다.',
    ],
    life: [
      '장시간 작업이나 지속적인 집중이 필요한 업무에서 강점을 발휘합니다.',
      '피로도가 누적되어도 초반과 비슷한 수준의 능력을 유지할 수 있습니다.',
      '마라톤이나 장기 프로젝트처럼 지속적인 노력이 필요한 상황에서 뛰어난 성과를 보입니다.',
    ],
    hint: [
      '지구력이 강점이니, 더 긴 시간의 트레이닝이나 종합 트레이닝에 도전해보세요.',
      '현재 지구력이 우수하니, 다른 지표(예: 반응속도)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
      '300초 종합 트레이닝을 정기적으로 수행하면 지구력을 더욱 강화할 수 있습니다.',
    ],
  },
  
  DOLPHIN_BRILLIANT: {
    fact: [
      '{name}님의 기억력({memory}점)과 이해력({comprehension}점)이 모두 뛰어납니다.',
      '{name}님은 {memory}점의 기억력과 {comprehension}점의 이해력으로 학습 능력이 탁월합니다.',
      '{name}님의 기억력 {memory}점과 이해력 {comprehension}점은 정보 처리와 저장 능력이 뛰어나다는 증거입니다.',
    ],
    life: [
      '새로운 정보를 빠르게 이해하고 오래 기억하는 능력이 뛰어납니다.',
      '학습이나 교육 환경에서 빠른 성장을 보일 수 있습니다.',
      '복잡한 개념을 빠르게 파악하고 오랫동안 기억하는 능력으로 학업이나 업무에서 우수한 성과를 낼 수 있습니다.',
    ],
    hint: [
      '기억력과 이해력이 모두 강점이니, 복합적인 인지 과제나 종합 트레이닝에 도전해보세요.',
      '현재 학습 능력이 우수하니, 다른 지표(예: 집중력, 판단력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
      '순서 기억 과제와 규칙 전환 과제를 함께 연습하면 두 능력을 동시에 강화할 수 있습니다.',
    ],
  },
  
  TIGER_STRATEGIC: {
    fact: [
      '{name}님의 이해력({comprehension}점)과 순발력({agility}점) 능력이 뛰어납니다.',
      '{name}님은 {comprehension}점의 이해력과 {agility}점의 순발력으로 전략적 사고가 우수합니다.',
      '{name}님의 이해력 {comprehension}점과 순발력 {agility}점은 복잡한 상황에서 빠른 판단과 실행이 가능함을 보여줍니다.',
    ],
    life: [
      '복잡한 상황을 빠르게 이해하고 여러 작업을 동시에 처리할 수 있습니다.',
      '전략적 계획과 실행이 필요한 업무에서 강점을 발휘합니다.',
      '변화하는 환경에서 빠르게 적응하고 전략을 수정하며 여러 프로젝트를 동시에 진행할 수 있습니다.',
    ],
    hint: [
      '이해력과 순발력이 강점이니, 더 복잡한 전환 과제나 종합 트레이닝에 도전해보세요.',
      '현재 전략적 능력이 우수하니, 다른 지표(예: 지구력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
      '규칙 전환 과제와 멀티채널 과제를 결합한 종합 트레이닝이 전략적 사고를 더욱 향상시킬 수 있습니다.',
    ],
  },
  
  FOX_BALANCED: {
    fact: [
      '{name}님은 모든 지표에서 균형잡힌 능력을 보입니다. 평균 점수는 {avg}점입니다.',
      '{name}님의 6대 지표가 모두 고르게 발달되어 있어 안정적인 인지 능력을 갖추고 있습니다.',
      '{name}님의 평균 {avg}점은 모든 인지 영역에서 일관된 능력을 보여주는 균형잡힌 프로필입니다.',
    ],
    life: [
      '다양한 상황에서 일관된 성과를 보일 수 있는 균형잡힌 능력을 갖추고 있습니다.',
      '어떤 환경에서도 적응력이 뛰어나 안정적인 수행을 보입니다.',
      '특정 영역에 치우치지 않고 모든 상황에서 안정적인 성과를 낼 수 있는 다재다능한 능력을 보유하고 있습니다.',
    ],
    hint: [
      '모든 지표가 균형잡혀 있으니, 종합 트레이닝을 통해 전반적인 능력을 더 향상시켜보세요.',
      '현재 균형이 좋으니, 특정 지표를 더 강화하여 전문성을 갖추는 것도 좋은 방법입니다.',
      '300초 종합 트레이닝을 정기적으로 수행하면 모든 지표를 동시에 향상시킬 수 있습니다.',
    ],
  },
  
  CAT_DELICATE: {
    fact: [
      '{name}님의 기억력 점수는 {memory}점입니다. 섬세하고 정확한 기억 능력이 뛰어나세요.',
      '{name}님은 {memory}점의 기억력으로 세부사항을 잘 기억하고 재현합니다.',
      '{name}님의 {memory}점 기억력은 복잡한 순서와 패턴을 정확하게 기억하는 능력을 나타냅니다.',
    ],
    life: [
      '세밀한 작업이나 정확성이 중요한 업무에서 강점을 발휘합니다.',
      '디테일에 집중하는 능력이 뛰어나 품질 높은 결과를 만들어냅니다.',
      '세부사항을 놓치지 않고 정확하게 기억하는 능력으로 품질 관리나 정밀 작업에 적합합니다.',
    ],
    hint: [
      '기억력이 강점이니, 더 긴 순서나 복잡한 패턴의 트레이닝에 도전해보세요.',
      '현재 기억력이 우수하니, 다른 지표(예: 반응속도)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
      'MaxSpan을 늘리거나 복잡한 패턴의 순서 기억 과제를 연습하면 기억력을 더욱 강화할 수 있습니다.',
    ],
  },
  
  EAGLE_INSIGHT: {
    fact: [
      '{name}님의 이해력 점수는 {comprehension}점입니다. 빠른 학습과 적응 능력이 뛰어나세요.',
      '{name}님은 {comprehension}점의 이해력으로 규칙 변화에 빠르게 적응합니다.',
      '{name}님의 {comprehension}점 이해력은 Switch Cost가 낮고 학습 곡선이 가파르다는 것을 의미합니다.',
    ],
    life: [
      '새로운 환경이나 규칙에 빠르게 적응하고 학습할 수 있는 능력이 뛰어납니다.',
      '변화가 많은 상황에서도 빠르게 이해하고 대응할 수 있습니다.',
      '업무 환경이 자주 바뀌거나 새로운 프로세스를 배워야 하는 상황에서 빠르게 적응할 수 있습니다.',
    ],
    hint: [
      '이해력이 강점이니, 더 복잡한 규칙 전환 과제나 종합 트레이닝에 도전해보세요.',
      '현재 이해력이 우수하니, 다른 지표(예: 지구력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
      '규칙 전환이 자주 일어나는 과제를 연습하면 적응 속도를 더욱 향상시킬 수 있습니다.',
    ],
  },
  
  LION_BOLD: {
    fact: [
      '{name}님의 판단력 점수는 {judgment}점입니다. 대담하고 빠른 의사결정 능력이 뛰어나세요.',
      '{name}님은 {judgment}점의 판단력으로 신속한 결정을 내립니다.',
      '{name}님의 {judgment}점 판단력은 충동적이면서도 정확한 선택을 할 수 있는 능력을 보여줍니다.',
    ],
    life: [
      '리더십이나 빠른 결정이 필요한 상황에서 강점을 발휘합니다.',
      '위험을 감수하고 도전하는 용기가 있어 새로운 기회를 만들어냅니다.',
      '긴급한 상황이나 빠른 결정이 필요한 비즈니스 환경에서 리더십을 발휘할 수 있습니다.',
    ],
    hint: [
      '판단력이 강점이니, 더 복잡한 판단 과제나 시간 제한이 있는 트레이닝에 도전해보세요.',
      '빠른 판단력과 함께 정확도를 더 높이면 더 완벽한 의사결정 능력을 갖출 수 있습니다.',
      'GO/NO-GO 과제와 더블탭 과제를 결합한 복합 판단 트레이닝이 의사결정 능력을 향상시킬 수 있습니다.',
    ],
  },
  
  DOG_SOCIAL: {
    fact: [
      '{name}님의 순발력 점수는 {agility}점입니다. 여러 작업을 동시에 처리하는 능력이 뛰어나세요.',
      '{name}님은 {agility}점의 순발력으로 다양한 작업을 효율적으로 처리합니다.',
      '{name}님의 {agility}점 순발력은 손과 발 채널을 동시에 사용하는 멀티태스킹 능력이 뛰어남을 보여줍니다.',
    ],
    life: [
      '여러 프로젝트를 동시에 진행하거나 다양한 역할을 수행하는 환경에서 강점을 발휘합니다.',
      '협업이나 팀 작업에서 다양한 작업을 동시에 처리할 수 있습니다.',
      '동시에 여러 작업을 효율적으로 처리하는 능력으로 바쁜 업무 환경에서 뛰어난 성과를 낼 수 있습니다.',
    ],
    hint: [
      '순발력이 강점이니, 더 복잡한 동시 작업 과제나 종합 트레이닝에 도전해보세요.',
      '현재 순발력이 우수하니, 다른 지표(예: 집중력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
      '멀티채널 과제와 전환 비용이 낮은 과제를 결합한 트레이닝이 순발력을 더욱 향상시킬 수 있습니다.',
    ],
  },
  
  KOALA_CALM: {
    fact: [
      '{name}님은 안정적이고 일관된 수행을 보입니다. 평균 점수는 {avg}점입니다.',
      '{name}님의 반응이 안정적이고 오류가 적어 신뢰할 수 있는 능력을 보입니다.',
      '{name}님의 평균 {avg}점은 낮은 표준편차와 일관된 성과를 나타내는 안정적인 프로필입니다.',
    ],
    life: [
      '안정적이고 신뢰할 수 있는 수행이 필요한 업무에서 강점을 발휘합니다.',
      '일관된 품질의 결과를 만들어내는 능력이 뛰어납니다.',
      '반응 기복이 적고 오류율이 낮아 신뢰할 수 있는 결과를 일관되게 만들어낼 수 있습니다.',
    ],
    hint: [
      '안정성이 강점이니, 더 긴 시간의 트레이닝이나 종합 트레이닝에 도전해보세요.',
      '현재 안정성이 우수하니, 반응속도를 더 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
      '장시간 트레이닝을 통해 안정성을 유지하면서 점진적으로 반응속도를 향상시킬 수 있습니다.',
    ],
  },
  
  WOLF_CREATIVE: {
    fact: [
      '{name}님의 기억력({memory}점)과 순발력({agility}점) 능력이 뛰어납니다.',
      '{name}님은 {memory}점의 기억력과 {agility}점의 순발력으로 창의적 사고가 우수합니다.',
      '{name}님의 기억력 {memory}점과 순발력 {agility}점은 복잡한 정보를 기억하면서 동시에 처리하는 창의적 능력을 보여줍니다.',
    ],
    life: [
      '다양한 정보를 기억하고 동시에 처리하는 능력이 뛰어나 창의적인 해결책을 만들어냅니다.',
      '복잡한 문제를 다양한 각도에서 접근할 수 있는 능력이 있습니다.',
      '기억된 정보를 빠르게 조합하고 새로운 관점에서 접근하는 능력으로 혁신적인 아이디어를 만들어낼 수 있습니다.',
    ],
    hint: [
      '기억력과 순발력이 강점이니, 더 복잡한 복합 과제나 종합 트레이닝에 도전해보세요.',
      '현재 창의적 능력이 우수하니, 다른 지표(예: 지구력)를 함께 향상시키면 더 균형잡힌 능력을 갖출 수 있습니다.',
      '순서 기억 과제와 멀티채널 과제를 결합한 복합 트레이닝이 창의적 사고를 더욱 향상시킬 수 있습니다.',
    ],
  },
};

const SIX_METRICS: { key: keyof MetricsScore; label: string }[] = [
  { key: 'memory', label: '기억력' },
  { key: 'comprehension', label: '이해력' },
  { key: 'focus', label: '집중력' },
  { key: 'judgment', label: '판단력' },
  { key: 'agility', label: '순발력' },
  { key: 'endurance', label: '지구력' },
];

function metricValue(scores: MetricsScore, key: keyof MetricsScore): number {
  const v = scores[key];
  return typeof v === 'number' ? v : 0;
}

function scoreTier(v: number): 'low' | 'mid' | 'high' {
  if (v < 45) return 'low';
  if (v < 72) return 'mid';
  return 'high';
}

export function buildMetricEvidenceCards(scores: MetricsScore): MetricEvidenceCard[] {
  const bodies: Record<string, Record<'low' | 'mid' | 'high', string>> = {
    memory: {
      low: '순서·패턴 기억 과제에서 {score}점으로, 단기 기억 정확도를 높이는 훈련이 우선입니다.',
      mid: '{score}점대로 기본 기억 용량은 갖추었고, 길이·난이도를 올리며 안정화할 수 있습니다.',
      high: '{score}점으로 순서 재현·패턴 유지가 안정적입니다. 복합 과제로 응용을 넓혀 보세요.',
    },
    comprehension: {
      low: '{score}점으로 규칙 전환·규칙 추론에서 추가 연습이 필요합니다.',
      mid: '{score}점대로 새 규칙 적응 속도는 평균 수준입니다. 전환 빈도를 높인 트레이닝을 권합니다.',
      high: '{score}점으로 규칙 변화에 빠르게 적응하는 편입니다.',
    },
    focus: {
      low: '{score}점으로 방해 자극 억제·타겟 유지에 집중이 필요합니다.',
      mid: '{score}점대로 집중은 무난하나, 장시간 유지 훈련을 병행하면 좋습니다.',
      high: '{score}점으로 핵심 목표에 주의를 유지하는 능력이 뚜렷합니다.',
    },
    judgment: {
      low: '{score}점으로 억제·판단 과제에서 정확도를 끌어올릴 여지가 있습니다.',
      mid: '{score}점대로 판단 속도와 정확도의 균형을 맞추는 단계입니다.',
      high: '{score}점으로 GO/NO-GO·복합 판단에서 안정적인 선택이 관찰됩니다.',
    },
    agility: {
      low: '{score}점으로 다채널·동시 과제 처리 역량을 키우는 것이 좋습니다.',
      mid: '{score}점대로 멀티태스킹 기본기는 갖추었습니다.',
      high: '{score}점으로 손·발 채널을 동시에 운용하는 능력이 강합니다.',
    },
    endurance: {
      low: '{score}점으로 후반부 수행 저하가 있을 수 있어 지구력 루틴이 필요합니다.',
      mid: '{score}점대로 전반·후반 격차를 줄이는 훈련이 효과적입니다.',
      high: '{score}점으로 피로 구간에서도 수행을 유지하는 편입니다.',
    },
  };

  return SIX_METRICS.map(({ key, label }) => {
    const v = Math.round(metricValue(scores, key));
    const tier = scoreTier(v);
    const raw = bodies[key as string][tier];
    const body = raw.replace(/\{score\}/g, String(v));
    return { key: key as string, label, body };
  });
}

export function buildStrengthWeakness(scores: MetricsScore): { strength: string; weakness: string } {
  const ranked = SIX_METRICS.map(({ key, label }) => ({
    label,
    score: metricValue(scores, key),
  })).sort((a, b) => b.score - a.score);

  const top = ranked.slice(0, 2);
  const bottom = ranked.slice(-2).reverse();

  const strength = `${top.map((t) => `${t.label}(${Math.round(t.score)}점)`).join(', ')}이(가) 상대적으로 강한 영역입니다.`;
  const weakness = `${bottom.map((t) => `${t.label}(${Math.round(t.score)}점)`).join(', ')}은(는) 보완하면 전체 균형이 좋아집니다.`;

  return { strength, weakness };
}

const ROLE_MODELS: Record<BrainimalType, RecommendedRoleModel> = {
  OWL_FOCUS: {
    name: '몰입형 리더',
    oneLiner: '한 번에 하나를 깊이 파고드는 집중 스타일',
    description:
      '방해를 걸러내고 핵심 과제에 오래 머무는 패턴입니다. 장기 프로젝트·정밀 작업에서 강점을 살리되, 전환 과제로 유연성을 보완해 보세요.',
  },
  CHEETAH_JUDGMENT: {
    name: '신속 판단형 실행가',
    oneLiner: '짧은 시간에 결론을 내리는 스타일',
    description:
      '빠른 의사결정이 돋보입니다. 정확도 검증·이중 검토 루틴을 더하면 실수를 줄일 수 있습니다.',
  },
  BEAR_ENDURANCE: {
    name: '지구력형 퍼포머',
    oneLiner: '후반까지 흔들림 없이 밀어붙이는 스타일',
    description:
      '장시간 수행 유지가 강점입니다. 스프린트형 과제를 섞어 순발력과의 균형을 맞춰 보세요.',
  },
  DOLPHIN_BRILLIANT: {
    name: '학습·기억 균형형',
    oneLiner: '이해와 암기를 함께 끌어올리는 스타일',
    description:
      '정보를 빠르게 받아들이고 구조화하는 데 유리합니다. 단일 지표 극대화보다 종합 루틴이 잘 맞습니다.',
  },
  TIGER_STRATEGIC: {
    name: '전환·실행 병행형',
    oneLiner: '규칙을 읽고 바로 손에 옮기는 스타일',
    description:
      '복잡한 상황을 이해한 뒤 동시에 여러 동작을 처리하는 데 강합니다. 휴식 루틴으로 과부하를 관리하세요.',
  },
  FOX_BALANCED: {
    name: '올라운드 플레이어',
    oneLiner: '특출한 약점 없이 고르게 가는 스타일',
    description:
      '특정 영역에 치우치지 않습니다. 목표가 정해지면 그 방향으로만 파고드는 심화 트레이닝이 효과적입니다.',
  },
  CAT_DELICATE: {
    name: '디테일 기억형',
    oneLiner: '미세한 차이를 기억·재현하는 스타일',
    description:
      '정확도와 세밀함이 강점입니다. 시간 제한을 짧게 두는 과제로 속도를 보완해 보세요.',
  },
  EAGLE_INSIGHT: {
    name: '적응형 학습자',
    oneLiner: '새 규칙에 빨리 올라타는 스타일',
    description:
      '환경 변화에 빠르게 맞춥니다. 장기 기억·복습 루틴을 더하면 학습이 더 오래 남습니다.',
  },
  LION_BOLD: {
    name: '과감한 결정가',
    oneLiner: '속도를 중시하는 결단 스타일',
    description:
      '빠른 선택이 강점입니다. NO-GO 상황에서 한 박자 쉬는 훈련으로 충동 오류를 줄일 수 있습니다.',
  },
  DOG_SOCIAL: {
    name: '멀티채널 협업형',
    oneLiner: '여러 입력을 동시에 처리하는 스타일',
    description:
      '동시 과제 처리에 강합니다. 단일 목표 몰입 시간을 늘리는 훈련으로 집중도를 보완해 보세요.',
  },
  KOALA_CALM: {
    name: '안정형 수행자',
    oneLiner: '기복 없이 일정한 리듬을 유지하는 스타일',
    description:
      '변동이 작고 신뢰도 높은 결과를 냅니다. 변화가 잦은 과제로 적응력을 넓히면 좋습니다.',
  },
  WOLF_CREATIVE: {
    name: '연결·속도형 사고',
    oneLiner: '기억한 정보를 빠르게 조합하는 스타일',
    description:
      '정보를 엮어 새로운 시도를 하는 데 유리합니다. 지구력 트레이닝으로 후반 집중을 지키세요.',
  },
};

function pickRoleModel(type: BrainimalType): RecommendedRoleModel {
  return ROLE_MODELS[type];
}

/**
 * 문자열 해시 함수 (Seed 생성용)
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/** 육각형(6대 지표) 산포 — 편차 작음·큼 판별 */
function profileSpread(metrics: MetricsScore): { sd: number; range: number; values: number[] } {
  const values = [
    metrics.memory,
    metrics.comprehension,
    metrics.focus,
    metrics.judgment,
    metrics.agility,
    metrics.endurance,
  ].filter((v): v is number => v !== undefined && !Number.isNaN(v));
  if (values.length < 3) return { sd: 999, range: 999, values };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  const range = Math.max(...values) - Math.min(...values);
  return { sd, range, values };
}

/** 최저 지표 보완 vs 종합(Full) 권장 — 명세 3.3 */
function shouldRecommendCompositeTraining(metrics: MetricsScore): boolean {
  const { sd, range } = profileSpread(metrics);
  if (sd < 9) return true;
  if (range > 32) return true;
  return false;
}

/** 피로 보호: Drift/놓침 비율 높음 프록시 → BPM−8, Level−1 */
function fatigueAdjustment(metrics: MetricsScore): { active: boolean; bpm: number; level: Level } {
  const baseBpm = 80;
  const baseLevel: Level = 3;
  const rhythm = metrics.rhythm ?? 62;
  const end = metrics.endurance ?? 70;
  const foc = metrics.focus ?? 70;
  const active = end < 55 && foc < 55 && rhythm < 52;
  if (!active) {
    return { active: false, bpm: baseBpm, level: baseLevel };
  }
  return {
    active: true,
    bpm: Math.max(60, baseBpm - 8),
    level: Math.max(1, baseLevel - 1) as Level,
  };
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
    (scores.agility || 0) +
    (scores.endurance || 0)
  ) / 6);
  
  return template
    .replace(/{name}/g, name)
    .replace(/{memory}/g, String(Math.round(scores.memory || 0)))
    .replace(/{comprehension}/g, String(Math.round(scores.comprehension || 0)))
    .replace(/{focus}/g, String(Math.round(scores.focus || 0)))
    .replace(/{judgment}/g, String(Math.round(scores.judgment || 0)))
    .replace(/{agility}/g, String(Math.round(scores.agility || 0)))
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
  // 명세 3.2: Seed = hash(user_id + report_version + type_name)
  const seed = hashString(`${userId}_${reportVersion}_${brainimalType}`);
  const template = REPORT_TEMPLATES[brainimalType];
  
  const modeScores = [
    { mode: 'MEMORY' as TrainingMode, score: metricsScore.memory || 0 },
    { mode: 'COMPREHENSION' as TrainingMode, score: metricsScore.comprehension || 0 },
    { mode: 'FOCUS' as TrainingMode, score: metricsScore.focus || 0 },
    { mode: 'JUDGMENT' as TrainingMode, score: metricsScore.judgment || 0 },
    { mode: 'AGILITY' as TrainingMode, score: metricsScore.agility || 0 },
    { mode: 'ENDURANCE' as TrainingMode, score: metricsScore.endurance || 0 },
  ];
  const weakest = modeScores.reduce((min, curr) => (curr.score < min.score ? curr : min));
  const recommendFull = shouldRecommendCompositeTraining(metricsScore);
  const recommendedMode: TrainingMode = recommendFull ? 'COMPOSITE' : weakest.mode;
  const fatigue = fatigueAdjustment(metricsScore);
  const recommendedBPM = fatigue.bpm;
  const recommendedLevel: Level = fatigue.level;

  const factIndex = seed % template.fact.length;
  const lifeIndex = (seed * 2) % template.life.length;
  const hintIndex = (seed * 3) % template.hint.length;

  const factText = generateSentence(template.fact[factIndex], userName, metricsScore, reportVersion);
  const lifeText = generateSentence(template.life[lifeIndex], userName, metricsScore, reportVersion);
  let hintText = generateSentence(template.hint[hintIndex], userName, metricsScore, reportVersion);
  if (recommendFull) {
    hintText += ` 육각형 프로필이 한쪽으로 치우치거나 지표 간 편차가 작아, 종합 트레이닝으로 재밸런스하는 편이 좋습니다.`;
  }
  if (fatigue.active) {
    hintText += ` 후반 피로·리듬 저하 신호가 있어 다음 세션은 BPM ${fatigue.bpm}, 레벨 ${fatigue.level}부터 시작하는 편이 안전합니다.`;
  }

  const { strength, weakness } = buildStrengthWeakness(metricsScore);
  const metricEvidenceCards = buildMetricEvidenceCards(metricsScore);
  const recommendedRoleModel = pickRoleModel(brainimalType);
  
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
    strengthText: strength,
    weaknessText: weakness,
    metricEvidenceCards,
    recommendedRoleModel,
    recommendedMode,
    recommendedBPM,
    recommendedLevel,
    createdAt: new Date().toISOString(),
  };
}

/** 기관 평균 지표용 요약 문장 (팀 이름을 name 자리에 사용) */
export function generateOrganizationNarrative(
  organizationName: string,
  brainimalType: BrainimalType,
  avgMetrics: MetricsScore,
  version: number
): { factText: string; lifeText: string; hintText: string } {
  const displayName = `${organizationName} 소속`;
  const seed = hashString(`org_${organizationName}_${version}_${brainimalType}`);
  const template = REPORT_TEMPLATES[brainimalType];
  const factIndex = seed % template.fact.length;
  const lifeIndex = (seed * 2) % template.life.length;
  const hintIndex = (seed * 3) % template.hint.length;
  return {
    factText: generateSentence(template.fact[factIndex], displayName, avgMetrics, version),
    lifeText: generateSentence(template.life[lifeIndex], displayName, avgMetrics, version),
    hintText: generateSentence(template.hint[hintIndex], displayName, avgMetrics, version),
  };
}
