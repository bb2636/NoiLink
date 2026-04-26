/**
 * 서버 측 idempotency 헬퍼.
 *
 * 동기:
 *  - 클라이언트가 결과 저장(createSession, metrics 계산)을 자동/백그라운드 재시도한다.
 *  - 한 요청이 서버엔 도달했지만 응답이 클라이언트에 닿기 전에 네트워크가 끊기면,
 *    재시도 시 서버에는 같은 트레이닝이 두 건으로 저장될 수 있다.
 *  - 클라이언트가 안정적인 `Idempotency-Key`(큐의 `localId`)를 보내고,
 *    서버가 그 키에 대한 첫 응답을 캐시해 두면 두 번째 요청은 같은 결과를 그대로 받고
 *    부수효과(insert)는 한 번만 일어난다.
 *
 * 정책:
 *  - 키가 없으면 캐싱 없이 그대로 핸들러 실행 (기존 동작 유지).
 *  - 키가 있으면 (scope, userId, key) 로 묶어 응답을 캐시한다.
 *    - scope 는 라우트별 식별자(예: 'sessions.create'), userId 는 호출자.
 *      서로 다른 라우트/사용자가 같은 키를 보내도 충돌하지 않는다.
 *  - 2xx 응답만 캐시한다. 4xx/5xx 는 일시 실패일 수 있으므로 다음 재시도가 통상 흐름을 다시 타게 한다.
 *  - 캐시 항목은 TTL(기본 24h) 이후 만료된다.
 *  - 저장은 단일 KV 키(`idempotency`) 아래의 객체로 모든 DB 백엔드(Postgres/Replit/local JSON)에서 동일하게 동작.
 *  - 같은 키의 동시 재시도(레이스)는 본 작업의 범위가 아니다 — 클라이언트는 백오프된 순차 재시도이므로
 *    실제 운영에서는 사실상 발생하지 않는다.
 */

import type { Request, Response } from 'express';
import { db } from '../db.js';

/** TTL — 같은 트레이닝 결과의 재시도 윈도우는 길어야 수 분이지만, 안전하게 24h 유지. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** 한 번에 보관할 최대 항목 수 — 폭주를 막기 위한 안전 상한. */
export const IDEMPOTENCY_MAX_ENTRIES = 1000;
/** 키 길이 상한 — 비정상 헤더 방어. */
export const IDEMPOTENCY_MAX_KEY_LEN = 200;
/** KV 저장소 키. */
export const IDEMPOTENCY_STORE_KEY = 'idempotency';
/**
 * 캐시 hit 으로 응답을 그대로 재반환할 때 함께 내려보내는 응답 헤더.
 * 클라이언트는 이 헤더가 붙은 응답을 보면 "방금 보낸 요청은 사실 이미 서버에 도달해
 * 첫 응답을 받은 적이 있다" 는 사실을 알 수 있다 — 같은 결과를 두 번 안내해
 * 사용자를 혼란시키는 일을 막기 위한 신호.
 *
 * 본문(body)은 첫 응답을 그대로 보존하기 위해 절대 변경하지 않는다(동일성 회귀
 * 테스트가 보호 중). 따라서 replayed 신호는 헤더로만 흘려보낸다.
 */
export const IDEMPOTENCY_REPLAYED_HEADER = 'X-Idempotent-Replayed';

export interface IdempotencyEntry {
  status: number;
  body: unknown;
  /** 저장 시각(ms). TTL 만료 판정에 사용. */
  createdAt: number;
}

export type IdempotencyStore = Record<string, IdempotencyEntry>;

/**
 * 요청에서 `Idempotency-Key` 헤더를 추출. 없거나 비정상이면 undefined.
 * 헤더 표준상 대소문자 구분 없음(express 의 `req.header` 가 자동 처리).
 */
export function readIdempotencyKey(req: Request): string | undefined {
  const raw = req.header('Idempotency-Key');
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > IDEMPOTENCY_MAX_KEY_LEN) return undefined;
  return trimmed;
}

/** 라우트 scope, 사용자, 클라이언트 키를 합쳐 충돌 없는 캐시 키를 만든다. */
export function buildIdempotencyCacheKey(scope: string, userId: string, key: string): string {
  return `${scope}|${userId}|${key}`;
}

