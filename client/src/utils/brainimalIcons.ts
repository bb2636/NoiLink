/**
 * 브레이니멀 타입별 아이콘 및 정보
 */

import type { BrainimalType } from '@noilink/shared';

export interface BrainimalInfo {
  emoji: string;
  name: string;
  description: string;
  color: string;
}

export const BRAINIMAL_INFO: Record<BrainimalType, BrainimalInfo> = {
  OWL_FOCUS: {
    emoji: '🦉',
    name: '집중하는 부엉이',
    description: '방해 요소를 잘 걸러내고 중요한 일에 집중하는 능력이 뛰어납니다.',
    color: '#8b5cf6',
  },
  CHEETAH_JUDGMENT: {
    emoji: '🐆',
    name: '판단력의 치타',
    description: '빠르고 정확한 의사결정 능력이 뛰어납니다.',
    color: '#f59e0b',
  },
  BEAR_ENDURANCE: {
    emoji: '🐻',
    name: '끈기있는 곰',
    description: '장시간 집중력을 유지하는 능력이 뛰어납니다.',
    color: '#92400e',
  },
  DOLPHIN_BRILLIANT: {
    emoji: '🐬',
    name: '명석한 돌고래',
    description: '기억력과 이해력이 모두 뛰어나 학습 능력이 탁월합니다.',
    color: '#06b6d4',
  },
  TIGER_STRATEGIC: {
    emoji: '🐅',
    name: '전략적인 호랑이',
    description: '이해력과 멀티태스킹 능력이 뛰어나 전략적 사고가 우수합니다.',
    color: '#dc2626',
  },
  FOX_BALANCED: {
    emoji: '🦊',
    name: '균형적인 여우',
    description: '모든 지표가 고르게 발달되어 있어 안정적인 능력을 보입니다.',
    color: '#ea580c',
  },
  CAT_DELICATE: {
    emoji: '🐱',
    name: '섬세한 고양이',
    description: '기억력이 뛰어나고 세부사항에 집중하는 능력이 우수합니다.',
    color: '#7c3aed',
  },
  EAGLE_INSIGHT: {
    emoji: '🦅',
    name: '통찰력의 독수리',
    description: '이해력이 뛰어나 규칙 변화에 빠르게 적응합니다.',
    color: '#0891b2',
  },
  LION_BOLD: {
    emoji: '🦁',
    name: '대담한 사자',
    description: '판단력이 뛰어나고 신속한 결정을 내립니다.',
    color: '#d97706',
  },
  DOG_SOCIAL: {
    emoji: '🐶',
    name: '사회적인 강아지',
    description: '멀티태스킹 능력이 뛰어나 여러 작업을 동시에 처리합니다.',
    color: '#ca8a04',
  },
  KOALA_CALM: {
    emoji: '🐨',
    name: '침착한 코알라',
    description: '안정적이고 일관된 수행을 보이며 신뢰할 수 있는 능력을 갖추고 있습니다.',
    color: '#16a34a',
  },
  WOLF_CREATIVE: {
    emoji: '🐺',
    name: '창의적인 늑대',
    description: '기억력과 멀티태스킹 능력이 뛰어나 창의적인 해결책을 만들어냅니다.',
    color: '#1e40af',
  },
};

/**
 * 브레이니멀 타입별 아이콘 가져오기
 */
export function getBrainimalIcon(type: BrainimalType): BrainimalInfo {
  return BRAINIMAL_INFO[type];
}

/**
 * 기본 아이콘 (검사 전)
 */
export const DEFAULT_BRAINIMAL = {
  emoji: '🥚',
  name: '알',
  description: '검사를 완료하면 브레이니멀 타입이 결정됩니다.',
  color: '#9ca3af',
};
