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

/** row 단일 객체를 camelCase 키로 변환 */
export function rowToCamel<T = any>(row: Record<string, any> | undefined): T | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const k of Object.keys(row)) {
    out[snakeToCamel(k)] = row[k];
  }
  return out as T;
}

/** row 배열을 camelCase 키로 변환 */
export function rowsToCamel<T = any>(rows: Record<string, any>[]): T[] {
  return rows.map((r) => rowToCamel<T>(r) as T);
}
