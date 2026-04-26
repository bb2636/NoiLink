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
});
