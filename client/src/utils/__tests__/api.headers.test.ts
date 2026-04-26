/**
 * ApiClient 의 요청 헤더 합성 회귀 테스트.
 *
 * 보호 대상:
 *  - caller 가 추가 헤더(예: Idempotency-Key)를 넘겨도, ApiClient 가 자체적으로 붙이는
 *    Authorization / Content-Type 이 절대 사라지지 않아야 한다. (인증 보호 라우트 호출의 생명선)
 *  - 토큰이 없을 땐 Authorization 헤더가 없어야 한다.
 *  - Idempotency-Key 옵션이 createSession / calculateMetrics / saveRawMetrics 모두에서
 *    실제 fetch 헤더에 부착된다. (서버 idempotency 의 클라이언트 측 절반)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../api';
import { STORAGE_KEYS } from '../constants';

const okResponse = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, data: { id: 'x' } }),
  } as unknown as Response);

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchSpy = vi.fn(() => okResponse());
  // jsdom + vitest 환경에서 fetch 타입이 좁아 spyOn 시 타입이 충돌하므로 직접 교체.
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function lastHeaders(): Record<string, string> {
  const calls = fetchSpy.mock.calls;
  const init = calls[calls.length - 1]?.[1] as RequestInit | undefined;
  return (init?.headers as Record<string, string>) ?? {};
}

describe('ApiClient: 헤더 합성 회귀', () => {
  it('토큰이 있을 때 Authorization + Content-Type 이 항상 부착된다 (옵션 헤더 없는 호출)', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-1');
    await api.createSession({ foo: 'bar' });
    const h = lastHeaders();
    expect(h['Authorization']).toBe('Bearer tok-1');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('Idempotency-Key 를 넘겨도 Authorization / Content-Type 이 사라지지 않는다 (헤더 합성 회귀)', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-2');
    await api.createSession({ foo: 'bar' }, { idempotencyKey: 'pending-key-1' });
    const h = lastHeaders();
    expect(h['Authorization']).toBe('Bearer tok-2');
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Idempotency-Key']).toBe('pending-key-1');
  });

  it('토큰이 없으면 Authorization 헤더는 부착되지 않는다 (옵션 헤더와 무관)', async () => {
    await api.calculateMetrics({ sessionId: 's', userId: 'u' }, { idempotencyKey: 'k' });
    const h = lastHeaders();
    expect(h['Authorization']).toBeUndefined();
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Idempotency-Key']).toBe('k');
  });

  it('saveRawMetrics 도 동일하게 Idempotency-Key 를 부착한다', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-3');
    await api.saveRawMetrics({ sessionId: 's', userId: 'u' }, { idempotencyKey: 'raw-key' });
    const h = lastHeaders();
    expect(h['Authorization']).toBe('Bearer tok-3');
    expect(h['Idempotency-Key']).toBe('raw-key');
  });

  it('Idempotency-Key 옵션 미지정 시 헤더에 키가 들어가지 않는다', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-4');
    await api.calculateMetrics({ sessionId: 's', userId: 'u' });
    const h = lastHeaders();
    expect(h['Authorization']).toBe('Bearer tok-4');
    expect(h['Idempotency-Key']).toBeUndefined();
  });
});
