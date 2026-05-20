/**
 * Repository util sanity tests (Task #157)
 *
 * Postgres 연결이 필요한 통합 테스트는 별도. 여기서는 순수 변환 헬퍼만 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { snakeToCamel, rowToCamel, rowsToCamel } from './util.js';

describe('snakeToCamel', () => {
  it('기본 변환', () => {
    expect(snakeToCamel('user_id')).toBe('userId');
    expect(snakeToCamel('organization_id')).toBe('organizationId');
    expect(snakeToCamel('is_composite')).toBe('isComposite');
    expect(snakeToCamel('id')).toBe('id');
    expect(snakeToCamel('created_at')).toBe('createdAt');
  });

  it('숫자 포함 (rt_sd, by_mode_metrics)', () => {
    expect(snakeToCamel('rt_sd')).toBe('rtSd');
    expect(snakeToCamel('by_mode_metrics')).toBe('byModeMetrics');
  });

  it('연속 underscore 안전 처리', () => {
    expect(snakeToCamel('a_b_c')).toBe('aBC');
  });
});

describe('rowToCamel', () => {
  it('단일 row 변환', () => {
    const row = { user_id: 'u1', is_composite: true, score: 42 };
    expect(rowToCamel(row)).toEqual({ userId: 'u1', isComposite: true, score: 42 });
  });

  it('undefined/null 처리', () => {
    expect(rowToCamel(undefined)).toBeNull();
  });

  it('빈 row', () => {
    expect(rowToCamel({})).toEqual({});
  });
});

describe('rowsToCamel', () => {
  it('배열 변환', () => {
    const rows = [{ user_id: 'u1' }, { user_id: 'u2', is_valid: false }];
    expect(rowsToCamel(rows)).toEqual([{ userId: 'u1' }, { userId: 'u2', isValid: false }]);
  });

  it('빈 배열', () => {
    expect(rowsToCamel([])).toEqual([]);
  });
});
