/**
 * 트레이닝 목록 — shared TRAINING_CATALOG + 웹용 이미지
 */
import {
  TRAINING_CATALOG,
  trainingCatalogById,
  type TrainingCatalogEntry,
  type TrainingCatalogId,
} from '@noilink/shared';

const IMAGES: Record<TrainingCatalogId, string> = {
  COMPOSITE:
    'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=400&h=250&fit=crop',
  MEMORY:
    'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400&h=250&fit=crop',
  COMPREHENSION:
    'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&h=250&fit=crop',
  FOCUS:
    'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=400&h=250&fit=crop',
  JUDGMENT:
    'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=400&h=250&fit=crop',
  AGILITY:
    'https://images.unsplash.com/photo-1461896836934-7b7a7b673ffb?w=400&h=250&fit=crop',
  ENDURANCE:
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=250&fit=crop',
  RANDOM:
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&h=250&fit=crop',
  FREE:
    'https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=400&h=250&fit=crop',
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
