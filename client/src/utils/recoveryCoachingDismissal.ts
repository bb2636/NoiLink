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
 */

const STORAGE_KEY_PREFIX = 'noilink:recovery-coaching-dismissed:';

/** 닫힘 기억이 자동 만료되는 시간 — 사용자가 자리를 비운 사이 트립이 새로 시작했을 가능성 보호. */
export const DISMISSAL_TTL_MS = 24 * 60 * 60 * 1000;

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
