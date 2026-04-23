/**
 * 트레이닝 목록 — shared TRAINING_CATALOG + 웹용 이미지
 */
import {
  TRAINING_CATALOG,
  trainingCatalogById,
  type TrainingCatalogEntry,
  type TrainingCatalogId,
} from '@noilink/shared';

/**
 * 트레이닝 카드 배경 — 외부 호스팅 차단/네트워크 이슈에 영향받지 않도록
 * 인라인 SVG data URI 그라데이션으로 대체.
 */
function gradientSvg(c1: string, c2: string, label: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 250'>
    <defs>
      <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0%' stop-color='${c1}'/>
        <stop offset='100%' stop-color='${c2}'/>
      </linearGradient>
    </defs>
    <rect width='400' height='250' fill='url(#g)'/>
    <text x='50%' y='50%' fill='rgba(255,255,255,0.65)' font-family='sans-serif' font-size='44' font-weight='700' text-anchor='middle' dominant-baseline='middle'>${label}</text>
  </svg>`;
  // CSS url() 무인용 컨텍스트에서도 안전하도록 작은따옴표/괄호까지 추가 인코딩
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
  return `data:image/svg+xml;utf8,${encoded}`;
}

const IMAGES: Record<TrainingCatalogId, string> = {
  COMPOSITE: gradientSvg('#AAED10', '#264213', '종합'),
  MEMORY: gradientSvg('#3B82F6', '#1E3A8A', '기억력'),
  COMPREHENSION: gradientSvg('#2DD4BF', '#0F766E', '이해력'),
  FOCUS: gradientSvg('#F59E0B', '#92400E', '집중력'),
  JUDGMENT: gradientSvg('#EF4444', '#7F1D1D', '판단력'),
  AGILITY: gradientSvg('#84CC16', '#365314', '순발력'),
  ENDURANCE: gradientSvg('#A78BFA', '#4C1D95', '지구력'),
  RANDOM: gradientSvg('#F472B6', '#831843', '랜덤'),
  FREE: gradientSvg('#9CA3AF', '#1F2937', '자유'),
};

export type TrainingListRow = TrainingCatalogEntry & { image: string };

export const TRAINING_LIST: TrainingListRow[] = TRAINING_CATALOG.map((entry) => ({
  ...entry,
  image: IMAGES[entry.id],
}));

/** 구 URL 호환: TAU→종합, NELAB→랜덤 */
export const TRAINING_BY_ID: Record<string, TrainingListRow> = {
  ...Object.fromEntries(TRAINING_LIST.map((t) => [t.id, t])),
  TAU: {
    ...trainingCatalogById.COMPOSITE,
    image: IMAGES.COMPOSITE,
  },
  NELAB: {
    ...trainingCatalogById.RANDOM,
    image: IMAGES.RANDOM,
  },
};
