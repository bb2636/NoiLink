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
  DISMISSAL_TTL_MS,
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
});
