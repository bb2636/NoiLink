/**
 * outcome notice 안내 문구 회귀 테스트.
 *
 * 보호 항목:
 *  - success 시 일반 톤은 "백그라운드에서 안전하게 저장했어요" 로 유지된다.
 *  - 서버 idempotency 캐시 hit 으로 흡수된 success(replayed: true)는
 *    "이미 저장되어 있었어요. 다시 확인했어요" 로 톤이 바뀌어
 *    사용자가 같은 결과가 두 건 저장된 게 아닌지 헷갈리지 않게 한다 (Task #65).
 *  - final-failure 톤은 replayed 와 무관하게 동일한 안내 문구를 사용한다.
 */
import { describe, expect, it } from 'vitest';
import { formatOutcomeNoticeMessage } from '../outcomeNoticeDisplay';
import type { PendingTrainingOutcome } from '../pendingTrainingRuns';

const baseSuccess: PendingTrainingOutcome = {
  localId: 'pending-1',
  outcome: 'success',
  title: '집중력',
  at: 0,
};

describe('formatOutcomeNoticeMessage', () => {
  it('일반 success 는 "안전하게 저장" 톤을 사용한다', () => {
    const msg = formatOutcomeNoticeMessage(baseSuccess);
    expect(msg).toContain('안전하게 저장');
    expect(msg).toContain("'집중력'");
  });

  it('replayed 가 true 면 "이미 저장" 톤으로 바뀐다 (Task #65)', () => {
    const msg = formatOutcomeNoticeMessage({ ...baseSuccess, replayed: true });
    expect(msg).toContain('이미 저장되어 있었어요');
    expect(msg).toContain('다시 확인했어요');
    expect(msg).not.toContain('안전하게 저장');
  });

  it('title 이 없어도 replayed 안내 문구가 자연스럽게 구성된다', () => {
    const msg = formatOutcomeNoticeMessage({ ...baseSuccess, title: undefined, replayed: true });
    expect(msg).toContain('이미 저장되어 있었어요');
  });

  it('final-failure 는 replayed 여부와 무관하게 같은 문구를 사용한다 (의미 없는 신호)', () => {
    const a = formatOutcomeNoticeMessage({
      ...baseSuccess,
      outcome: 'final-failure',
      lastError: 'down',
    });
    const b = formatOutcomeNoticeMessage({
      ...baseSuccess,
      outcome: 'final-failure',
      lastError: 'down',
      replayed: true,
    });
    expect(a).toBe(b);
    expect(a).toContain('끝내 저장하지 못했어요');
  });
});
