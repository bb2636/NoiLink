/**
 * 트레이닝이 의도치 않게 종료된 사유와, 목록 화면에서 1회성으로 보여줄 안내 정보.
 *
 * 흐름:
 *  - TrainingSessionPlay.tsx 가 비정상 종료 시점에 navigate state로 reason 을 전달
 *  - Training.tsx 가 마운트될 때 reason 을 읽어 SuccessBanner 메시지/톤을 결정
 *  - 정상 종료(결과 화면 이동)나 사용자가 직접 취소(뒤로/취소)한 경우에는 reason 을 넣지 않는다
 *
 * 새로운 사유를 추가할 때는 이 모듈에만 항목을 더하면 된다 — 두 화면이 동일한 사전을 공유하므로
 * 메시지/톤이 어긋날 일이 없다.
 */

export type TrainingAbortReason =
  | 'background'        // 앱이 백그라운드로 들어가 즉시 종료됨
  | 'ble-disconnect'    // NoiPod(BLE) 기기와의 연결이 끊김
  | 'save-failed';      // 결과 제출 실패 후 사용자가 재시도 없이 화면을 떠남

export type TrainingAbortTone = 'neutral' | 'warning';

export interface TrainingAbortNotice {
  message: string;
  tone: TrainingAbortTone;
}

export const TRAINING_ABORT_NOTICE: Record<TrainingAbortReason, TrainingAbortNotice> = {
  background: {
    message: '화면을 가린 동안 트레이닝이 중단되었어요. 다시 시작해 주세요.',
    tone: 'neutral',
  },
  'ble-disconnect': {
    message: 'NoiPod 기기 연결이 끊겨 트레이닝이 종료되었어요. 기기 상태를 확인하고 다시 시작해 주세요.',
    tone: 'warning',
  },
  'save-failed': {
    message: '결과를 저장하지 못해 트레이닝이 종료되었어요. 네트워크 상태를 확인하고 다시 시도해 주세요.',
    tone: 'warning',
  },
};

export function isTrainingAbortReason(v: unknown): v is TrainingAbortReason {
  return v === 'background' || v === 'ble-disconnect' || v === 'save-failed';
}
