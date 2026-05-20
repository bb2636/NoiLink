/**
 * Rankings 캐시 (Task #164)
 *
 * `routes/rankings.ts` 의 `calculateRankings()` 결과를 TTL + 싱글플라이트로 캐싱한다.
 * - TTL 안의 요청은 `rankings` 테이블에서 바로 응답한다.
 * - 동시 요청은 inflight 싱글플라이트로 합쳐 한 번만 재계산한다.
 * - 세션 저장/수정/삭제 hook 이 `invalidateRankingsCache()` 를 호출해 다음 read 가
 *   다시 신선한 데이터를 계산하도록 만든다.
 *
 * 별도 모듈로 분리한 이유: 세션/메트릭/회원/관리자 라우트가 invalidate hook 만
 * 의존하면 되는데 `routes/rankings.ts` 전체를 import 하면 `requireAuth` 같은
 * Express 미들웨어가 함께 끌려와 (vi.mock 으로) `requireAuth` 만 모킹한 기존 회귀
 * 테스트가 깨졌다. 캐시 상태만 별도 모듈로 빼면 사이드이펙트 없이 hook 만 노출된다.
 */

const DEFAULT_TTL_MS = process.env.NODE_ENV === 'test'
  ? 0
  : Number(process.env.RANKINGS_CACHE_TTL_MS ?? 60_000);

let rankingsCacheTtlMs = Number.isFinite(DEFAULT_TTL_MS) ? DEFAULT_TTL_MS : 60_000;
let lastCalcAt = 0;
let inflight: Promise<void> | null = null;
// invalidate 가 호출될 때마다 증가하는 epoch. ensureRankings 가 recompute 시작 시점의
// epoch 를 기억했다가 종료 후 동일한지 확인 — 다르면 (= 진행 중 invalidate 가 들어왔으면)
// 결과를 fresh 로 마킹하지 않고 0 으로 되돌려 다음 read 가 다시 재계산하도록 한다.
let invalidationEpoch = 0;

/** 세션 저장/삭제/리셋 hook 에서 호출 — 다음 read 가 강제 재계산하도록 만든다. */
export function invalidateRankingsCache(): void {
  lastCalcAt = 0;
  invalidationEpoch++;
}

/** 테스트 헬퍼 — TTL 을 명시적으로 조정하고 캐시를 리셋한다. */
export function __setRankingsCacheTtlForTests(ms: number): void {
  rankingsCacheTtlMs = ms;
  lastCalcAt = 0;
  inflight = null;
  invalidationEpoch = 0;
}

/**
 * recompute 콜백을 TTL 안에서는 스킵, TTL 만료 시 한 번만 호출한다.
 * 동시 호출은 같은 inflight Promise 에 매달려 단일 실행으로 합쳐진다.
 *
 * Race 가드: recompute 가 도는 중에 invalidateRankingsCache() 가 호출되면
 * (예: 새 세션이 저장됨) 완료된 결과는 이미 stale 이므로 lastCalcAt 을 갱신하지
 * 않고 0 으로 둔다 → 다음 read 가 다시 재계산.
 */
export async function ensureRankings(recompute: () => Promise<void>): Promise<void> {
  if (rankingsCacheTtlMs > 0 && lastCalcAt > 0 && Date.now() - lastCalcAt < rankingsCacheTtlMs) {
    return;
  }
  if (inflight) {
    return inflight;
  }
  const startEpoch = invalidationEpoch;
  inflight = (async () => {
    try {
      await recompute();
      if (invalidationEpoch === startEpoch) {
        lastCalcAt = Date.now();
      } else {
        // 진행 중 invalidate 가 들어왔으므로 결과를 신선한 것으로 표시하지 않는다.
        lastCalcAt = 0;
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/* ───────────────────────────────────────────────────────────
 * Task #168 — 야간/주기 재계산 배치
 *
 * Task #164 의 TTL 캐시는 "TTL 만료 후 첫 요청" 한 명이 전체 사용자 14일 창 재계산
 * 비용을 떠안는다. 사용자 수가 커지면 그 한 요청이 수 초 단위로 느려질 수 있다.
 * 부팅 시 등록되는 주기 작업이 미리 `rankings` 테이블 + 캐시 타임스탬프를 갱신해
 * 사용자 요청이 항상 캐시 hit 으로 떨어지도록 한다.
 *
 * - 주기/활성화는 `RANKINGS_REFRESH_INTERVAL_MS` 로 조절 (0 또는 음수 → 비활성).
 * - 배치는 `invalidateRankingsCache()` → `ensureRankings()` 순으로 도는데, 두 번째
 *   호출은 inflight 싱글플라이트라 같은 시점에 들어온 사용자 요청과도 합쳐진다.
 * - 배치 사이 사용자 변경은 기존 invalidate hook 으로 즉시 반영된다 (배치는 캐시
 *   warmup 보조이지 권위 소스가 아니다).
 * ─────────────────────────────────────────────────────────── */

export interface RankingsRefreshSchedulerOptions {
  /** 명시적 주기 (ms). 미지정 시 `RANKINGS_REFRESH_INTERVAL_MS` 환경변수 사용. */
  intervalMs?: number;
  /** 부팅 직후 한 번 즉시 실행할지 (기본 true). */
  runOnStart?: boolean;
  /** 로깅 hook (테스트에서 콘솔 노이즈 제거용). */
  logger?: { info?: (msg: string) => void; error?: (msg: string, err: unknown) => void };
}

function resolveIntervalMs(opts: RankingsRefreshSchedulerOptions): number {
  if (opts.intervalMs !== undefined) return opts.intervalMs;
  const raw = process.env.RANKINGS_REFRESH_INTERVAL_MS;
  if (raw === undefined || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 주기적으로 `recompute` 를 실행해 `rankings` 테이블과 캐시 타임스탬프를 미리
 * 채워둔다. 반환값은 스케줄러를 멈추는 함수 (테스트/셧다운 용).
 *
 * 주기가 0 이하면 스케줄러를 등록하지 않고 no-op stop 함수를 돌려준다 — 테스트나
 * 단일 인스턴스 개발 환경에서 의도적으로 배치를 끌 수 있게.
 */
export function startRankingsRefreshScheduler(
  recompute: () => Promise<void>,
  options: RankingsRefreshSchedulerOptions = {}
): () => void {
  const intervalMs = resolveIntervalMs(options);
  const info = options.logger?.info ?? ((msg: string) => console.log(msg));
  const error =
    options.logger?.error ?? ((msg: string, err: unknown) => console.error(msg, err));

  if (intervalMs <= 0) {
    info('🛌 Rankings refresh scheduler disabled (RANKINGS_REFRESH_INTERVAL_MS<=0).');
    return () => {};
  }

  const tick = async (): Promise<void> => {
    try {
      invalidateRankingsCache();
      await ensureRankings(recompute);
      info('🔁 Rankings refresh batch completed.');
    } catch (err) {
      error('⚠️  Rankings refresh batch failed:', err);
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }

  info(`⏱  Rankings refresh scheduler started (every ${intervalMs}ms).`);

  if (options.runOnStart !== false) {
    void tick();
  }

  return () => {
    clearInterval(timer);
  };
}
