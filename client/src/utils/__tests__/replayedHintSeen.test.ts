/**
 * 결과 화면 replayed 힌트의 (userId, sessionId) 기준 "본 적 있음" 영속화 유닛 테스트
 * (Task #118 + Task #133).
 *
 * 보호하는 동작:
 *  - 같은 (userId, sessionId) 를 mark 한 뒤에는 hasSeen 이 true 를 반환한다.
 *  - 다른 sessionId 는 영향을 받지 않는다 (=세션 단위 분리).
 *  - 다른 userId 는 영향을 받지 않는다 (=사용자 단위 분리, Task #133).
 *  - sessionId 또는 userId 가 빈 값(null/undefined/'') 이면 추적이 비활성화돼 항상 false.
 *  - clearAll 후에는 같은 prefix 의 모든 사용자 키가 비워져 다시 false.
 *  - localStorage 가 throw 해도 앱이 죽지 않는다 (조용히 폴백).
 *  - 손상된 JSON / 이상한 배열 항목은 무시되고 false 로 폴백한다.
 *  - 누적 상한(REPLAYED_HINT_MAX_ENTRIES)을 넘기면 가장 오래된 항목부터 떨어진다 (사용자 키 단위).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REPLAYED_HINT_MAX_ENTRIES,
  REPLAYED_HINT_RETENTION_MS,
  cleanupExpiredReplayedHintSeen,
  clearAllReplayedHintSeen,
  hasSeenReplayedHint,
  markReplayedHintSeen,
  replayedHintSeenKey,
} from '../replayedHintSeen';

const KEY_U1 = 'noilink:replayed-hint-seen:u-1';
const KEY_U2 = 'noilink:replayed-hint-seen:u-2';

describe('replayedHintSeen', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('기본 상태는 본 적 없음(false)', () => {
    expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(false);
  });

  it('mark 후에는 같은 (userId, sessionId) 가 본 적 있음(true)으로 평가된다', () => {
    markReplayedHintSeen('u-1', 'sess-a');
    expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(true);
  });

  it('다른 sessionId 는 영향을 받지 않는다 (세션 단위 분리)', () => {
    markReplayedHintSeen('u-1', 'sess-a');
    expect(hasSeenReplayedHint('u-1', 'sess-b')).toBe(false);
  });

  it('다른 userId 는 영향을 받지 않는다 (사용자 단위 분리, Task #133)', () => {
    markReplayedHintSeen('u-1', 'sess-a');
    // 같은 sessionId 라도 다른 사용자 버킷에서는 본 적 없음.
    expect(hasSeenReplayedHint('u-2', 'sess-a')).toBe(false);
    // 그리고 u-2 가 mark 해도 u-1 의 기억은 그대로 유지된다.
    markReplayedHintSeen('u-2', 'sess-a');
    expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(true);
    expect(hasSeenReplayedHint('u-2', 'sess-a')).toBe(true);
    // 두 사용자의 키가 물리적으로 분리되어 있어야 한다.
    expect(localStorage.getItem(KEY_U1)).not.toBeNull();
    expect(localStorage.getItem(KEY_U2)).not.toBeNull();
  });

  it('sessionId 가 비어 있으면 추적 비활성화 (항상 false / 저장도 하지 않음)', () => {
    markReplayedHintSeen('u-1', null);
    markReplayedHintSeen('u-1', undefined);
    markReplayedHintSeen('u-1', '');
    expect(hasSeenReplayedHint('u-1', null)).toBe(false);
    expect(hasSeenReplayedHint('u-1', undefined)).toBe(false);
    expect(hasSeenReplayedHint('u-1', '')).toBe(false);
    // 저장소도 비어 있어야 한다.
    expect(localStorage.getItem(KEY_U1)).toBeNull();
  });

  it('userId 가 비어 있으면 추적 비활성화 (항상 false / 저장도 하지 않음, Task #133)', () => {
    markReplayedHintSeen(null, 'sess-a');
    markReplayedHintSeen(undefined, 'sess-a');
    markReplayedHintSeen('', 'sess-a');
    expect(hasSeenReplayedHint(null, 'sess-a')).toBe(false);
    expect(hasSeenReplayedHint(undefined, 'sess-a')).toBe(false);
    expect(hasSeenReplayedHint('', 'sess-a')).toBe(false);
    // 저장소에 prefix 키가 만들어지지 않아야 한다.
    expect(localStorage.length).toBe(0);
  });

  it('replayedHintSeenKey 는 userId 가 비어 있으면 null 을 반환한다', () => {
    expect(replayedHintSeenKey(null)).toBeNull();
    expect(replayedHintSeenKey(undefined)).toBeNull();
    expect(replayedHintSeenKey('')).toBeNull();
    expect(replayedHintSeenKey('u-1')).toBe(KEY_U1);
  });

  it('clearAllReplayedHintSeen 후에는 prefix 의 모든 사용자 키가 비워진다', () => {
    markReplayedHintSeen('u-1', 'sess-a');
    markReplayedHintSeen('u-2', 'sess-b');
    expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(true);
    expect(hasSeenReplayedHint('u-2', 'sess-b')).toBe(true);
    const removed = clearAllReplayedHintSeen();
    expect(removed).toBe(2);
    expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(false);
    expect(hasSeenReplayedHint('u-2', 'sess-b')).toBe(false);
    expect(localStorage.getItem(KEY_U1)).toBeNull();
    expect(localStorage.getItem(KEY_U2)).toBeNull();
  });

  it('clearAllReplayedHintSeen 은 같은 prefix 가 아닌 키는 건드리지 않는다', () => {
    localStorage.setItem('noilink:other-feature', 'keep-me');
    markReplayedHintSeen('u-1', 'sess-a');
    clearAllReplayedHintSeen();
    expect(localStorage.getItem('noilink:other-feature')).toBe('keep-me');
  });

  it('localStorage.setItem 가 throw 해도 mark 가 앱을 깨뜨리지 않는다', () => {
    const setSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });
    expect(() => markReplayedHintSeen('u-1', 'sess-a')).not.toThrow();
    setSpy.mockRestore();
  });

  it('localStorage.getItem 가 throw 해도 hasSeen 은 false 로 안전하게 폴백한다', () => {
    const getSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(false);
    getSpy.mockRestore();
  });

  it('손상된 JSON 은 무시되고 false 로 폴백한다', () => {
    localStorage.setItem(KEY_U1, '{not-valid-json');
    expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(false);
    // 그리고 mark 가 정상 동작해 손상된 값을 덮어써야 한다.
    markReplayedHintSeen('u-1', 'sess-a');
    expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(true);
  });

  it('배열이 아닌 JSON 값은 빈 목록으로 간주된다', () => {
    localStorage.setItem(KEY_U1, '{"id":"sess-a","at":1}');
    expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(false);
  });

  it('이상한 배열 항목은 필터링된다', () => {
    localStorage.setItem(
      KEY_U1,
      JSON.stringify([
        { id: 'sess-a', at: 1 }, // 정상
        { id: 'sess-b' }, // at 누락
        null,
        'string',
        { at: 5 }, // id 누락
      ]),
    );
    expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(true);
    expect(hasSeenReplayedHint('u-1', 'sess-b')).toBe(false);
  });

  it('상한(REPLAYED_HINT_MAX_ENTRIES)을 넘기면 가장 오래된 항목부터 제거된다 (사용자 키 단위)', () => {
    for (let i = 0; i < REPLAYED_HINT_MAX_ENTRIES + 5; i += 1) {
      markReplayedHintSeen('u-1', `sess-${i}`, 1_000 + i);
    }
    // 처음 5개는 밀려나 false.
    expect(hasSeenReplayedHint('u-1', 'sess-0')).toBe(false);
    expect(hasSeenReplayedHint('u-1', 'sess-4')).toBe(false);
    // 그 이후는 살아 있어야 한다.
    expect(hasSeenReplayedHint('u-1', 'sess-5')).toBe(true);
    expect(hasSeenReplayedHint('u-1', `sess-${REPLAYED_HINT_MAX_ENTRIES + 4}`)).toBe(true);
  });

  it('상한은 사용자 키 단위로 적용된다 — 다른 사용자에 영향 없음', () => {
    for (let i = 0; i < REPLAYED_HINT_MAX_ENTRIES + 5; i += 1) {
      markReplayedHintSeen('u-1', `sess-${i}`, 1_000 + i);
    }
    // u-2 가 별개로 mark 한 항목은 u-1 의 LRU 와 무관하게 살아 있다.
    markReplayedHintSeen('u-2', 'sess-only-u2', 9_999);
    expect(hasSeenReplayedHint('u-2', 'sess-only-u2')).toBe(true);
  });

  it('같은 (userId, sessionId) 를 다시 mark 해도 중복 누적 없이 갱신된다', () => {
    markReplayedHintSeen('u-1', 'sess-a', 1_000);
    markReplayedHintSeen('u-1', 'sess-a', 2_000);
    const raw = localStorage.getItem(KEY_U1);
    expect(raw).not.toBeNull();
    const arr = JSON.parse(raw!);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.filter((e: { id: string }) => e.id === 'sess-a').length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Task #134 — 오래된 sessionId 기억 자동 정리 (사용자별 prefix 키 위에서)
  // ---------------------------------------------------------------------------

  describe('cleanupExpiredReplayedHintSeen (시간 만료 정리)', () => {
    it('보존 한도(기본 30일) 안의 엔트리는 그대로 둔다', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('u-1', 'sess-fresh', now - 1_000); // 갓 표시
      markReplayedHintSeen('u-1', 'sess-edge', now - REPLAYED_HINT_RETENTION_MS + 1_000); // 한도 직전

      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(0);
      expect(hasSeenReplayedHint('u-1', 'sess-fresh')).toBe(true);
      expect(hasSeenReplayedHint('u-1', 'sess-edge')).toBe(true);
    });

    it('보존 한도를 초과한 엔트리는 제거되고 최근 기억만 남는다', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('u-1', 'sess-stale', now - REPLAYED_HINT_RETENTION_MS - 1_000);
      markReplayedHintSeen('u-1', 'sess-fresh', now - 1_000);

      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(1);
      expect(hasSeenReplayedHint('u-1', 'sess-stale')).toBe(false);
      expect(hasSeenReplayedHint('u-1', 'sess-fresh')).toBe(true);
    });

    it('만료/미만료 경계: 정확히 retentionMs 인 엔트리는 보존, 1ms 더 오래되면 제거', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('u-1', 'sess-on-edge', now - REPLAYED_HINT_RETENTION_MS); // 정확히 경계
      markReplayedHintSeen('u-1', 'sess-just-past', now - REPLAYED_HINT_RETENTION_MS - 1); // 1ms 초과

      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(1);
      expect(hasSeenReplayedHint('u-1', 'sess-on-edge')).toBe(true);
      expect(hasSeenReplayedHint('u-1', 'sess-just-past')).toBe(false);
    });

    it('미래 타임스탬프(시계 변경) 엔트리도 제거한다', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('u-1', 'sess-future', now + 60_000);
      markReplayedHintSeen('u-1', 'sess-now', now);

      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(1);
      expect(hasSeenReplayedHint('u-1', 'sess-future')).toBe(false);
      expect(hasSeenReplayedHint('u-1', 'sess-now')).toBe(true);
    });

    it('손상된 JSON 은 정리되어 다음 read 가 깨끗한 상태로 시작한다', () => {
      localStorage.setItem(KEY_U1, '{not-valid-json');

      // 호출이 throw 하지 않고 정리된다.
      expect(() => cleanupExpiredReplayedHintSeen()).not.toThrow();

      // 손상된 raw 값이 정규 직렬화로 덮어써져 빈 배열이 되거나 키가 제거됐다.
      // 손상된 JSON → readEntries() 가 [] 반환 → fresh 도 [] → 키 제거.
      expect(localStorage.getItem(KEY_U1)).toBeNull();
    });

    it('배열이 아닌 JSON 값도 안전하게 정리된다', () => {
      localStorage.setItem(KEY_U1, '{"id":"sess-a","at":1}');

      cleanupExpiredReplayedHintSeen();

      // 배열이 아니므로 readEntries() → [] → 빈 결과 → 키 제거.
      expect(localStorage.getItem(KEY_U1)).toBeNull();
    });

    it('이상한 배열 항목은 무시되고 정상 항목만 남는다', () => {
      const now = 100_000_000_000;
      localStorage.setItem(
        KEY_U1,
        JSON.stringify([
          { id: 'sess-good', at: now - 1_000 }, // 정상, 보존
          { id: 'sess-old', at: now - REPLAYED_HINT_RETENTION_MS - 1 }, // 만료
          { id: 'sess-no-at' }, // at 누락
          null,
          'string',
          { at: now - 1_000 }, // id 누락
        ]),
      );

      cleanupExpiredReplayedHintSeen(now);

      expect(hasSeenReplayedHint('u-1', 'sess-good')).toBe(true);
      expect(hasSeenReplayedHint('u-1', 'sess-old')).toBe(false);
      // 손상/이상한 항목은 모두 사라져 정규 형태만 남는다.
      const raw = localStorage.getItem(KEY_U1);
      expect(raw).not.toBeNull();
      const arr = JSON.parse(raw!) as Array<{ id: string; at: number }>;
      expect(arr).toEqual([{ id: 'sess-good', at: now - 1_000 }]);
    });

    it('아무 키도 없으면 0 반환, 쓰기도 발생하지 않는다', () => {
      const setSpy = vi.spyOn(Storage.prototype, 'setItem');
      const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');

      expect(cleanupExpiredReplayedHintSeen()).toBe(0);
      expect(setSpy).not.toHaveBeenCalled();
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('전부 보존 대상이면 변화 없음 — 쓰기조차 발생하지 않는다', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('u-1', 'sess-a', now - 1_000);
      markReplayedHintSeen('u-1', 'sess-b', now - 2_000);

      const setSpy = vi.spyOn(Storage.prototype, 'setItem');
      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(0);
      expect(setSpy).not.toHaveBeenCalled();
    });

    it('retentionMs 인자로 보존 한도를 좁힐 수 있다', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('u-1', 'sess-a', now - 5_000);
      markReplayedHintSeen('u-1', 'sess-b', now - 500);

      // 1초 보존 한도 → 5초 묵은 sess-a 만 만료.
      const removed = cleanupExpiredReplayedHintSeen(now, 1_000);

      expect(removed).toBe(1);
      expect(hasSeenReplayedHint('u-1', 'sess-a')).toBe(false);
      expect(hasSeenReplayedHint('u-1', 'sess-b')).toBe(true);
    });

    it('localStorage.getItem 가 throw 해도 0 반환하고 앱이 죽지 않는다', () => {
      // listReplayedHintKeys 가 적어도 한 키는 보도록 사전에 마크해 둔다 —
      // 그래야 함수가 getItem 까지 시도하고 그 throw 가 try/catch 로 막힌다.
      markReplayedHintSeen('u-1', 'sess-a');

      const getSpy = vi
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new Error('blocked');
        });

      expect(() => cleanupExpiredReplayedHintSeen()).not.toThrow();
      expect(cleanupExpiredReplayedHintSeen()).toBe(0);
      getSpy.mockRestore();
    });

    it('removeItem 이 throw 해도 정리 호출이 throw 하지 않는다', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('u-1', 'sess-only', now - REPLAYED_HINT_RETENTION_MS - 1_000);

      const removeSpy = vi
        .spyOn(Storage.prototype, 'removeItem')
        .mockImplementation(() => {
          throw new Error('blocked');
        });

      // 빈 결과로 가야 해서 removeItem 을 시도하지만 실패해도 throw 는 없다.
      expect(() => cleanupExpiredReplayedHintSeen(now)).not.toThrow();
      removeSpy.mockRestore();
    });

    it('정리는 다른 프로젝트 키를 절대 건드리지 않는다', () => {
      const now = 100_000_000_000;
      localStorage.setItem('noilink:other-feature', 'keep-me');
      localStorage.setItem('totally-unrelated', 'keep-me-too');
      markReplayedHintSeen('u-1', 'sess-stale', now - REPLAYED_HINT_RETENTION_MS - 1_000);

      cleanupExpiredReplayedHintSeen(now);

      expect(localStorage.getItem('noilink:other-feature')).toBe('keep-me');
      expect(localStorage.getItem('totally-unrelated')).toBe('keep-me-too');
    });

    it('여러 사용자 키를 동시에 정리한다 (Task #133 + #134 결합)', () => {
      const now = 100_000_000_000;
      // u-1: 만료 1, 신선 1 → 만료만 떨어지고 키는 유지.
      markReplayedHintSeen('u-1', 'sess-stale-1', now - REPLAYED_HINT_RETENTION_MS - 1_000);
      markReplayedHintSeen('u-1', 'sess-fresh-1', now - 1_000);
      // u-2: 만료 2개 → 키 자체가 제거된다(=잊혀진 사용자 청소).
      markReplayedHintSeen('u-2', 'sess-stale-2a', now - REPLAYED_HINT_RETENTION_MS - 1_000);
      markReplayedHintSeen('u-2', 'sess-stale-2b', now - REPLAYED_HINT_RETENTION_MS - 2_000);

      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(3);
      expect(hasSeenReplayedHint('u-1', 'sess-stale-1')).toBe(false);
      expect(hasSeenReplayedHint('u-1', 'sess-fresh-1')).toBe(true);
      expect(localStorage.getItem(KEY_U1)).not.toBeNull();
      // u-2 의 모든 엔트리가 만료되었으므로 키 자체가 사라진다.
      expect(localStorage.getItem(KEY_U2)).toBeNull();
    });
  });
});
