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

// neutral: 일반 안내(검정 톤),
// warning: 주의가 필요한 사유(주황 톤),
// caution: 회복 가능성이 있는 환경 점검 안내(노란 톤 — Task #38 토스트와 동일).
export type TrainingAbortTone = 'neutral' | 'warning' | 'caution';

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

/**
 * BLE 단절이 누적되어 환경 점검을 권할 때 abort 배너에 덧붙이는 한 줄 (Task #43).
 * 트레이닝 화면 토스트(Task #38)와 동일한 어휘를 사용해 일관된 메시지를 전달한다.
 *  - 토스트: "기기 연결이 자주 끊겨요" (현재 진행형 — 세션 도중 안내)
 *  - abort 배너: "기기 연결이 자주 끊겼어요" (과거형 — 이미 종료된 시점에서 회고)
 */
export const TRAINING_BLE_UNSTABLE_HINT =
  '기기 연결이 자주 끊겼어요. 거리·간섭을 확인해 보세요.';

/**
 * abort 사유 + 부가 신호로부터 최종 안내(메시지/톤)를 만든다.
 *
 * Task #43:
 *  - reason === 'ble-disconnect' 이고 bleUnstable === true 면 환경 점검 한 줄을
 *    줄바꿈으로 덧붙이고 톤을 'caution'(노란 톤)으로 바꾼다.
 *    → 이 경우는 한 세션에서 회복 시도가 누적된 흔적이 있어 사용자가 즉시 취할 수
 *      있는 행동(가까이 두기 / 간섭원 제거)이 있다.
 *  - bleUnstable 이 false 거나 다른 사유면 기존 사전 항목을 그대로 사용한다.
 *    → 첫 단절 즉시 종료된 케이스는 기존의 일반 안내만 보여준다.
 */
export function getTrainingAbortNotice(
  reason: TrainingAbortReason,
  opts?: { bleUnstable?: boolean },
): TrainingAbortNotice {
  const base = TRAINING_ABORT_NOTICE[reason];
  if (reason === 'ble-disconnect' && opts?.bleUnstable) {
    return {
      message: `${base.message}\n${TRAINING_BLE_UNSTABLE_HINT}`,
      tone: 'caution',
    };
  }
  return base;
}

export function isTrainingAbortReason(v: unknown): v is TrainingAbortReason {
  return v === 'background' || v === 'ble-disconnect' || v === 'save-failed';
}

/**
 * 회복 통계가 abort 시점에 환경 점검 안내를 덧붙일 임계를 넘었는지 판정 (Task #43).
 *  - 회복 구간이 1회 이상 시작되었거나
 *  - 회복 누적 시간이 5초 이상이면 true.
 *
 * 트레이닝 화면 안내 토스트(Task #38)는 더 보수적인 임계(3회 / 15s)를 쓰지만,
 * abort 시점에는 "이미 끝나버린 세션"이므로 사용자가 다음 행동을 바로 잡도록
 * 좀 더 낮은 임계로 안내한다.
 */
export const TRAINING_BLE_UNSTABLE_WINDOW_THRESHOLD = 1;
export const TRAINING_BLE_UNSTABLE_MS_THRESHOLD = 5_000;

export function isBleUnstableForAbort(stats: { windows: number; totalMs: number } | null | undefined): boolean {
  if (!stats) return false;
  return (
    stats.windows >= TRAINING_BLE_UNSTABLE_WINDOW_THRESHOLD ||
    stats.totalMs >= TRAINING_BLE_UNSTABLE_MS_THRESHOLD
  );
}
