/**
 * 결과 화면 replayed 힌트의 sessionId 기준 "본 적 있음" 영속화 유닛 테스트
 * (Task #118).
 *
 * 보호하는 동작:
 *  - 같은 sessionId 를 mark 한 뒤에는 hasSeen 이 true 를 반환한다.
 *  - 다른 sessionId 는 영향을 받지 않는다 (=세션 단위 분리).
 *  - sessionId 가 빈 값(null/undefined/'') 이면 추적이 비활성화돼 항상 false.
 *  - clearAll 후에는 다시 false 가 된다.
 *  - localStorage 가 throw 해도 앱이 죽지 않는다 (조용히 폴백).
 *  - 손상된 JSON / 이상한 배열 항목은 무시되고 false 로 폴백한다.
 *  - 누적 상한(REPLAYED_HINT_MAX_ENTRIES)을 넘기면 가장 오래된 항목부터 떨어진다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REPLAYED_HINT_MAX_ENTRIES,
  REPLAYED_HINT_RETENTION_MS,
  cleanupExpiredReplayedHintSeen,
  clearAllReplayedHintSeen,
  hasSeenReplayedHint,
  markReplayedHintSeen,
} from '../replayedHintSeen';

describe('replayedHintSeen', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('기본 상태는 본 적 없음(false)', () => {
    expect(hasSeenReplayedHint('sess-a')).toBe(false);
  });

  it('mark 후에는 같은 sessionId 가 본 적 있음(true)으로 평가된다', () => {
    markReplayedHintSeen('sess-a');
    expect(hasSeenReplayedHint('sess-a')).toBe(true);
  });

  it('다른 sessionId 는 영향을 받지 않는다 (세션 단위 분리)', () => {
    markReplayedHintSeen('sess-a');
    expect(hasSeenReplayedHint('sess-b')).toBe(false);
  });

  it('sessionId 가 비어 있으면 추적 비활성화 (항상 false / 저장도 하지 않음)', () => {
    markReplayedHintSeen(null);
    markReplayedHintSeen(undefined);
    markReplayedHintSeen('');
    expect(hasSeenReplayedHint(null)).toBe(false);
    expect(hasSeenReplayedHint(undefined)).toBe(false);
    expect(hasSeenReplayedHint('')).toBe(false);
    // 저장소도 비어 있어야 한다.
    expect(localStorage.getItem('noilink:replayed-hint-seen')).toBeNull();
  });

  it('clearAllReplayedHintSeen 후에는 다시 false 가 된다', () => {
    markReplayedHintSeen('sess-a');
    expect(hasSeenReplayedHint('sess-a')).toBe(true);
    clearAllReplayedHintSeen();
    expect(hasSeenReplayedHint('sess-a')).toBe(false);
  });

  it('localStorage.setItem 가 throw 해도 mark 가 앱을 깨뜨리지 않는다', () => {
    const setSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });
    expect(() => markReplayedHintSeen('sess-a')).not.toThrow();
    setSpy.mockRestore();
  });

  it('localStorage.getItem 가 throw 해도 hasSeen 은 false 로 안전하게 폴백한다', () => {
    const getSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });
    expect(hasSeenReplayedHint('sess-a')).toBe(false);
    getSpy.mockRestore();
  });

  it('손상된 JSON 은 무시되고 false 로 폴백한다', () => {
    localStorage.setItem('noilink:replayed-hint-seen', '{not-valid-json');
    expect(hasSeenReplayedHint('sess-a')).toBe(false);
    // 그리고 mark 가 정상 동작해 손상된 값을 덮어써야 한다.
    markReplayedHintSeen('sess-a');
    expect(hasSeenReplayedHint('sess-a')).toBe(true);
  });

  it('배열이 아닌 JSON 값은 빈 목록으로 간주된다', () => {
    localStorage.setItem('noilink:replayed-hint-seen', '{"id":"sess-a","at":1}');
    expect(hasSeenReplayedHint('sess-a')).toBe(false);
  });

  it('이상한 배열 항목은 필터링된다', () => {
    localStorage.setItem(
      'noilink:replayed-hint-seen',
      JSON.stringify([
        { id: 'sess-a', at: 1 }, // 정상
        { id: 'sess-b' }, // at 누락
        null,
        'string',
        { at: 5 }, // id 누락
      ]),
    );
    expect(hasSeenReplayedHint('sess-a')).toBe(true);
    expect(hasSeenReplayedHint('sess-b')).toBe(false);
  });

  it('상한(REPLAYED_HINT_MAX_ENTRIES)을 넘기면 가장 오래된 항목부터 제거된다', () => {
    for (let i = 0; i < REPLAYED_HINT_MAX_ENTRIES + 5; i += 1) {
      markReplayedHintSeen(`sess-${i}`, 1_000 + i);
    }
    // 처음 5개는 밀려나 false.
    expect(hasSeenReplayedHint('sess-0')).toBe(false);
    expect(hasSeenReplayedHint('sess-4')).toBe(false);
    // 그 이후는 살아 있어야 한다.
    expect(hasSeenReplayedHint('sess-5')).toBe(true);
    expect(hasSeenReplayedHint(`sess-${REPLAYED_HINT_MAX_ENTRIES + 4}`)).toBe(true);
  });

  it('같은 sessionId 를 다시 mark 해도 중복 누적 없이 갱신된다', () => {
    markReplayedHintSeen('sess-a', 1_000);
    markReplayedHintSeen('sess-a', 2_000);
    const raw = localStorage.getItem('noilink:replayed-hint-seen');
    expect(raw).not.toBeNull();
    const arr = JSON.parse(raw!);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.filter((e: { id: string }) => e.id === 'sess-a').length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Task #134 — 오래된 sessionId 기억 자동 정리
  // ---------------------------------------------------------------------------

  describe('cleanupExpiredReplayedHintSeen (시간 만료 정리)', () => {
    it('보존 한도(기본 30일) 안의 엔트리는 그대로 둔다', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('sess-fresh', now - 1_000); // 갓 표시
      markReplayedHintSeen('sess-edge', now - REPLAYED_HINT_RETENTION_MS + 1_000); // 한도 직전

      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(0);
      expect(hasSeenReplayedHint('sess-fresh')).toBe(true);
      expect(hasSeenReplayedHint('sess-edge')).toBe(true);
    });

    it('보존 한도를 초과한 엔트리는 제거되고 최근 기억만 남는다', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('sess-stale', now - REPLAYED_HINT_RETENTION_MS - 1_000);
      markReplayedHintSeen('sess-fresh', now - 1_000);

      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(1);
      expect(hasSeenReplayedHint('sess-stale')).toBe(false);
      expect(hasSeenReplayedHint('sess-fresh')).toBe(true);
    });

    it('만료/미만료 경계: 정확히 retentionMs 인 엔트리는 보존, 1ms 더 오래되면 제거', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('sess-on-edge', now - REPLAYED_HINT_RETENTION_MS); // 정확히 경계
      markReplayedHintSeen('sess-just-past', now - REPLAYED_HINT_RETENTION_MS - 1); // 1ms 초과

      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(1);
      expect(hasSeenReplayedHint('sess-on-edge')).toBe(true);
      expect(hasSeenReplayedHint('sess-just-past')).toBe(false);
    });

    it('미래 타임스탬프(시계 변경) 엔트리도 제거한다', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('sess-future', now + 60_000);
      markReplayedHintSeen('sess-now', now);

      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(1);
      expect(hasSeenReplayedHint('sess-future')).toBe(false);
      expect(hasSeenReplayedHint('sess-now')).toBe(true);
    });

    it('손상된 JSON 은 정리되어 다음 read 가 깨끗한 상태로 시작한다', () => {
      localStorage.setItem('noilink:replayed-hint-seen', '{not-valid-json');

      // 호출이 throw 하지 않고 정리된다.
      expect(() => cleanupExpiredReplayedHintSeen()).not.toThrow();

      // 손상된 raw 값이 정규 직렬화로 덮어써져 빈 배열이 되거나 키가 제거됐다.
      const raw = localStorage.getItem('noilink:replayed-hint-seen');
      // 손상된 JSON → readEntries() 가 [] 반환 → fresh 도 [] → 키 제거.
      expect(raw).toBeNull();
    });

    it('배열이 아닌 JSON 값도 안전하게 정리된다', () => {
      localStorage.setItem(
        'noilink:replayed-hint-seen',
        '{"id":"sess-a","at":1}',
      );

      cleanupExpiredReplayedHintSeen();

      // 배열이 아니므로 readEntries() → [] → 빈 결과 → 키 제거.
      expect(localStorage.getItem('noilink:replayed-hint-seen')).toBeNull();
    });

    it('이상한 배열 항목은 무시되고 정상 항목만 남는다', () => {
      const now = 100_000_000_000;
      localStorage.setItem(
        'noilink:replayed-hint-seen',
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

      expect(hasSeenReplayedHint('sess-good')).toBe(true);
      expect(hasSeenReplayedHint('sess-old')).toBe(false);
      // 손상/이상한 항목은 모두 사라져 정규 형태만 남는다.
      const raw = localStorage.getItem('noilink:replayed-hint-seen');
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
      markReplayedHintSeen('sess-a', now - 1_000);
      markReplayedHintSeen('sess-b', now - 2_000);

      const setSpy = vi.spyOn(Storage.prototype, 'setItem');
      const removed = cleanupExpiredReplayedHintSeen(now);

      expect(removed).toBe(0);
      expect(setSpy).not.toHaveBeenCalled();
    });

    it('retentionMs 인자로 보존 한도를 좁힐 수 있다', () => {
      const now = 100_000_000_000;
      markReplayedHintSeen('sess-a', now - 5_000);
      markReplayedHintSeen('sess-b', now - 500);

      // 1초 보존 한도 → 5초 묵은 sess-a 만 만료.
      const removed = cleanupExpiredReplayedHintSeen(now, 1_000);

      expect(removed).toBe(1);
      expect(hasSeenReplayedHint('sess-a')).toBe(false);
      expect(hasSeenReplayedHint('sess-b')).toBe(true);
    });

    it('localStorage.getItem 가 throw 해도 0 반환하고 앱이 죽지 않는다', () => {
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
      markReplayedHintSeen('sess-only', now - REPLAYED_HINT_RETENTION_MS - 1_000);

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
      markReplayedHintSeen('sess-stale', now - REPLAYED_HINT_RETENTION_MS - 1_000);

      cleanupExpiredReplayedHintSeen(now);

      expect(localStorage.getItem('noilink:other-feature')).toBe('keep-me');
      expect(localStorage.getItem('totally-unrelated')).toBe('keep-me-too');
    });
  });
});
