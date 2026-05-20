/**
 * `startRankingsRefreshScheduler` 회귀 테스트 (Task #168).
 *
 * Task #164 의 TTL 캐시는 "TTL 만료 후 첫 요청" 한 명이 전체 사용자 14일 창 재계산
 * 비용을 떠안는 약점이 있었다. Task #168 의 주기 배치가 미리 `rankings` 테이블 +
 * 캐시 타임스탬프를 채워두므로 사용자 요청은 항상 캐시 hit 으로 떨어진다.
 *
 * 보호 항목:
 *  1. interval 이 0 이하면 스케줄러를 등록하지 않고 recompute 도 부르지 않는다.
 *  2. interval > 0 이면 부팅 직후 한 번 + 이후 주기마다 recompute 가 호출된다.
 *  3. 배치 직후의 ensureRankings 는 캐시 hit 으로 떨어진다 (recompute 추가 호출 X).
 *  4. recompute 가 throw 해도 timer 가 죽지 않고 다음 tick 이 계속 돈다.
 *  5. stop() 호출 후에는 더 이상 tick 이 돌지 않는다.
 *  6. `RANKINGS_REFRESH_INTERVAL_MS` 환경변수로 주기를 잡을 수 있다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setRankingsCacheTtlForTests,
  ensureRankings,
  startRankingsRefreshScheduler,
} from './rankings-cache.js';

const silentLogger = { info: () => {}, error: () => {} };

beforeEach(() => {
  vi.useFakeTimers();
  __setRankingsCacheTtlForTests(60_000);
});

afterEach(() => {
  vi.useRealTimers();
  __setRankingsCacheTtlForTests(0);
  delete process.env.RANKINGS_REFRESH_INTERVAL_MS;
});

describe('startRankingsRefreshScheduler (Task #168)', () => {
  it('interval 0 이하면 스케줄러를 등록하지 않고 recompute 도 부르지 않는다', async () => {
    const recompute = vi.fn(async () => {});
    const stop = startRankingsRefreshScheduler(recompute, {
      intervalMs: 0,
      logger: silentLogger,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recompute).not.toHaveBeenCalled();
    stop();
  });

  it('부팅 직후 한 번 + 주기마다 recompute 가 호출된다', async () => {
    const recompute = vi.fn(async () => {});
    const stop = startRankingsRefreshScheduler(recompute, {
      intervalMs: 1_000,
      logger: silentLogger,
    });
    // initial tick 은 microtask 로 예약되어 있어 한 번 await 로 flush
    await Promise.resolve();
    await Promise.resolve();
    expect(recompute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(recompute).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(recompute).toHaveBeenCalledTimes(4);
    stop();
  });

  it('배치 직후의 ensureRankings 는 캐시 hit 으로 추가 recompute 를 부르지 않는다', async () => {
    const recompute = vi.fn(async () => {});
    const stop = startRankingsRefreshScheduler(recompute, {
      intervalMs: 5_000,
      logger: silentLogger,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(recompute).toHaveBeenCalledTimes(1);

    // TTL(60s) 안의 사용자 요청 — 다시 계산하지 않아야 함
    await ensureRankings(recompute);
    await ensureRankings(recompute);
    expect(recompute).toHaveBeenCalledTimes(1);
    stop();
  });

  it('recompute throw 해도 timer 가 죽지 않는다', async () => {
    let calls = 0;
    const recompute = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
    });
    const stop = startRankingsRefreshScheduler(recompute, {
      intervalMs: 1_000,
      logger: silentLogger,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(recompute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(recompute).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(recompute).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stop() 후에는 tick 이 더 이상 돌지 않는다', async () => {
    const recompute = vi.fn(async () => {});
    const stop = startRankingsRefreshScheduler(recompute, {
      intervalMs: 1_000,
      logger: silentLogger,
    });
    await Promise.resolve();
    await Promise.resolve();
    const beforeStop = recompute.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recompute.mock.calls.length).toBe(beforeStop);
  });

  it('RANKINGS_REFRESH_INTERVAL_MS 환경변수로 주기를 잡을 수 있다', async () => {
    process.env.RANKINGS_REFRESH_INTERVAL_MS = '2000';
    const recompute = vi.fn(async () => {});
    const stop = startRankingsRefreshScheduler(recompute, { logger: silentLogger });
    await Promise.resolve();
    await Promise.resolve();
    expect(recompute).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(recompute).toHaveBeenCalledTimes(2);
    stop();
  });

  it('환경변수가 0 이면 스케줄러가 비활성화된다', async () => {
    process.env.RANKINGS_REFRESH_INTERVAL_MS = '0';
    const recompute = vi.fn(async () => {});
    const stop = startRankingsRefreshScheduler(recompute, { logger: silentLogger });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(recompute).not.toHaveBeenCalled();
    stop();
  });

  it('runOnStart: false 면 부팅 직후 즉시 실행을 건너뛴다', async () => {
    const recompute = vi.fn(async () => {});
    const stop = startRankingsRefreshScheduler(recompute, {
      intervalMs: 1_000,
      runOnStart: false,
      logger: silentLogger,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(recompute).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(recompute).toHaveBeenCalledTimes(1);
    stop();
  });
});
