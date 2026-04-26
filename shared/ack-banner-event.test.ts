/**
 * `sanitizeAckBannerEventInput` 회귀 테스트.
 *
 * 잘못된 모양의 텔레메트리 페이로드가 들어와도 운영 집계가 오염되지 않도록
 * 음수·NaN·잘못된 reason 라벨을 일관되게 정규화하는지 확인한다 (Task #116).
 */
import { describe, expect, it } from 'vitest';
import { sanitizeAckBannerEventInput } from './ack-banner-event.js';

describe('sanitizeAckBannerEventInput', () => {
  it('정상 페이로드는 정수로 반올림된 값과 reason 라벨을 그대로 통과시킨다', () => {
    expect(
      sanitizeAckBannerEventInput({
        reason: 'auto-dismiss',
        burstCount: 3,
        burstDurationMs: 4_999.4,
      }),
    ).toEqual({
      reason: 'auto-dismiss',
      burstCount: 3,
      burstDurationMs: 4_999,
    });
  });

  it('알려진 모든 reason 라벨(auto-dismiss / user-dismiss / banner-timeout / unmount)을 통과시킨다', () => {
    // Task #129 — banner-timeout 은 SuccessBanner 자체 duration 타이머 발화로
    // 닫힌 burst 를 user-dismiss 와 분리하기 위한 라벨.
    for (const reason of ['auto-dismiss', 'user-dismiss', 'banner-timeout', 'unmount'] as const) {
      const r = sanitizeAckBannerEventInput({ reason, burstCount: 1, burstDurationMs: 0 });
      expect(r).not.toBeNull();
      expect(r!.reason).toBe(reason);
    }
  });

  it('burstCount 의 음수·NaN 은 0 으로 클램프된 뒤 정의상 최저 1 로 끌어올려진다', () => {
    expect(
      sanitizeAckBannerEventInput({
        reason: 'user-dismiss',
        burstCount: -3,
        burstDurationMs: 0,
      }),
    ).toEqual({ reason: 'user-dismiss', burstCount: 1, burstDurationMs: 0 });

    expect(
      sanitizeAckBannerEventInput({
        reason: 'auto-dismiss',
        burstCount: Number.NaN,
        burstDurationMs: 100,
      }),
    ).toEqual({ reason: 'auto-dismiss', burstCount: 1, burstDurationMs: 100 });
  });

  it('burstDurationMs 의 음수·NaN·Infinity 는 0 으로 클램프된다', () => {
    expect(
      sanitizeAckBannerEventInput({
        reason: 'auto-dismiss',
        burstCount: 2,
        burstDurationMs: -100,
      }),
    ).toEqual({ reason: 'auto-dismiss', burstCount: 2, burstDurationMs: 0 });

    expect(
      sanitizeAckBannerEventInput({
        reason: 'auto-dismiss',
        burstCount: 2,
        burstDurationMs: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ reason: 'auto-dismiss', burstCount: 2, burstDurationMs: 0 });
  });

  it('알려지지 않은 reason 라벨은 null 로 거부된다', () => {
    expect(
      sanitizeAckBannerEventInput({ reason: 'manual', burstCount: 1, burstDurationMs: 0 }),
    ).toBeNull();
    expect(
      sanitizeAckBannerEventInput({ reason: '', burstCount: 1, burstDurationMs: 0 }),
    ).toBeNull();
    expect(
      sanitizeAckBannerEventInput({ burstCount: 1, burstDurationMs: 0 }),
    ).toBeNull();
  });

  it('burstCount 또는 burstDurationMs 가 숫자가 전혀 아니면 null 로 거부된다', () => {
    expect(
      sanitizeAckBannerEventInput({
        reason: 'auto-dismiss',
        burstCount: 'a',
        burstDurationMs: 0,
      }),
    ).toBeNull();
    expect(
      sanitizeAckBannerEventInput({
        reason: 'auto-dismiss',
        burstCount: 1,
        burstDurationMs: 'b',
      }),
    ).toBeNull();
    expect(sanitizeAckBannerEventInput(null)).toBeNull();
    expect(sanitizeAckBannerEventInput('foo')).toBeNull();
  });
});
