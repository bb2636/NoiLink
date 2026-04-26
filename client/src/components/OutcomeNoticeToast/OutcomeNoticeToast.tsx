/**
 * 글로벌 outcome notice 토스트 (Task #72).
 *
 * 어떤 화면에 있든, 백그라운드 drain 이 결과(success / final-failure)를 결정하는
 * 순간 1회성 토스트로 즉시 알려준다. 사용자가 "결과가 보냈는지 안 보냈는지" 확인하기
 * 위해 트레이닝 목록 화면으로 이동할 필요가 없게 한다.
 *
 * 동작:
 *  - 마운트 시 outcome push 이벤트를 구독한다.
 *  - push 가 들어오면:
 *      1) 영속 큐에서 같은 localId 항목을 즉시 제거한다(removeOutcomeNotice).
 *         → 다음에 트레이닝 목록 화면(Training.tsx)이 마운트되어
 *           popOutcomeNotices 로 큐를 비우더라도 같은 결과가 두 번 노출되지 않는다.
 *      2) 화면 안 큐에 추가하고 한 번에 하나씩 SuccessBanner 로 보여준다.
 *  - 토스트는 fixed 포지션에서 자동으로 닫히며(autoClose), 사용자 액션을 막지 않는다.
 *
 * 마운트 위치: AppRoutes 의 최상단(라우트 변경에도 unmount 되지 않음)
 *  → 라우트 전환 직후 push 가 들어와도 구독이 유지되어 토스트가 정상적으로 뜬다.
 */
import { useEffect, useState } from 'react';
import SuccessBanner from '../SuccessBanner/SuccessBanner';
import {
  removeOutcomeNotice,
  subscribeOutcomeNotices,
  type PendingTrainingOutcome,
} from '../../utils/pendingTrainingRuns';
import {
  formatOutcomeNoticeMessage,
  getOutcomeNoticeStyle,
} from '../../utils/outcomeNoticeDisplay';

export default function OutcomeNoticeToast() {
  // 한 번에 하나만 노출하기 위한 in-memory 큐.
  // 같은 localId 가 다시 들어오면(드물지만 상태가 바뀐 후 재 push 가능) 가장 최신 상태로
  // 갱신해 사용자가 옛 메시지를 보지 않게 한다.
  const [queue, setQueue] = useState<PendingTrainingOutcome[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeOutcomeNotices((notice) => {
      // 영속 큐에서 즉시 제거 — 트레이닝 목록 화면 진입 시 같은 결과가 다시 안내되지 않게.
      removeOutcomeNotice(notice.localId);
      setQueue((prev) => {
        const without = prev.filter((n) => n.localId !== notice.localId);
        return [...without, notice];
      });
    });
    return unsubscribe;
  }, []);

  const active = queue[0];
  const style = active ? getOutcomeNoticeStyle(active) : null;

  const dismissActive = () => {
    setQueue((prev) => prev.slice(1));
  };

  return (
    <SuccessBanner
      // key 변경으로 SuccessBanner 내부 setTimeout(autoClose) 가 새 토스트마다 재시작되도록 한다.
      key={active?.localId ?? 'none'}
      isOpen={!!active}
      message={active ? formatOutcomeNoticeMessage(active) : ''}
      onClose={dismissActive}
      autoClose
      duration={4000}
      backgroundColor={style?.background}
      textColor={style?.text}
    />
  );
}
