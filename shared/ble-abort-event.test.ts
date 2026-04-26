/**
 * `sanitizeBleAbortEventInput` 회귀 테스트.
 *
 * 잘못된 모양의 텔레메트리 페이로드가 들어와도 운영 집계가 오염되지 않도록
 * 음수·NaN·잘못된 모드 라벨을 일관되게 정규화하는지 확인한다.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeBleAbortEventInput } from './ble-abort-event.js';

describe('sanitizeBleAbortEventInput', () => {
  it('정상 페이로드는 정수로 반올림된 값과 boolean 그대로 통과시킨다', () => {
    expect(
      sanitizeBleAbortEventInput({
        windows: 2,
        totalMs: 7_500.4,
        bleUnstable: true,
        apiMode: 'FOCUS',
      }),
    ).toEqual({
      windows: 2,
      totalMs: 7_500,
      bleUnstable: true,
      apiMode: 'FOCUS',
    });
  });

  it('windows / totalMs 의 음수·NaN 은 0 으로 클램프되고 bleUnstable 비-boolean 은 false 로 강제된다', () => {
    expect(
      sanitizeBleAbortEventInput({
        windows: -3,
        totalMs: Number.NaN,
        bleUnstable: 'yes',
      }),
    ).toEqual({ windows: 0, totalMs: 0, bleUnstable: false });
  });

  it('알려지지 않은 apiMode 라벨은 누락 처리되어 페이로드에서 제거된다', () => {
    expect(
      sanitizeBleAbortEventInput({
        windows: 1,
        totalMs: 5_000,
        bleUnstable: true,
        apiMode: 'NOT_A_MODE',
      }),
    ).toEqual({ windows: 1, totalMs: 5_000, bleUnstable: true });
  });

  it('windows 또는 totalMs 가 숫자가 전혀 아니면 null 로 거부된다', () => {
    expect(
      sanitizeBleAbortEventInput({ windows: 'a', totalMs: 0, bleUnstable: false }),
    ).toBeNull();
    expect(sanitizeBleAbortEventInput(null)).toBeNull();
    expect(sanitizeBleAbortEventInput('foo')).toBeNull();
  });
});
