/**
 * 간단한 레이트 리미터 (in-memory + DB 백업).
 *
 * - composite key: `${ip}:${identifier}:${route}` 권장
 *   → 같은 IP로 여러 번호 공격 + 같은 번호로 여러 IP 공격 모두 차단
 * - 슬라이딩 윈도우 방식
 *
 * WARNING: 현재 in-memory 카운터 사용. 멀티 인스턴스 환경에서는 인스턴스별로 카운터가 분리되어
 * 실제 한도보다 N배 허용될 수 있음. 단일 인스턴스(Replit Reserved VM) 가정.
 * 멀티 인스턴스 확장 시 Redis나 PostgreSQL 기반으로 교체 필요.
 */

interface Bucket {
  hits: number[]; // epoch ms 배열
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  // 윈도우 밖 항목 정리
  bucket.hits = bucket.hits.filter((t) => now - t < opts.windowMs);

  if (bucket.hits.length >= opts.max) {
    const oldest = bucket.hits[0];
    const retryAfterMs = opts.windowMs - (now - oldest);
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return {
    allowed: true,
    remaining: opts.max - bucket.hits.length,
    retryAfterMs: 0,
  };
}

/**
 * Express Request에서 클라이언트 IP 추출.
 * 프록시 뒤에 있을 때(Replit) `x-forwarded-for` 첫 항목을 신뢰.
 */
export function getClientIp(req: { ip?: string; headers: Record<string, unknown> }): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

/**
 * 주기적으로 메모리 청소 (10분마다, 1시간 이상 유휴 키 제거)
 */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const IDLE_TTL_MS = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.hits.length === 0 || now - bucket.hits[bucket.hits.length - 1] > IDLE_TTL_MS) {
      buckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref?.();
