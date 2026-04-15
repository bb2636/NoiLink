import type { Level } from '@noilink/shared';
import type { TrainingListId } from '../training/trainingConfig';

export type RootStackParamList = {
  Login: undefined;
  TrainingList: undefined;
  TrainingSetup: { trainingId: TrainingListId };
  DeviceScan: undefined;
  TrainingSession: {
    trainingId: TrainingListId;
    /** 실제 진행 시간(초). 공통 상한 300초. */
    totalDurationSec: number;
    bpm: number;
    level: Level;
    yieldsScore: boolean;
  };
  TrainingResult: {
    score?: number;
    trainingTitle: string;
    deltaFromPrevious?: number;
    /** 자유 트레이닝 등 점수 미산출 */
    noScore?: boolean;
    sessionId?: string;
    /** 서버 동기화 실패 시 안내 */
    syncNote?: string;
  };
};
