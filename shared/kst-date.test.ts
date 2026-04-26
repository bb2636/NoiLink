/**
 * `isoToKstLocalDate` 회귀 테스트 (Task #132).
 *
 * 보호하는 정책:
 *  - 자정 근처(UTC 15:00 = KST 다음 날 00:00) 케이스가 항상 KST 의 다음 날로 넘어간다.
 *  - 시간대 영향 받지 않는 시각도 같은 날짜로 정확히 떨어진다.
 *  - 잘못된 ISO 입력은 `null` 로 안전하게 폴백한다 (라벨이 "Invalid Date" 로 깨지지 않게).
 */
import { describe, expect, it } from 'vitest';

import { isoToKstLocalDate, KST_TIME_ZONE } from './kst-date.js';

describe('isoToKstLocalDate (Task #132)', () => {
  it('KST_TIME_ZONE 은 Asia/Seoul 로 고정된다', () => {
    expect(KST_TIME_ZONE).toBe('Asia/Seoul');
  });

  it('UTC 자정 직후(00:00) 는 KST 같은 날 09:00 → 같은 날짜로 떨어진다', () => {
    expect(isoToKstLocalDate('2026-04-24T00:00:00.000Z')).toBe('2026-04-24');
  });

  it('UTC 14:59 는 KST 23:59 → 아직 같은 날짜', () => {
    expect(isoToKstLocalDate('2026-04-24T14:59:00.000Z')).toBe('2026-04-24');
  });

  it('UTC 15:00 은 KST 다음 날 00:00 → 다음 날짜로 넘어간다 (자정 경계 회귀 보호)', () => {
    expect(isoToKstLocalDate('2026-04-24T15:00:00.000Z')).toBe('2026-04-25');
  });

  it('UTC 23:30 은 KST 다음 날 08:30 → 다음 날짜', () => {
    expect(isoToKstLocalDate('2026-04-24T23:30:00.000Z')).toBe('2026-04-25');
  });

  it('월 경계 — UTC 15:00 (월말) 은 KST 다음 달 1일로 넘어간다', () => {
    expect(isoToKstLocalDate('2026-04-30T15:00:00.000Z')).toBe('2026-05-01');
  });

  it('연 경계 — UTC 12/31 15:00 은 KST 다음 해 1/1 로 넘어간다', () => {
    expect(isoToKstLocalDate('2026-12-31T15:00:00.000Z')).toBe('2027-01-01');
  });

  it('null/undefined/빈 문자열은 null 로 폴백한다', () => {
    expect(isoToKstLocalDate(null)).toBeNull();
    expect(isoToKstLocalDate(undefined)).toBeNull();
    expect(isoToKstLocalDate('')).toBeNull();
  });

  it('파싱 불가 ISO 는 null 로 폴백한다 ("Invalid Date" 라벨 회귀 방지)', () => {
    expect(isoToKstLocalDate('not-an-iso')).toBeNull();
  });
});
