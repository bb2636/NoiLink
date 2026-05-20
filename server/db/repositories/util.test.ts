/**
 * Repository util sanity tests (Task #157)
 *
 * Postgres 연결이 필요한 통합 테스트는 별도. 여기서는 순수 변환 헬퍼만 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { snakeToCamel, rowToCamel, rowsToCamel, ACRONYM_FIELD_ALIASES } from './util.js';

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

describe('ACRONYM_FIELD_ALIASES (Task #161)', () => {
  it('rt_sd → rtSD 약어 alias 가 rowToCamel 에 자동 적용된다', () => {
    const row = { session_id: 's1', rt_mean: 450, rt_sd: 80 };
    const c = rowToCamel<any>(row)!;
    expect(c).toEqual({ sessionId: 's1', rtMean: 450, rtSD: 80 });
    expect(c.rtSd).toBeUndefined();
  });

  it('rowsToCamel 에서도 alias 가 적용된다', () => {
    const rows = [{ rt_sd: 10 }, { rt_sd: 20 }];
    const out = rowsToCamel<any>(rows);
    expect(out).toEqual([{ rtSD: 10 }, { rtSD: 20 }]);
  });

  it('alias 대상이 아닌 동일 패턴(예: by_mode_metrics) 은 영향받지 않는다', () => {
    expect(rowToCamel({ by_mode_metrics: { x: 1 } })).toEqual({ byModeMetrics: { x: 1 } });
  });

  it('alias 맵은 frozen 이라 런타임 오염을 막는다', () => {
    expect(Object.isFrozen(ACRONYM_FIELD_ALIASES)).toBe(true);
    expect(ACRONYM_FIELD_ALIASES.rtSd).toBe('rtSD');
  });
});
