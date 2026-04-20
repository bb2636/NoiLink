/**
 * 간단한 레이트 리미터 (in-memory).
 *
 * - composite key: `${ip}:${identifier}:${route}` 권장
 *   → 같은 IP로 여러 번호 공격 + 같은 번호로 여러 IP 공격 모두 차단
 * - 슬라이딩 윈도우 방식
 * - 윈도우가 비면 즉시 키 삭제 (메모리 누수 방지)
 * - 안전장치: 전체 키 수가 MAX_KEYS 초과 시 가장 오래된 것부터 정리
 *
 * WARNING: 현재 in-memory 카운터 사용. 멀티 인스턴스 환경에서는 인스턴스별로 카운터가 분리되어
 * 실제 한도보다 N배 허용될 수 있음. 단일 인스턴스(Replit Reserved VM) 가정.
 * 멀티 인스턴스 확장 시 Redis나 PostgreSQL 기반으로 교체 필요.
 */

interface Bucket {
  hits: number[]; // epoch ms 배열
  lastAccessAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

function evictOldestIfFull(): void {
  if (buckets.size < MAX_KEYS) return;
  // 가장 오래 미사용 키 1/10을 제거 (대량 삭제로 amortized O(1))
  const sorted = Array.from(buckets.entries()).sort(
    (a, b) => a[1].lastAccessAt - b[1].lastAccessAt,
  );
  const toRemove = Math.ceil(MAX_KEYS / 10);
  for (let i = 0; i < toRemove && i < sorted.length; i++) {
    buckets.delete(sorted[i][0]);
  }
  console.warn(`[rate-limit] cap reached (${MAX_KEYS}), evicted ${toRemove} oldest keys`);
}

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [], lastAccessAt: now };
  // 윈도우 밖 항목 정리
  bucket.hits = bucket.hits.filter((t) => now - t < opts.windowMs);

  if (bucket.hits.length >= opts.max) {
    const oldest = bucket.hits[0];
    const retryAfterMs = opts.windowMs - (now - oldest);
    bucket.lastAccessAt = now;
    buckets.set(key, bucket);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  bucket.hits.push(now);
  bucket.lastAccessAt = now;

  // 윈도우가 비어있고 새 hit가 만료 직전이면(거의 없음) 그래도 set은 필요
  if (bucket.hits.length === 0) {
    buckets.delete(key);
  } else {
    if (!buckets.has(key)) {
      evictOldestIfFull();
    }
    buckets.set(key, bucket);
  }

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
 * 주기적 메모리 청소 (5분마다, 1시간 이상 유휴 키 제거).
 * checkRateLimit이 윈도우 만료 시 즉시 정리하지만, 호출되지 않은 키는 남을 수 있음.
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_TTL_MS = 60 * 60 * 1000;

const interval = setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastAccessAt > IDLE_TTL_MS) {
      buckets.delete(key);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[rate-limit] cleanup: removed ${removed} idle keys, total=${buckets.size}`);
  }
}, CLEANUP_INTERVAL_MS);
interval.unref?.();
