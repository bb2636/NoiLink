/**
 * 결과 화면 "이미 저장된 결과를 불러왔어요" 힌트(Task #65)의 1회성 노출을 위해
 * sessionId 기준 "본 적 있음" 표시를 localStorage 에 가볍게 영속한다 (Task #118).
 *
 * 정책:
 *  - 같은 sessionId 의 결과 화면을 두 번째 이상 열면 힌트가 노출되지 않는다.
 *  - 새로운 sessionId 의 캐시 hit 응답에서는 정상적으로 1회 노출된다.
 *  - 무한 누적을 막기 위해 사용자 키마다 최근 `MAX_ENTRIES` 개만 유지한다
 *    (LRU-by-write).
 *  - 비-브라우저 환경/quota 초과/잘못된 JSON 등 어떤 실패도 앱 흐름을
 *    깨지 않도록 try/catch 로 감싸 안전하게 폴백한다 (이 경우 힌트는 그냥
 *    한 번 더 노출될 수 있으나 사용자 흐름은 막지 않는다).
 *  - sessionId 가 비어 있으면 추적을 비활성화한다 — 호출자는 현재 동작
 *    그대로(=항상 노출) 폴백한다.
 *
 * Task #133 — 사용자별 prefix 키 분리:
 *  - 이전에는 단일 키(`noilink:replayed-hint-seen`)에 모든 sessionId 를 모아
 *    저장하고, 로그아웃 시 통째로 비웠다(Task #130). 그러나 같은 사용자가
 *    잠깐 로그아웃했다 다시 로그인한 경우에도 직전에 본 결과 화면에서 안내가
 *    한 번 더 뜨는 거슬림이 생겼다.
 *  - 회복 코칭 닫힘 기억(`recoveryCoachingDismissal`)과 동일한 패턴으로
 *    `<prefix>:<userId>` 키로 분리해 사용자별로 독립된 버킷을 갖도록 했다.
 *    덕분에 로그아웃 시 prefix 를 강제로 비우지 않아도:
 *      - 다른 계정으로 로그인하면 그 사용자의 (빈) 키만 보이므로 안내가 1회
 *        정상 노출된다 (현재 동작 유지).
 *      - 같은 계정으로 다시 로그인하면 자기 키가 그대로 살아 있어 직전에
 *        본 sessionId 의 안내는 다시 뜨지 않는다.
 *  - userId 가 비어 있으면(아직 인증 미수립/익명) 추적을 비활성화한다 —
 *    버킷이 없으니 hasSeen 은 false, mark 도 no-op.
 *  - `clearAllReplayedHintSeen` 은 prefix 의 모든 키를 스캔해 제거한다.
 *    현재는 로그아웃 흐름에서 호출하지 않으며(=같은 사용자 재로그인 보호),
 *    테스트와 배경 정리의 안전망으로만 남겨 둔다.
 *
 * Task #134 — 오래된 sessionId 기억 자동 정리:
 *  - LRU-by-write 상한(`REPLAYED_HINT_MAX_ENTRIES`)만으로는 결과 화면을 자주
 *    안 보는 사용자의 오래된 sessionId 가 자리를 차지할 수 있다(쓰기가 없으면
 *    LRU 가 동작하지 않음).
 *  - 회복 코칭 닫힘 기억의 `cleanupExpiredDismissals` 와 동일한 결로,
 *    `cleanupExpiredReplayedHintSeen` 가 너그러운 시간 만료(기본 30일)를
 *    적용해 prefix 의 모든 사용자 키를 스캔하며 오래 방치된 엔트리만 한 번에
 *    청소한다. 정상 사용자의 최근 기억은 절대 영향을 받지 않는다. 사용자
 *    버킷이 모두 만료되면 그 사용자의 키 자체도 제거된다(=잊혀진 사용자 키 청소).
 *  - 앱 부트시 한 번만 호출되도록 useAuth 의 첫 useEffect 에서 트리거된다.
 */

const STORAGE_KEY_PREFIX = 'noilink:replayed-hint-seen:';

/**
 * Task #118/#130 시절의 단일 키. 그 시점 사용자의 localStorage 에는
 * 이 키 하나에 모든 sessionId 가 모여 저장돼 있었다. Task #133 에서 사용자별
 * prefix 키(`noilink:replayed-hint-seen:<userId>`)로 옮겨 가면서 새 코드는
 * 이 단일 키를 더 이상 읽지 않는다 — 즉 기능 동작에는 영향이 없으나 죽은
 * 데이터로 사용자 기기에 영구히 남는다. 부트 시 한 번 안전하게 제거한다.
 *
 * 주의: prefix(위) 와 콜론 유무로 구분되므로, prefix 의 사용자 키
 * (`noilink:replayed-hint-seen:<userId>`) 와는 절대 충돌하지 않는다.
 */
export const LEGACY_REPLAYED_HINT_SEEN_KEY = 'noilink:replayed-hint-seen';

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

