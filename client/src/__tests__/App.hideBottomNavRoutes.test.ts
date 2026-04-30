/**
 * 외곽 하단 탭바 숨김 정책 회귀 테스트
 *
 * 보호 대상:
 *  - 트레이닝 진행/결과처럼 몰입형 화면은 외곽 MobileLayout 의 탭바를 숨겨야 한다.
 *    빠지면 진행 화면 위로 탭바가 노출되어 사용자가 실수로 다른 화면으로 이동할 수 있다.
 */

import { describe, expect, it } from 'vitest';
import { HIDE_BOTTOM_NAV_ROUTES } from '../App';

describe('App — 하단 탭바 숨김 라우트', () => {
  it('트레이닝 진행/결과 라우트가 포함된다', () => {
    expect(HIDE_BOTTOM_NAV_ROUTES).toContain('/training/session');
    expect(HIDE_BOTTOM_NAV_ROUTES).toContain('/result');
  });
});
