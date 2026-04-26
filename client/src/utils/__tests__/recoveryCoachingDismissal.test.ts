/**
 * 회복 코칭 카드 닫힘 상태 영속화 유닛 테스트 (Task #74).
 *
 * 보호하는 동작:
 *  - 사용자별 분리(키 prefix + userId).
 *  - 트립 종료 시 clearDismissed 가 키를 지운다.
 *  - userId 가 비어 있으면 영속화하지 않는다(=in-memory only).
 *  - localStorage 가 throw 해도 앱이 죽지 않는다.
 *  - 24h TTL: 기억은 일정 시간이 지나면 자동 만료되어, 사용자가 자리를 비운 사이
 *    트립이 새로 시작되었더라도 닫힘 기억이 영구히 카드를 가리지 않는다.
 *  - 손상된 JSON / 미래 타임스탬프(시계 변경)는 미닫힘으로 처리한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISMISSAL_RETENTION_MS,
  DISMISSAL_TTL_MS,
  cleanupExpiredDismissals,
  clearAllDismissals,
  clearDismissed,
  readDismissed,
  recoveryCoachingDismissalKey,
  writeDismissed,
} from '../recoveryCoachingDismissal';

describe('recoveryCoachingDismissal', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('기본 상태는 닫히지 않음(false)', () => {
    expect(readDismissed('user-a')).toBe(false);
  });

  it('writeDismissed 후 readDismissed 가 true 를 반환한다', () => {
    const now = 1_000_000;
    writeDismissed('user-a', now);
    expect(readDismissed('user-a', now + 60_000)).toBe(true);
  });

  it('clearDismissed 후 다시 false 가 된다 (트립 종료 시 자동 초기화)', () => {
    writeDismissed('user-a');
    expect(readDismissed('user-a')).toBe(true);
    clearDismissed('user-a');
    expect(readDismissed('user-a')).toBe(false);
  });

  it('서로 다른 사용자 간 닫힘 상태가 섞이지 않는다', () => {
    writeDismissed('user-a');
    expect(readDismissed('user-a')).toBe(true);
    expect(readDismissed('user-b')).toBe(false);
    clearDismissed('user-a');
    expect(readDismissed('user-a')).toBe(false);
  });

  it('userId 가 null/undefined/빈문자열이면 영속화하지 않는다', () => {
    expect(recoveryCoachingDismissalKey(null)).toBeNull();
    expect(recoveryCoachingDismissalKey(undefined)).toBeNull();
    expect(recoveryCoachingDismissalKey('')).toBeNull();
    writeDismissed(null);
    writeDismissed('');
    // 어떤 키도 만들어져선 안 된다.
    expect(localStorage.length).toBe(0);
    expect(readDismissed(null)).toBe(false);
    expect(readDismissed(undefined)).toBe(false);
  });

  it('localStorage 가 예외를 던져도 앱이 죽지 않는다', () => {
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => writeDismissed('user-a')).not.toThrow();
    expect(readDismissed('user-a')).toBe(false);
    expect(() => clearDismissed('user-a')).not.toThrow();

    setSpy.mockRestore();
    getSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('키는 사용자별로 prefix 와 함께 분리된다', () => {
    expect(recoveryCoachingDismissalKey('abc')).toBe(
      'noilink:recovery-coaching-dismissed:abc',
    );
  });

  it('TTL 이 지난 닫힘 기억은 만료되어 false 로 간주한다', () => {
    const at = 10_000_000;
    writeDismissed('user-a', at);
    // TTL 직전: 여전히 dismissed
    expect(readDismissed('user-a', at + DISMISSAL_TTL_MS)).toBe(true);
    // TTL 초과: 만료
    expect(readDismissed('user-a', at + DISMISSAL_TTL_MS + 1)).toBe(false);
  });

  it('만료된 키는 readDismissed 호출 시 자동으로 정리된다', () => {
    const at = 10_000_000;
    writeDismissed('user-a', at);
    const key = recoveryCoachingDismissalKey('user-a')!;
    expect(localStorage.getItem(key)).not.toBeNull();
    readDismissed('user-a', at + DISMISSAL_TTL_MS + 1_000);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('미래 타임스탬프(시계 변경)는 미닫힘으로 처리한다', () => {
    const at = 10_000_000;
    writeDismissed('user-a', at);
    // 현재 시각이 저장 시각보다 과거라면(시스템 시계가 뒤로 갔다면) 안전하게 false.
    expect(readDismissed('user-a', at - 1_000)).toBe(false);
  });

  it('손상된 JSON 값은 미닫힘으로 안전 처리', () => {
    const key = recoveryCoachingDismissalKey('user-a')!;
    localStorage.setItem(key, 'not-json');
    expect(readDismissed('user-a')).toBe(false);
    localStorage.setItem(key, JSON.stringify({ at: 'bad' }));
    expect(readDismissed('user-a')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Task #98 — 오래된 회복 안내 닫힘 기억 자동 정리
  // ---------------------------------------------------------------------------

  describe('cleanupExpiredDismissals (prefix scan)', () => {
    it('보존 한도(기본 30일) 안의 키는 그대로 둔다', () => {
      const now = 100_000_000;
      writeDismissed('user-a', now - 1_000); // 갓 닫음
      writeDismissed('user-b', now - DISMISSAL_RETENTION_MS + 1_000); // 한도 직전
      const removed = cleanupExpiredDismissals(now);
      expect(removed).toBe(0);
      expect(localStorage.getItem(recoveryCoachingDismissalKey('user-a')!)).not.toBeNull();
      expect(localStorage.getItem(recoveryCoachingDismissalKey('user-b')!)).not.toBeNull();
    });

    it('보존 한도를 초과한 키는 제거한다', () => {
      const now = 100_000_000;
      writeDismissed('forgotten-user', now - DISMISSAL_RETENTION_MS - 1_000);
      writeDismissed('active-user', now - 1_000);
      const removed = cleanupExpiredDismissals(now);
      expect(removed).toBe(1);
      expect(localStorage.getItem(recoveryCoachingDismissalKey('forgotten-user')!)).toBeNull();
      expect(localStorage.getItem(recoveryCoachingDismissalKey('active-user')!)).not.toBeNull();
    });

    it('미래 타임스탬프(시계 변경)와 손상된 JSON 도 제거한다', () => {
      const now = 100_000_000;
      const futureKey = recoveryCoachingDismissalKey('future-user')!;
      const brokenKey = recoveryCoachingDismissalKey('broken-user')!;
      const goodKey = recoveryCoachingDismissalKey('good-user')!;
      localStorage.setItem(futureKey, JSON.stringify({ at: now + 60_000 }));
      localStorage.setItem(brokenKey, 'not-json');
      writeDismissed('good-user', now - 1_000);

      const removed = cleanupExpiredDismissals(now);
      expect(removed).toBe(2);
      expect(localStorage.getItem(futureKey)).toBeNull();
      expect(localStorage.getItem(brokenKey)).toBeNull();
      expect(localStorage.getItem(goodKey)).not.toBeNull();
    });

    it('prefix 가 다른 키는 절대 건드리지 않는다', () => {
      const now = 100_000_000;
      localStorage.setItem('noilink:other-feature', 'keep-me');
      localStorage.setItem('totally-unrelated', 'keep-me-too');
      writeDismissed('forgotten-user', now - DISMISSAL_RETENTION_MS - 1_000);

      cleanupExpiredDismissals(now);

      expect(localStorage.getItem('noilink:other-feature')).toBe('keep-me');
      expect(localStorage.getItem('totally-unrelated')).toBe('keep-me-too');
    });

    it('retentionMs 인자로 보존 한도를 조정할 수 있다', () => {
      const now = 100_000_000;
      writeDismissed('user-a', now - 5_000);
      // 1초 보존 한도 → user-a 의 5초 묵은 기억도 만료.
      const removed = cleanupExpiredDismissals(now, 1_000);
      expect(removed).toBe(1);
      expect(localStorage.getItem(recoveryCoachingDismissalKey('user-a')!)).toBeNull();
    });

    it('빈 localStorage 또는 매칭 키 없음 → 0 반환, throw 없음', () => {
      expect(cleanupExpiredDismissals()).toBe(0);
      localStorage.setItem('noilink:other', 'x');
      expect(cleanupExpiredDismissals()).toBe(0);
    });

    it('localStorage 가 throw 해도 0 반환하고 앱이 죽지 않는다', () => {
      const lengthSpy = vi
        .spyOn(Storage.prototype, 'length', 'get')
        .mockImplementation(() => {
          throw new Error('blocked');
        });
      expect(() => cleanupExpiredDismissals()).not.toThrow();
      expect(cleanupExpiredDismissals()).toBe(0);
      lengthSpy.mockRestore();
    });

    it('removeItem 이 throw 하는 키는 건너뛰지만 다른 키 정리는 계속된다', () => {
      const now = 100_000_000;
      writeDismissed('user-a', now - DISMISSAL_RETENTION_MS - 1_000);
      writeDismissed('user-b', now - DISMISSAL_RETENTION_MS - 1_000);
      const keyA = recoveryCoachingDismissalKey('user-a')!;

      const removeSpy = vi
        .spyOn(Storage.prototype, 'removeItem')
        .mockImplementation(function (this: Storage, key: string) {
          if (key === keyA) throw new Error('blocked');
          // 원래 동작 위임 (Storage.prototype 의 'native' removeItem 호출).
          delete (this as unknown as Record<string, unknown>)[key];
        });

      const removed = cleanupExpiredDismissals(now);
      // user-a 는 실패, user-b 는 성공 → 1 반환.
      expect(removed).toBe(1);

      removeSpy.mockRestore();
    });
  });

  describe('clearAllDismissals (logout cleanup)', () => {
    it('prefix 의 모든 키를 한 번에 비운다', () => {
      writeDismissed('user-a');
      writeDismissed('user-b');
      writeDismissed('user-c');
      localStorage.setItem('noilink:unrelated', 'keep-me');

      const removed = clearAllDismissals();

      expect(removed).toBe(3);
      expect(localStorage.getItem(recoveryCoachingDismissalKey('user-a')!)).toBeNull();
      expect(localStorage.getItem(recoveryCoachingDismissalKey('user-b')!)).toBeNull();
      expect(localStorage.getItem(recoveryCoachingDismissalKey('user-c')!)).toBeNull();
      // 비-회복코칭 키는 그대로 유지.
      expect(localStorage.getItem('noilink:unrelated')).toBe('keep-me');
    });

    it('비어 있어도 0 반환, throw 없음', () => {
      expect(clearAllDismissals()).toBe(0);
    });

    it('localStorage 가 throw 해도 앱이 죽지 않는다', () => {
      writeDismissed('user-a');
      const removeSpy = vi
        .spyOn(Storage.prototype, 'removeItem')
        .mockImplementation(() => {
          throw new Error('blocked');
        });
      expect(() => clearAllDismissals()).not.toThrow();
      removeSpy.mockRestore();
    });

    it('정리 후 같은 사용자가 다시 로그인하면 미닫힘 상태로 돌아간다', () => {
      writeDismissed('user-a');
      expect(readDismissed('user-a')).toBe(true);
      clearAllDismissals();
      expect(readDismissed('user-a')).toBe(false);
    });

    // TTL 상수가 정상적으로 export 됨을 회귀 보호 (다른 모듈 임포트가 깨지지 않게).
    it('export 한 상수가 여전히 양수 ms 값', () => {
      expect(DISMISSAL_TTL_MS).toBeGreaterThan(0);
      expect(DISMISSAL_RETENTION_MS).toBeGreaterThan(DISMISSAL_TTL_MS);
    });
  });
});