/** userId 가 비어 있으면 키를 만들지 않는다(=영속화 비활성화). */
export function replayedHintSeenKey(
  userId: string | null | undefined,
): string | null {
  if (!userId) return null;
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function readEntries(key: string): StoredEntry[] {
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage?.getItem(key) ?? null;
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

function writeEntries(key: string, entries: StoredEntry[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(entries));
  } catch {
    // 무시 — 다음 호출에서 재시도. 힌트가 한 번 더 떠도 치명적이지 않다.
  }
}

/** sessionId 의 결과 화면에서 replayed 힌트를 이미 본 적이 있는지 확인한다. */
export function hasSeenReplayedHint(
  userId: string | null | undefined,
  sessionId: string | null | undefined,
): boolean {
  if (!sessionId) return false;
  const key = replayedHintSeenKey(userId);
  if (!key) return false;
  return readEntries(key).some((e) => e.id === sessionId);
}

/**
 * sessionId 를 "본 적 있음" 으로 표시한다. 같은 id 가 이미 있으면 타임스탬프만
 * 갱신되고, MAX_ENTRIES 를 넘으면 가장 오래된 항목부터 제거된다.
 */
export function markReplayedHintSeen(
  userId: string | null | undefined,
  sessionId: string | null | undefined,
  now: number = Date.now(),
): void {
  if (!sessionId) return;
  const key = replayedHintSeenKey(userId);
  if (!key) return;
  const filtered = readEntries(key).filter((e) => e.id !== sessionId);
  filtered.push({ id: sessionId, at: now });
  while (filtered.length > REPLAYED_HINT_MAX_ENTRIES) {
    filtered.shift();
  }
  writeEntries(key, filtered);
}

/**
 * 같은 prefix(`noilink:replayed-hint-seen:*`)의 모든 키를 스캔한다.
 * localStorage 미지원/접근 거부 등의 환경에서는 빈 배열을 안전하게 반환한다.
 *
 * 키를 수집한 뒤 반환하므로, 호출자는 순회 중 removeItem 으로 인덱스가 어긋나는
 * 문제 없이 안전하게 수정할 수 있다.
 */
function listReplayedHintKeys(): string[] {
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
 * prefix 의 모든 "본 적 있음" 키를 제거한다.
 *
 * 주의: 현재 로그아웃 흐름에서는 호출하지 않는다. 같은 사용자가 다시
 * 로그인했을 때 자기 키가 살아 있도록 하기 위함(Task #133). 테스트와
 * 향후 배경 정리(별도 task)의 안전망으로 보관한다.
 *
 * @returns 실제로 제거된 키 개수.
 */
export function clearAllReplayedHintSeen(): number {
  const keys = listReplayedHintKeys();
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

/**
 * 너그러운 시간 만료(`retentionMs`, 기본 30일)를 넘긴 sessionId 엔트리와
 * 미래 타임스탬프(시계 변경) 엔트리를 한 번에 정리한다. prefix 의 모든 사용자
 * 키를 스캔해 각 키별로 만료 엔트리만 골라 제거하며, 한 사용자 키의 엔트리가
 * 모두 만료되면 그 키 자체도 제거한다(=잊혀진 사용자 키 청소). 손상된 JSON /
 * 배열이 아닌 값 / 형식이 어긋난 항목은 `readEntries` 가 이미 무시하므로,
 * 결과적으로 정규 직렬화로 덮어쓰면서 함께 청소된다.
 *
 * - 정상 사용자의 최근 기억은 건드리지 않는다 — 보존 한도(`retentionMs`) 안의
 *   엔트리는 그대로 유지된다.
 * - 어떤 단계에서도 throw 하지 않는다 — localStorage 가 막혀 있으면 0 반환.
 * - 사용자 키별로 변화가 없으면 그 키에 대한 쓰기를 생략한다(=정상 부트의
 *   비용은 키당 read 1회).
 *
 * @returns 만료/미래 타임스탬프 사유로 실제로 제거된 엔트리 개수(모든 사용자
 *   키 합산). 손상된 raw 값이 정리된 경우는 0 으로 잡히지만, 저장소 상태는
 *   정규화된다.
 */
export function cleanupExpiredReplayedHintSeen(
  now: number = Date.now(),
  retentionMs: number = REPLAYED_HINT_RETENTION_MS,
): number {
  const keys = listReplayedHintKeys();
  if (keys.length === 0) return 0;

  let removed = 0;
  for (const key of keys) {
    let raw: string | null = null;
    try {
      raw = globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      continue;
    }
    if (raw == null) continue;

    const entries = readEntries(key);
    const fresh = entries.filter(
      (e) => now - e.at <= retentionMs && e.at <= now,
    );

    // 정규 직렬화와 raw 가 동일하면 이 키는 변화 없음 — 쓰기를 생략해
    // 부트 비용을 키당 read 1회로 유지한다.
    const canonical = JSON.stringify(fresh);
    if (canonical === raw) continue;

    if (fresh.length === 0) {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        // 무시 — 다음 호출에서 재시도.
      }
    } else {
      writeEntries(key, fresh);
    }

    removed += entries.length - fresh.length;
  }
  return removed;
}

/**
 * Task #140 — 구버전(Task #118/#130)에서 쓰던 단일 키
 * (`noilink:replayed-hint-seen`)를 한 번에 제거한다.
 *
 * 새 코드(Task #133 이후)는 이 키를 더 이상 읽지 않으므로 기능에는 영향이
 * 없지만, 그 시절을 거친 사용자 기기에는 죽은 데이터가 영구히 남는다.
 * 앱 부트 시 한 번 안전하게 `removeItem` 해 둔다.
 *
 * - 키가 없으면 no-op (false 반환).
 * - localStorage 미지원/접근 거부 등의 환경에서도 throw 하지 않는다.
 * - prefix 의 사용자 키(`noilink:replayed-hint-seen:<userId>`) 는 콜론 유무로
 *   구분되므로 영향을 받지 않는다.
 *
 * @returns 실제로 키를 제거했는지 여부.
 */
export function clearLegacyReplayedHintSeenKey(): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    if (storage.getItem(LEGACY_REPLAYED_HINT_SEEN_KEY) == null) return false;
    storage.removeItem(LEGACY_REPLAYED_HINT_SEEN_KEY);
    return true;
  } catch {
    return false;
  }
}
