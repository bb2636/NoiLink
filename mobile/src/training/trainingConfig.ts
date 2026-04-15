import {
  TRAINING_CATALOG,
  trainingCatalogById,
  type TrainingCatalogId,
} from '@noilink/shared';

export type TrainingListId = TrainingCatalogId;

export const TRAINING_LIST = TRAINING_CATALOG;
export const trainingById = trainingCatalogById;
