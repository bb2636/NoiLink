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

/** 세션 저장/삭제/리셋 hook 에서 호출 — 다음 read 가 강제 재계산하도록 만든다. */
export function invalidateRankingsCache(): void {
  lastCalcAt = 0;
}

/** 테스트 헬퍼 — TTL 을 명시적으로 조정하고 캐시를 리셋한다. */
export function __setRankingsCacheTtlForTests(ms: number): void {
  rankingsCacheTtlMs = ms;
  lastCalcAt = 0;
  inflight = null;
}

/**
 * recompute 콜백을 TTL 안에서는 스킵, TTL 만료 시 한 번만 호출한다.
 * 동시 호출은 같은 inflight Promise 에 매달려 단일 실행으로 합쳐진다.
 */
export async function ensureRankings(recompute: () => Promise<void>): Promise<void> {
  if (rankingsCacheTtlMs > 0 && lastCalcAt > 0 && Date.now() - lastCalcAt < rankingsCacheTtlMs) {
    return;
  }
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    try {
      await recompute();
      lastCalcAt = Date.now();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
