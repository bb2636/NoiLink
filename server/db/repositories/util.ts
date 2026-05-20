/**
 * Repository 공통 유틸 (Task #157)
 *
 * - getPool(): PostgresDB 의 풀에 안전하게 접근. db.query/transaction 을 거치지 않고
 *   직접 SQL 을 실행해야 하는 repository 함수가 사용한다.
 * - rowsToObjects(): pg row → snake_case → camelCase 변환 헬퍼.
 *
 * 주의: 이 모듈은 Postgres 백엔드 전용이다. DB_TYPE 이 replit/local 인 환경에서
 * repository 호출은 명시적 throw 로 실패한다 — 그 환경에서는 기존 db.get/set 패턴을
 * 그대로 쓰면 된다. Repository → SQL 경로는 운영 (DB_TYPE=postgres) 에서만 활성화.
 */

import type { Pool } from 'pg';
import { db } from '../../db.js';

/**
 * 현재 db 인스턴스에서 pg Pool 을 꺼낸다.
 * - PostgresDB 인 경우만 동작 (PostgresDB.getPool() 메서드 사용).
 * - 다른 어댑터 (Replit KV / LocalDB) 면 명시적으로 throw.
 */
export async function getPool(): Promise<Pool> {
  if (!db.isConnected()) {
    await db.connect();
  }
  const maybe = db as unknown as { getPool?: () => Promise<Pool> };
  if (typeof maybe.getPool !== 'function') {
    throw new Error(
      'getPool(): 현재 DB 백엔드가 Postgres 가 아닙니다. DB_TYPE=postgres 환경에서만 repository 를 호출하세요.'
    );
  }
  return await maybe.getPool();
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
