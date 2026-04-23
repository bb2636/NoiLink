/**
 * 트레이닝 목록 — shared TRAINING_CATALOG + 웹용 이미지(실사 사진)
 */
import {
  TRAINING_CATALOG,
  trainingCatalogById,
  type TrainingCatalogEntry,
  type TrainingCatalogId,
} from '@noilink/shared';
import compositeImg from '../assets/training/composite.jpg';
import memoryImg from '../assets/training/memory.jpg';
import comprehensionImg from '../assets/training/comprehension.jpg';
import focusImg from '../assets/training/focus.jpg';
import judgmentImg from '../assets/training/judgment.jpg';
import agilityImg from '../assets/training/agility.jpg';
import enduranceImg from '../assets/training/endurance.jpg';
import randomImg from '../assets/training/random.jpg';
import freeImg from '../assets/training/free.jpg';

const IMAGES: Record<TrainingCatalogId, string> = {
  COMPOSITE: compositeImg,
  MEMORY: memoryImg,
  COMPREHENSION: comprehensionImg,
  FOCUS: focusImg,
  JUDGMENT: judgmentImg,
  AGILITY: agilityImg,
  ENDURANCE: enduranceImg,
  RANDOM: randomImg,
  FREE: freeImg,
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
