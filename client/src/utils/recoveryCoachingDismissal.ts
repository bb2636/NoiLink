/**
 * "환경 점검" 회복 코칭 카드 닫힘 상태를 사용자별로 가볍게 기억한다 (Task #74).
 *
 * 정책:
 *  - 사용자가 카드를 닫으면 같은 "트립(trip)" 동안에는 다시 노출하지 않는다.
 *    여기서 트립이란 `shouldShowRecoveryCoaching` 가 연속으로 true 인 구간을 말한다.
 *  - 신호가 임계 미만으로 내려가 트립이 끝나면 닫힘 기억을 초기화한다 —
 *    다음에 다시 임계를 넘으면(새 트립) 카드가 다시 등장해야 한다.
 *  - 그러나 사용자가 앱에 들어와 있지 않은 동안 임계 아래로 내려갔다 다시 올라가면
 *    런타임에서 그 false 구간을 관측하지 못해 닫힘 기억이 영구히 남을 수 있다.
 *    이를 막기 위해 닫힘 기억에 24h TTL 을 둔다 — 만료된 기억은 자동으로 무효 처리.
 *    (브리프 허용 범위: "예: 24시간 또는 다음 트레이닝까지").
 *  - 키는 사용자 id 별로 분리한다(`<prefix>:<userId>`). 다른 계정으로 로그인하면
 *    영향이 없도록.
 *
 * 저장은 localStorage 1키로 단순화한다. 값은 `{ at: <unix_ms> }` JSON.
 * 비-브라우저 환경/quota 초과/잘못된 JSON 등 어떤 실패도 앱 흐름을 깨지 않도록
 * try/catch 로 보호한다.
 *
 * Task #98 — 오래된 닫힘 기억 자동 정리:
 *  - 키는 사용자 id 별로 만들어지므로, 한 기기에서 여러 계정을 거치거나
 *    오랫동안 홈에 들어오지 않으면 다른 사용자의 기억 키가 localStorage 에
 *    누적될 수 있다.
 *  - `cleanupExpiredDismissals` 가 같은 prefix 의 모든 키를 안전하게 스캔해
 *    가벼운 만료(기본 30일) 또는 손상된 값을 정리한다. 단일 키의 24h TTL
 *    (`DISMISSAL_TTL_MS`)는 "다음 트립을 막지 않기" 위한 짧은 만료이고,
 *    이 prefix 스캔은 그보다 훨씬 너그러운 보존 한도를 두어 "잊혀진 사용자"
 *    키가 무한히 남지 않도록 하는 안전망이다.
 *  - `clearAllDismissals` 는 로그아웃 시점에 prefix 의 모든 키를 한 번에
 *    비운다 — 다음에 같은 기기에서 누가 로그인하든 깨끗한 상태로 시작.
 */

const STORAGE_KEY_PREFIX = 'noilink:recovery-coaching-dismissed:';

/** 닫힘 기억이 자동 만료되는 시간 — 사용자가 자리를 비운 사이 트립이 새로 시작했을 가능성 보호. */
export const DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * prefix 스캔 정리에서 사용하는 너그러운 보존 한도(기본 30일).
 * 단일 키 TTL(`DISMISSAL_TTL_MS`, 24h)보다 훨씬 길게 잡아, 활동 중인 사용자의
 * 정상 기억은 건드리지 않으면서 오래 방치된 키만 청소한다.
 */
export const DISMISSAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredDismissal {
  at: number;
}

/** 사용자 id 가 비어 있으면 키를 만들지 않는다(=영속화 비활성화). */
export function recoveryCoachingDismissalKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function parseStored(raw: string | null): StoredDismissal | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && typeof obj.at === 'number' && Number.isFinite(obj.at)) {
      return { at: obj.at };
    }
  } catch {
    // 손상된 값 — 무시하고 미닫힘 처리.
  }
  return null;
}

export function readDismissed(
  userId: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const key = recoveryCoachingDismissalKey(userId);
  if (!key) return false;
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return false;
  }
  const stored = parseStored(raw);
  if (!stored) return false;
  // TTL 초과 또는 미래 타임스탬프(시계 변경) → 무효.
  if (now - stored.at > DISMISSAL_TTL_MS || stored.at > now) {
    // 만료된 키를 청소해 둔다 — readDismissed 가 다음 호출에서 다시 파싱하지 않도록.
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      // 무시.
    }
    return false;
  }
  return true;
}

export function writeDismissed(
  userId: string | null | undefined,
  now: number = Date.now(),
): void {
  const key = recoveryCoachingDismissalKey(userId);
  if (!key) return;
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify({ at: now } satisfies StoredDismissal));
  } catch {
    // 무시 — 안내가 한 세션 안에서 다시 떠도 치명적이지 않다.
  }
}

export function clearDismissed(userId: string | null | undefined): void {
  const key = recoveryCoachingDismissalKey(userId);
  if (!key) return;
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // 무시.
  }
}

/**
 * 같은 prefix(`noilink:recovery-coaching-dismissed:*`)의 모든 키를 스캔한다.
 * localStorage 미지원/접근 거부 등의 환경에서는 빈 배열을 안전하게 반환한다.
 *
 * 키를 수집한 뒤 반환하므로, 호출자는 순회 중 removeItem 으로 인덱스가 어긋나는
 * 문제 없이 안전하게 수정할 수 있다.
 */
function listDismissalKeys(): string[] {
  const storage = (() => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  })();
  if (!storage) return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(STORAGE_KEY_PREFIX)) keys.push(k);
    }
  } catch {
    return [];
  }
  return keys;
}

/**
 * prefix 의 모든 키를 스캔해 가벼운 만료(`retentionMs`, 기본 30일)를 넘긴
 * 항목 또는 손상된/미래 타임스탬프 항목을 제거한다.
 *
 * - 정상 동작 중인 사용자의 기억은 건드리지 않는다(짧은 24h TTL 은 read-side 에서
 *   따로 처리). 이 함수는 "잊혀진 키" 만 청소하는 안전망 역할.
 * - 어떤 단계에서도 throw 하지 않는다 — localStorage 가 막혀 있으면 0 반환.
 *
 * @returns 실제로 제거된 키 개수.
 */
export function cleanupExpiredDismissals(
  now: number = Date.now(),
  retentionMs: number = DISMISSAL_RETENTION_MS,
): number {
  const keys = listDismissalKeys();
  if (keys.length === 0) return 0;
  let removed = 0;
  for (const key of keys) {
    let raw: string | null = null;
    try {
      raw = globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      continue;
    }
    const stored = parseStored(raw);
    // 손상된 값(=parseStored null) 또는 retention 초과/미래 타임스탬프 → 제거.
    const isStale =
      !stored || now - stored.at > retentionMs || stored.at > now;
    if (!isStale) continue;
    try {
      globalThis.localStorage?.removeItem(key);
      removed += 1;
    } catch {
      // 무시 — 다음 호출에서 재시도.
    }
  }
  return removed;
}

/**
 * prefix 의 모든 닫힘 기억 키를 제거한다 — 로그아웃 시점에 호출.
 * 같은 기기에서 다른 계정으로 로그인하더라도 이전 사용자의 기억이 남지 않는다.
 *
 * @returns 실제로 제거된 키 개수.
 */
export function clearAllDismissals(): number {
  const keys = listDismissalKeys();
  let removed = 0;
  for (const key of keys) {
    try {
      globalThis.localStorage?.removeItem(key);
      removed += 1;
    } catch {
      // 무시.
    }
  }
  return removed;
}
