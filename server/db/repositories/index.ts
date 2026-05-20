/**
 * Repository 모듈 인덱스 (Task #157)
 *
 * 각 entity 별 repository 함수의 단일 진입점.
 * 사용 예:
 *   import { findUserById, listSessions } from '../db/repositories/index.js';
 *
 * 주의: Repository 는 DB_TYPE=postgres 환경에서만 동작한다.
 *       Replit KV / LocalDB 백엔드에서는 호출 시 throw — 그 환경에서는
 *       기존 db.get/set/list KV 패턴을 그대로 사용하면 된다.
 */

export * from './users.js';
export * from './passwords.js';
export * from './organizations.js';
export * from './sessions.js';
export * from './metrics-scores.js';
export * from './raw-metrics.js';
export * from './rankings.js';
export * from './reports.js';
export * from './daily.js';
export * from './events.js';
export * from './terms.js';
