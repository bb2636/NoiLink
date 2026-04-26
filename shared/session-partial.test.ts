/**
 * 부분 결과 메타 헬퍼(getSessionPartialProgressPct) 회귀 테스트.
 *
 * 결과 화면(/result)과 트레이닝 히스토리 목록(/record)이 같은 헬퍼로 진행률을
 * 읽어 "부분 결과 · X%" 배지를 노출하므로, 다음 정책을 잠근다:
 *  - meta 또는 partial 키가 없으면 undefined → 정상 완료 세션은 배지 미노출.
 *  - 정상 값은 0~100 정수로 정규화 → 결과 화면과 기록 화면이 같은 숫자를 보여준다.
 *  - 손상된 값(NaN/문자열/Infinity)은 undefined → UI 가 "부분 결과 · NaN%" 같은
 *    어색한 표기를 노출하지 않게 한다.
 */
import { describe, expect, it } from 'vitest';
import { getSessionPartialProgressPct, type Session } from './types.js';

function makeSession(meta?: Session['meta']): Pick<Session, 'meta'> {
  return { meta };
}

describe('getSessionPartialProgressPct', () => {
  it('meta 가 없으면 undefined (정상 완료 세션은 배지 미노출)', () => {
    expect(getSessionPartialProgressPct(makeSession(undefined))).toBeUndefined();
    expect(getSessionPartialProgressPct(null)).toBeUndefined();
    expect(getSessionPartialProgressPct(undefined)).toBeUndefined();
  });

  it('meta 는 있지만 partial 키가 없으면 undefined (다른 메타와 공존 가능)', () => {
    expect(
      getSessionPartialProgressPct(makeSession({ seed: 'test-10d' })),
    ).toBeUndefined();
  });

  it('정상 진행률은 0~100 정수로 정규화된다', () => {
    expect(
      getSessionPartialProgressPct(makeSession({ partial: { progressPct: 82 } })),
    ).toBe(82);
    expect(
      getSessionPartialProgressPct(makeSession({ partial: { progressPct: 82.6 } })),
    ).toBe(83);
    expect(
      getSessionPartialProgressPct(makeSession({ partial: { progressPct: -5 } })),
    ).toBe(0);
    expect(
      getSessionPartialProgressPct(makeSession({ partial: { progressPct: 150 } })),
    ).toBe(100);
  });

  it('손상된 값은 undefined (NaN/Infinity/문자열) — UI 의 어색한 표기 방지', () => {
    expect(
      getSessionPartialProgressPct(makeSession({ partial: { progressPct: NaN } })),
    ).toBeUndefined();
    expect(
      getSessionPartialProgressPct(
        makeSession({ partial: { progressPct: Infinity } }),
      ),
    ).toBeUndefined();
    expect(
      getSessionPartialProgressPct(
        makeSession({
          partial: { progressPct: '82' as unknown as number },
        }),
      ),
    ).toBeUndefined();
  });
});
