/**
 * 결과 화면 "이미 저장된 결과를 불러왔어요" 힌트(Task #65)의 1회성 노출을 위해
 * sessionId 기준 "본 적 있음" 표시를 localStorage 에 가볍게 영속한다 (Task #118).
 *
 * 정책:
 *  - 같은 sessionId 의 결과 화면을 두 번째 이상 열면 힌트가 노출되지 않는다.
 *  - 새로운 sessionId 의 캐시 hit 응답에서는 정상적으로 1회 노출된다.
 *  - 저장은 단일 키(`noilink:replayed-hint-seen`) 하위 JSON 배열로 단순화한다.
 *    값은 `{ id: <sessionId>, at: <unix_ms> }` 의 가벼운 엔트리.
 *  - 무한 누적을 막기 위해 최근 `MAX_ENTRIES` 개만 유지한다 (LRU-by-write).
 *  - 비-브라우저 환경/quota 초과/잘못된 JSON 등 어떤 실패도 앱 흐름을
 *    깨지 않도록 try/catch 로 감싸 안전하게 폴백한다 (이 경우 힌트는 그냥
 *    한 번 더 노출될 수 있으나 사용자 흐름은 막지 않는다).
 *  - sessionId 가 비어 있으면 추적을 비활성화한다 — 호출자는 현재 동작
 *    그대로(=항상 노출) 폴백한다.
 *
 * Task #134 — 오래된 sessionId 기억 자동 정리:
 *  - LRU-by-write 상한(`REPLAYED_HINT_MAX_ENTRIES`)만으로는 결과 화면을 자주
 *    안 보는 사용자의 오래된 sessionId 가 자리를 차지할 수 있다(쓰기가 없으면
 *    LRU 가 동작하지 않음).
 *  - 회복 코칭 닫힘 기억의 `cleanupExpiredDismissals` 와 동일한 결로,
 *    `cleanupExpiredReplayedHintSeen` 가 너그러운 시간 만료(기본 30일)를
 *    적용해 오래 방치된 엔트리만 한 번에 청소한다. 정상 사용자의 최근 기억은
 *    절대 영향을 받지 않는다.
 *  - 앱 부트시 한 번만 호출되도록 useAuth 의 첫 useEffect 에서 트리거된다.
 */

const STORAGE_KEY = 'noilink:replayed-hint-seen';

/** 저장하는 최근 엔트리 개수 상한. 너무 적으면 회귀, 너무 많으면 무의미한 누적. */
export const REPLAYED_HINT_MAX_ENTRIES = 50;

/**
 * 오래 방치된 sessionId 기억의 보존 한도(기본 30일).
 * LRU 상한(`REPLAYED_HINT_MAX_ENTRIES`)이 동작하지 않는 "쓰기 없는 장기 휴면"
 * 구간에서도 안전망이 되도록 회복 코칭 닫힘 기억의 보존 한도와 같은 30일을 둔다.
 */
export const REPLAYED_HINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredEntry {
  id: string;
  at: number;
}

function readEntries(): StoredEntry[] {
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is StoredEntry =>
        e != null &&
        typeof e === 'object' &&
        typeof (e as StoredEntry).id === 'string' &&
        typeof (e as StoredEntry).at === 'number' &&
        Number.isFinite((e as StoredEntry).at),
    );
  } catch {
    return [];
  }
}

function writeEntries(entries: StoredEntry[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // 무시 — 다음 호출에서 재시도. 힌트가 한 번 더 떠도 치명적이지 않다.
  }
}

/** sessionId 의 결과 화면에서 replayed 힌트를 이미 본 적이 있는지 확인한다. */
export function hasSeenReplayedHint(
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false;
  return readEntries().some((e) => e.id === sessionId);
}

/**
 * sessionId 를 "본 적 있음" 으로 표시한다. 같은 id 가 이미 있으면 타임스탬프만
 * 갱신되고, MAX_ENTRIES 를 넘으면 가장 오래된 항목부터 제거된다.
 */
export function markReplayedHintSeen(
  sessionId: string | null | undefined,
  now: number = Date.now(),
): void {
  if (!sessionId) return;
  const filtered = readEntries().filter((e) => e.id !== sessionId);
  filtered.push({ id: sessionId, at: now });
  while (filtered.length > REPLAYED_HINT_MAX_ENTRIES) {
    filtered.shift();
  }
  writeEntries(filtered);
}

/** 테스트/로그아웃 등에서 모든 기억을 비운다. */
export function clearAllReplayedHintSeen(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // 무시.
  }
}

/**
 * 너그러운 시간 만료(`retentionMs`, 기본 30일)를 넘긴 sessionId 엔트리와
 * 미래 타임스탬프(시계 변경) 엔트리를 한 번에 정리한다. 손상된 JSON / 배열이
 * 아닌 값 / 형식이 어긋난 항목은 `readEntries` 가 이미 무시하므로, 결과적으로
 * 정규 직렬화로 덮어쓰면서 함께 청소된다.
 *
 * - 정상 사용자의 최근 기억은 건드리지 않는다 — 보존 한도(`retentionMs`) 안의
 *   엔트리는 그대로 유지된다.
 * - 어떤 단계에서도 throw 하지 않는다 — localStorage 가 막혀 있으면 0 반환.
 * - 변화가 없으면 쓰기조차 하지 않는다(=정상 부트의 비용은 read 1회).
 *
 * @returns 만료/미래 타임스탬프 사유로 실제로 제거된 엔트리 개수. 손상된 raw
 *   값이 정리된 경우는 0 으로 잡히지만, 저장소 상태는 정규화된다.
 */
export function cleanupExpiredReplayedHintSeen(
  now: number = Date.now(),
  retentionMs: number = REPLAYED_HINT_RETENTION_MS,
): number {
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return 0;
  }
  if (raw == null) return 0;

  const entries = readEntries();
  const fresh = entries.filter(
    (e) => now - e.at <= retentionMs && e.at <= now,
  );

  // 정규 직렬화와 raw 가 동일하면 변화 없음 — 쓰기를 생략해 부트 비용을 0 에 가깝게.
  const canonical = JSON.stringify(fresh);
  if (canonical === raw) return 0;

  if (fresh.length === 0) {
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      // 무시.
    }
  } else {
    writeEntries(fresh);
  }

  return entries.length - fresh.length;
}
