/**
 * `isoToKstLocalDate` 회귀 테스트 (Task #132).
 *
 * 보호하는 정책:
 *  - 자정 근처(UTC 15:00 = KST 다음 날 00:00) 케이스가 항상 KST 의 다음 날로 넘어간다.
 *  - 시간대 영향 받지 않는 시각도 같은 날짜로 정확히 떨어진다.
 *  - 잘못된 ISO 입력은 `null` 로 안전하게 폴백한다 (라벨이 "Invalid Date" 로 깨지지 않게).
 */
import { describe, expect, it } from 'vitest';

import {
  isoToKstLocalDate,
  KST_TIME_ZONE,
  kstStartOfWeekMonYmd,
  kstWeekdayMon0FromYmd,
  kstYmdDiffDays,
} from './kst-date.js';

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

describe('kstWeekdayMon0FromYmd (Task #144)', () => {
  it('월요일은 0, 일요일은 6 으로 떨어진다', () => {
    // 2026-04-20 은 월요일, 2026-04-26 은 일요일 (KST 달력 기준)
    expect(kstWeekdayMon0FromYmd('2026-04-20')).toBe(0);
    expect(kstWeekdayMon0FromYmd('2026-04-21')).toBe(1);
    expect(kstWeekdayMon0FromYmd('2026-04-22')).toBe(2);
    expect(kstWeekdayMon0FromYmd('2026-04-23')).toBe(3);
    expect(kstWeekdayMon0FromYmd('2026-04-24')).toBe(4);
    expect(kstWeekdayMon0FromYmd('2026-04-25')).toBe(5);
    expect(kstWeekdayMon0FromYmd('2026-04-26')).toBe(6);
  });

  it('연/월 경계도 정확한 요일을 돌려준다', () => {
    // 2027-01-01 은 금요일
    expect(kstWeekdayMon0FromYmd('2027-01-01')).toBe(4);
  });

  it('형식이 어긋난 입력은 null 로 폴백한다', () => {
    expect(kstWeekdayMon0FromYmd(null)).toBeNull();
    expect(kstWeekdayMon0FromYmd(undefined)).toBeNull();
    expect(kstWeekdayMon0FromYmd('')).toBeNull();
    expect(kstWeekdayMon0FromYmd('2026/04/20')).toBeNull();
    expect(kstWeekdayMon0FromYmd('2026-4-20')).toBeNull();
  });
});

describe('kstStartOfWeekMonYmd (Task #144)', () => {
  it('주중 어떤 ISO 든 그 주 월요일의 KST 날짜를 돌려준다', () => {
    // 2026-04-22(수) KST 12:00 = UTC 03:00 — 같은 주 월요일은 2026-04-20
    expect(kstStartOfWeekMonYmd('2026-04-22T03:00:00.000Z')).toBe('2026-04-20');
    // 일요일도 "이번 주" 의 월요일을 돌려줘 다음 주로 넘어가지 않는다
    expect(kstStartOfWeekMonYmd('2026-04-26T03:00:00.000Z')).toBe('2026-04-20');
    // 월요일 자기 자신
    expect(kstStartOfWeekMonYmd('2026-04-20T03:00:00.000Z')).toBe('2026-04-20');
  });

  it('자정 직전(KST) 의 ISO 도 KST 날짜 기준으로 같은 주에 머문다', () => {
    // 2026-04-26(일) KST 23:30 = UTC 14:30 — KST 일요일이므로 시작은 2026-04-20
    expect(kstStartOfWeekMonYmd('2026-04-26T14:30:00.000Z')).toBe('2026-04-20');
  });

  it('자정 직후(KST) 의 ISO 는 다음 주 월요일로 넘어간다 — 시간대 회귀 방지의 핵심', () => {
    // 2026-04-26(일) KST 23:30 → UTC 2026-04-26T14:30Z 까지는 같은 주.
    // UTC 2026-04-26T15:00Z 는 KST 2026-04-27(월) 00:00 → 새 주의 월요일
    expect(kstStartOfWeekMonYmd('2026-04-26T15:00:00.000Z')).toBe('2026-04-27');
  });

  it('월/연 경계에서도 KST 달력으로 정확한 월요일을 돌려준다', () => {
    // 2027-01-01(금) KST → 같은 주 월요일은 2026-12-28
    expect(kstStartOfWeekMonYmd('2027-01-01T00:30:00.000Z')).toBe('2026-12-28');
  });

  it('잘못된 ISO 는 null 로 폴백한다', () => {
    expect(kstStartOfWeekMonYmd(null)).toBeNull();
    expect(kstStartOfWeekMonYmd(undefined)).toBeNull();
    expect(kstStartOfWeekMonYmd('')).toBeNull();
    expect(kstStartOfWeekMonYmd('not-an-iso')).toBeNull();
  });
});

describe('kstYmdDiffDays (Task #144)', () => {
  it('같은 날짜는 0, 하루 차이는 1', () => {
    expect(kstYmdDiffDays('2026-04-22', '2026-04-22')).toBe(0);
    expect(kstYmdDiffDays('2026-04-23', '2026-04-22')).toBe(1);
  });

  it('주(週) 시작일로부터 0..6 인덱스를 정확히 돌려준다 (출석 도장 핵심 시나리오)', () => {
    expect(kstYmdDiffDays('2026-04-20', '2026-04-20')).toBe(0); // 월
    expect(kstYmdDiffDays('2026-04-26', '2026-04-20')).toBe(6); // 일
    expect(kstYmdDiffDays('2026-04-27', '2026-04-20')).toBe(7); // 다음 주 (범위 밖)
  });

  it('월/연 경계도 일수로 정확히 떨어진다', () => {
    expect(kstYmdDiffDays('2026-05-01', '2026-04-30')).toBe(1);
    expect(kstYmdDiffDays('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('과거 - 미래 입력은 음수 차이를 돌려준다', () => {
    expect(kstYmdDiffDays('2026-04-20', '2026-04-22')).toBe(-2);
  });

  it('형식이 어긋난 입력은 null 로 폴백한다', () => {
    expect(kstYmdDiffDays('bad', '2026-04-20')).toBeNull();
    expect(kstYmdDiffDays('2026-04-20', '')).toBeNull();
  });
});
