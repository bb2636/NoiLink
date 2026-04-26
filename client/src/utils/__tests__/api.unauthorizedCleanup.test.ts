/**
 * 401 응답 시 ApiClient 가 세션 정보(토큰/유저)뿐 아니라 회복 코칭 닫힘 기억도
 * 함께 비우는지 확인 (Task #98).
 *
 * 명시적 logout() 외에 토큰 만료/세션 무효 같은 묵시적 로그아웃 경로가 누락되면
 * 같은 기기에서 다른 계정으로 다시 로그인했을 때 이전 사용자의 닫힘 기억이
 * 남아 회복 코칭 카드가 가려질 수 있다 — 이 테스트가 그 회귀를 잠근다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../api';
import { STORAGE_KEYS } from '../constants';
import {
  recoveryCoachingDismissalKey,
  writeDismissed,
} from '../recoveryCoachingDismissal';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  fetchSpy = vi.fn(() =>
    Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'unauthorized' }),
    } as unknown as Response),
  );
  (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  // 이미 /login 에 있는 것으로 간주 — 401 분기 안의 `window.location.href = '/login'`
  // (jsdom 미지원: "Not implemented: navigation") 호출을 피해 테스트 노이즈 제거.
  // ApiClient 는 pathname 이 이미 '/login' 이면 리다이렉트를 건너뛴다.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname: '/login', href: '/login' },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('ApiClient 401 → 세션 + 회복 코칭 닫힘 기억 동시 정리 (Task #98)', () => {
  it('401 응답이 오면 prefix 의 모든 회복 코칭 닫힘 기억 키가 삭제된다', async () => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, 'tok-expired');
    localStorage.setItem(STORAGE_KEYS.USER_ID, 'user-a');
    writeDismissed('user-a');
    writeDismissed('user-b');
    // 무관한 키는 건드리지 않아야 한다.
    localStorage.setItem('noilink:unrelated', 'keep-me');

    const keyA = recoveryCoachingDismissalKey('user-a')!;
    const keyB = recoveryCoachingDismissalKey('user-b')!;
    expect(localStorage.getItem(keyA)).not.toBeNull();
    expect(localStorage.getItem(keyB)).not.toBeNull();

    const res = await api.getMe();

    expect(res.success).toBe(false);
    // 세션 정보가 비워졌는지(기존 동작 회귀)
    expect(localStorage.getItem(STORAGE_KEYS.TOKEN)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.USER_ID)).toBeNull();
    // Task #98 의 본 요구: 회복 코칭 닫힘 기억도 prefix 전체가 정리됨
    expect(localStorage.getItem(keyA)).toBeNull();
    expect(localStorage.getItem(keyB)).toBeNull();
    // 무관한 키는 그대로 유지
    expect(localStorage.getItem('noilink:unrelated')).toBe('keep-me');
  });
});
