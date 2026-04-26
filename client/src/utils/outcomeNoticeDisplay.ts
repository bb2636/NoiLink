/**
 * 백그라운드 결과 저장 안내(success / final-failure)에 쓰이는 메시지·톤을 한 곳에서 정의한다.
 *
 * 같은 결과가 두 위치에서 노출될 수 있다:
 *  - 글로벌 토스트(OutcomeNoticeToast): 어떤 화면에 있어도 push 직후 즉시 노출.
 *  - 트레이닝 목록 화면(Training.tsx) 진입 시 popOutcomeNotices 로 비워서 노출.
 *
 * 두 경로가 각자 문구·색상을 복제해 두면 한쪽만 바뀔 때 안내 톤이 어긋날 수 있어,
 * 공유 헬퍼로 묶어 항상 같은 메시지/색상으로 노출되도록 한다.
 */
import type { PendingTrainingOutcome } from './pendingTrainingRuns';

export interface OutcomeNoticeStyle {
  background: string;
  text: string;
}

// success: 초록 톤(저장 성공) / final-failure: 주황 톤(주의 — 사용자가 직접 다시 시도해야 할 가능성).
export const OUTCOME_NOTICE_STYLE: Record<
  PendingTrainingOutcome['outcome'],
  OutcomeNoticeStyle
> = {
  success: { background: '#1E2F1A', text: '#AAED10' },
  'final-failure': { background: '#F59E0B', text: '#1A1A1A' },
};

export function getOutcomeNoticeStyle(o: PendingTrainingOutcome): OutcomeNoticeStyle {
  return OUTCOME_NOTICE_STYLE[o.outcome];
}

export function formatOutcomeNoticeMessage(o: PendingTrainingOutcome): string {
  const what = o.title ? `'${o.title}'` : '이전';
  if (o.outcome === 'success') {
    return `${what} 트레이닝 결과를 백그라운드에서 안전하게 저장했어요.`;
  }
  return `${what} 트레이닝 결과를 끝내 저장하지 못했어요. 네트워크가 안정될 때 다시 시도해 주세요.`;
}
