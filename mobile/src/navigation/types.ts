import type { Level } from '@noilink/shared';
import type { TrainingListId } from '../training/trainingConfig';

export type RootStackParamList = {
  /** 프로덕션 진입 — 풀스크린 WebView */
  WebShell: undefined;
  /** 레거시 네이티브 전용 화면(스택에서 제외 가능) */
  Login: undefined;
  TrainingList: undefined;
  TrainingSetup: { trainingId: TrainingListId };
  DeviceScan: undefined;
  BleScreen: undefined;
  TrainingSession: {
    trainingId: TrainingListId;
    totalDurationSec: number;
    bpm: number;
    level: Level;
    yieldsScore: boolean;
  };
  TrainingResult: {
    score?: number;
    trainingTitle: string;
    deltaFromPrevious?: number;
    noScore?: boolean;
    sessionId?: string;
    syncNote?: string;
  };
};
