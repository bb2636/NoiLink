/**
 * 트레이닝 목록 공통 설정 (목록 + 상세 페이지에서 사용)
 */
export const TRAINING_LIST = [
  {
    id: 'TAU',
    title: '좌우 통합',
    desc: '좌우 자극을 균형 있게 제공하여 반응 능력을 향상합니다.',
    image: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=400&h=250&fit=crop',
  },
  {
    id: 'NELAB',
    title: '랜덤',
    desc: '완전한 랜덤 자극을 통해 반응 속도와 타이밍을 훈련합니다.',
    image: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=250&fit=crop',
  },
  {
    id: 'MEMORY',
    title: '시퀀스',
    desc: '제시된 순서를 기억하고 재현하는 훈련입니다.',
    image: 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400&h=250&fit=crop',
  },
  {
    id: 'FOCUS',
    title: '포커스',
    desc: '집중 타겟 유지 및 방해 요소 차단 능력을 강화합니다.',
    image: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=400&h=250&fit=crop',
  },
] as const;