async function loadStore(): Promise<IdempotencyStore> {
  const raw = (await db.get(IDEMPOTENCY_STORE_KEY)) as IdempotencyStore | undefined;
  return raw && typeof raw === 'object' ? raw : {};
}

async function saveStore(store: IdempotencyStore): Promise<void> {
  await db.set(IDEMPOTENCY_STORE_KEY, store);
}

/**
 * 만료된 항목을 제거하고, 그래도 상한을 넘으면 최근 항목만 남긴다.
 * 새 항목을 쓰기 직전에 한 번 호출해 점진적으로 정리한다.
 */
export function pruneIdempotencyStore(store: IdempotencyStore, now: number): IdempotencyStore {
  const live: IdempotencyStore = {};
  for (const [k, v] of Object.entries(store)) {
    if (!v || typeof v !== 'object') continue;
    if (now - v.createdAt < IDEMPOTENCY_TTL_MS) live[k] = v;
  }
  const entries = Object.entries(live);
  if (entries.length <= IDEMPOTENCY_MAX_ENTRIES) return live;
  // 최신 순으로 잘라낸다.
  entries.sort((a, b) => b[1].createdAt - a[1].createdAt);
  const trimmed: IdempotencyStore = {};
  for (const [k, v] of entries.slice(0, IDEMPOTENCY_MAX_ENTRIES)) trimmed[k] = v;
  return trimmed;
}

export interface IdempotencyOptions {
  /** 라우트 식별자. 같은 키를 보내도 라우트별로 캐시가 분리된다. */
  scope: string;
  /** 호출자 식별자. 다른 사용자의 캐시와 절대 섞이지 않게 한다. */
  userId: string;
}

/**
 * 핸들러를 idempotency 보호로 감싼다.
 *  - 헤더가 없으면 그대로 실행.
 *  - 헤더가 있고 캐시 hit 이면 캐시된 status/body 를 반환(핸들러 미실행).
 *  - 헤더가 있고 miss 이면 핸들러 실행 후 2xx 응답만 캐시.
 *
 * 사용처는 라우트 핸들러의 *부수효과 발생 직전* 에서 호출해야 안전하다.
 * (인증 검증 후 호출하면 자연스럽게 사용자 검증을 통과한 요청만 캐시된다.)
 */
export async function withIdempotency(
  req: Request,
  res: Response,
  opts: IdempotencyOptions,
  handler: () => Promise<void>,
): Promise<void> {
  const rawKey = readIdempotencyKey(req);
  if (!rawKey) {
    await handler();
    return;
  }

  const cacheKey = buildIdempotencyCacheKey(opts.scope, opts.userId, rawKey);
  const now = Date.now();
  const store = await loadStore();
  const hit = store[cacheKey];
  if (hit && now - hit.createdAt < IDEMPOTENCY_TTL_MS) {
    // 본문은 첫 응답과 비트 수준에서 동일하게 유지(회귀 테스트가 동일성 보장)하고,
    // "이건 첫 응답의 재반환이다" 라는 신호는 헤더로만 흘려보낸다 — 클라이언트는
    // 이 헤더를 보고 사용자에게 "이미 저장된 결과를 불러왔어요" 식의 1회성 안내를
    // 띄울 수 있다.
    res.setHeader(IDEMPOTENCY_REPLAYED_HEADER, 'true');
    res.status(hit.status).json(hit.body);
    return;
  }

  // 핸들러 실행 동안 status/json 호출을 캡처한다.
  // res.status() 는 체이닝되므로 마지막으로 설정된 값이 실제 응답 코드다.
  let capturedStatus = 200;
  let capturedBody: unknown = undefined;
  let didRespond = false;

  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);

  res.status = ((code: number) => {
    capturedStatus = code;
    return originalStatus(code);
  }) as Response['status'];

  res.json = ((body: unknown) => {
    capturedBody = body;
    didRespond = true;
    return originalJson(body);
  }) as Response['json'];

  try {
    await handler();
  } finally {
    res.status = originalStatus;
    res.json = originalJson;
  }

  // 2xx 응답만 캐시한다 — 4xx/5xx 는 다음 재시도가 통상 흐름을 다시 타도록 둔다.
  if (didRespond && capturedStatus >= 200 && capturedStatus < 300) {
    const next = pruneIdempotencyStore(store, now);
    next[cacheKey] = { status: capturedStatus, body: capturedBody, createdAt: now };
    await saveStore(next);
  }
}
