/**
 * Repository 공통 유틸 (Task #157 + Task #158)
 *
 * Task #158: 모든 repository 함수가 dual-mode 로 동작한다.
 *  - Postgres 백엔드: SQL 경로 사용 (성능/메모리 이득).
 *  - Replit KV / LocalDB / 테스트 mock 백엔드: 기존 KV 컬렉션
 *    (`db.get(collection)` / `db.set(collection, ...)`) 으로 폴백.
 *
 *  이 폴백 덕분에 service/route 코드는 모든 환경에서 repository 함수만
 *  호출하면 되고, 테스트는 종전처럼 `vi.mock('../db.js')` 의 KV 인메모리
 *  store 를 그대로 사용할 수 있다.
 */

import type { Pool } from 'pg';
import { db } from '../../db.js';

let pgPoolCache: Pool | null = null;
let pgChecked = false;
let pgAvailable = false;

/**
 * 현재 db 백엔드가 Postgres 인지 확인하고 Pool 을 캐시한다.
 * 결과는 프로세스 lifetime 동안 캐시된다 (DB 백엔드는 부팅 시 결정됨).
 */
export async function isPostgresBackend(): Promise<boolean> {
  if (pgChecked) return pgAvailable;
  try {
    if (!db.isConnected()) await db.connect();
  } catch {
    // ignore — fall through to availability check
  }
  // 주의: db.ts 의 dbWrapper 에는 항상 getPool 이 합쳐져 있으므로 wrapper 의 메서드
  // 존재 여부로는 판정 불가. 실제로 결정된 내부 백엔드 인스턴스를 확인하는
  // `db.isPostgresBackend()` 헬퍼를 사용해야 KV/LocalDB fallback 분기가 동작한다.
  const wrapper = db as unknown as { isPostgresBackend?: () => Promise<boolean> };
  if (typeof wrapper.isPostgresBackend === 'function') {
    pgAvailable = await wrapper.isPostgresBackend();
  } else {
    // 구버전 호환 — wrapper 가 헬퍼를 노출하지 않으면 false 로 간주해 KV 폴백.
    pgAvailable = false;
  }
  pgChecked = true;
  return pgAvailable;
}

/** 테스트용 — 캐시 무효화. */
export function _resetBackendCacheForTests(): void {
  pgChecked = false;
  pgAvailable = false;
  pgPoolCache = null;
}

export async function getPool(): Promise<Pool> {
  if (pgPoolCache) return pgPoolCache;
  if (!db.isConnected()) {
    await db.connect();
  }
  const maybe = db as unknown as { getPool?: () => Promise<Pool> };
  if (typeof maybe.getPool !== 'function') {
    throw new Error(
      'getPool(): 현재 DB 백엔드가 Postgres 가 아닙니다. DB_TYPE=postgres 환경에서만 repository 를 호출하세요.'
    );
  }
  pgPoolCache = await maybe.getPool();
  return pgPoolCache;
}

/** snake_case → camelCase */
export function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * 약어 그룹(SD, BPM, URL, ID 등)이 shared 타입에서 대문자로 표기되는 필드 alias.
 * snakeToCamel('rt_sd') = 'rtSd' 인데 shared 타입은 'rtSD' 를 쓰므로,
 * 변환 직후 camelKey → fixedKey 로 한 번 더 매핑해 정렬한다.
 *
 * Task #159 통합 테스트가 rt_sd/rtSD 미스매치를 잡아낸 뒤 raw-metrics.ts 에 인라인
 * 보정이 들어갔는데, 동일 패턴이 다른 컬럼에 또 생길 수 있어 Task #161 에서
 * 중앙화했다. 새 약어 컬럼(예: `*_bpm`, `*_url`) 을 schema 에 추가하면 여기에
 * 한 줄 더 등록하면 모든 repository 가 자동으로 정렬된다.
 *
 * 현재 SQL 평탄 컬럼 중 약어 충돌은 `rt_sd` 하나뿐 — 나머지 SD/BPM 필드
 * (offsetSD/reactionTimeSD/targetBPM/recommendedBPM) 는 모두 JSONB payload 안에
 * 들어있어 snake→camel 변환을 거치지 않는다. (Task #161 audit 결과)
 */
export const ACRONYM_FIELD_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  rtSd: 'rtSD',
});

/** row 단일 객체를 camelCase 키로 변환 (약어 alias 자동 적용) */
export function rowToCamel<T = any>(row: Record<string, any> | undefined): T | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const k of Object.keys(row)) {
    const camel = snakeToCamel(k);
    const aliased = ACRONYM_FIELD_ALIASES[camel] ?? camel;
    out[aliased] = row[k];
  }
  return out as T;
}

/** row 배열을 camelCase 키로 변환 */
export function rowsToCamel<T = any>(rows: Record<string, any>[]): T[] {
  return rows.map((r) => rowToCamel<T>(r) as T);
}

/* ───────────────────────────────────────────────────────────
 * KV 폴백 헬퍼 — Postgres 가 아닌 백엔드 (Replit KV / Local JSON / 테스트 mock) 에서
 * 사용. 컬렉션 이름은 기존 KV 키와 일치한다.
 * ─────────────────────────────────────────────────────────── */

export async function kvGetCollection<T = any>(collection: string): Promise<T[]> {
  const v = await db.get(collection);
  return Array.isArray(v) ? (v as T[]) : [];
}

export async function kvSetCollection<T = any>(
  collection: string,
  rows: T[]
): Promise<void> {
  await db.set(collection, rows);
}

/** id 기반 upsert (push or replace by predicate). */
export async function kvUpsert<T>(
  collection: string,
  item: T,
  match: (existing: T) => boolean
): Promise<void> {
  const all = await kvGetCollection<T>(collection);
  const idx = all.findIndex(match);
  if (idx >= 0) all[idx] = item;
  else all.push(item);
  await kvSetCollection(collection, all);
}

/** 조건 일치하는 첫 항목 제거. */
export async function kvDelete<T>(
  collection: string,
  match: (existing: T) => boolean
): Promise<void> {
  const all = await kvGetCollection<T>(collection);
  const filtered = all.filter((x) => !match(x));
  if (filtered.length !== all.length) {
    await kvSetCollection(collection, filtered);
  }
}

/** 컬렉션 전체 삭제. */
export async function kvClear(collection: string): Promise<void> {
  await db.set(collection, []);
}
