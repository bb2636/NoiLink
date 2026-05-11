import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import type { User } from '@noilink/shared';
import { generateToken } from '../utils/jwt.js';
import { withKeyLock } from '../utils/key-mutex.js';

/**
 * 네이버 소셜 로그인 (A안 — WebView 안에서 동일 origin 으로 처리).
 *
 *  GET  /auth/naver           : state 발급 + 네이버 인증창으로 302 리다이렉트
 *  GET  /auth/naver/callback  : 네이버 redirect_uri — code 교환 → 사용자 upsert →
 *                               JWT 발급 → SPA `/login/social/complete#token=...`
 *                               로 다시 302 (해시 fragment 라 토큰이 서버 액세스로그
 *                               에 남지 않음).
 *
 * 환경변수:
 *  - NAVER_CLIENT_ID
 *  - NAVER_CLIENT_SECRET
 *  - NAVER_CALLBACK_URL (예: https://noilink.replit.app/auth/naver/callback)
 *
 * State 보호:
 *  - HMAC 없이 32B random hex → 메모리 Set 에 5분 TTL 로 보관 → callback 단계에서 1회 소비.
 *  - 단일 인스턴스 가정. 멀티 인스턴스 배포 시 cookie/jwt-state 로 교체.
 */
const router = Router();

const KV_LOCK_USERS = 'lock:db:users';

const STATE_TTL_MS = 5 * 60 * 1000;
const stateStore = new Map<string, number>();

function issueState(): string {
  // 만료된 항목 정리 (best-effort)
  const now = Date.now();
  for (const [k, exp] of stateStore) {
    if (exp < now) stateStore.delete(k);
  }
  const state = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  stateStore.set(state, now + STATE_TTL_MS);
  return state;
}

function consumeState(state: string): boolean {
  const exp = stateStore.get(state);
  if (!exp) return false;
  stateStore.delete(state);
  return exp >= Date.now();
}

function getEnv(): { clientId: string; clientSecret: string; callbackUrl: string } | null {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  const callbackUrl = process.env.NAVER_CALLBACK_URL;
  if (!clientId || !clientSecret || !callbackUrl) return null;
  return { clientId, clientSecret, callbackUrl };
}

/**
 * GET /auth/naver
 * 네이버 인증창으로 리다이렉트.
 */
router.get('/naver', (req: Request, res: Response) => {
  const env = getEnv();
  if (!env) {
    return res
      .status(500)
      .send('네이버 로그인 환경변수(NAVER_CLIENT_ID/SECRET/CALLBACK_URL) 가 설정되지 않았습니다.');
  }
  const state = issueState();
  const url =
    'https://nid.naver.com/oauth2.0/authorize?' +
    `response_type=code&client_id=${encodeURIComponent(env.clientId)}` +
    `&redirect_uri=${encodeURIComponent(env.callbackUrl)}` +
    `&state=${encodeURIComponent(state)}`;
  res.redirect(url);
});

interface NaverTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: string;
  error?: string;
  error_description?: string;
}

interface NaverProfileResponse {
  resultcode?: string;
  message?: string;
  response?: {
    id?: string;
    email?: string;
    name?: string;
    nickname?: string;
    mobile?: string;
    profile_image?: string;
  };
}

/**
 * GET /auth/naver/callback
 * 네이버에서 돌아오는 콜백. code+state 를 받아 access_token → 프로필 → 사용자
 * upsert → JWT 발급 → SPA 의 `/login/social/complete` 로 토큰을 hash fragment 로 전달.
 */
router.get('/naver/callback', async (req: Request, res: Response) => {
  const env = getEnv();
  if (!env) {
    return res
      .status(500)
      .send('네이버 로그인 환경변수가 설정되지 않았습니다.');
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const errorParam = typeof req.query.error === 'string' ? req.query.error : '';

  if (errorParam) {
    return res.redirect(`/login?social_error=${encodeURIComponent(errorParam)}`);
  }
  if (!code || !state) {
    return res.redirect('/login?social_error=missing_code');
  }
  if (!consumeState(state)) {
    return res.redirect('/login?social_error=invalid_state');
  }

  try {
    // 1) code → access_token
    const tokenUrl =
      'https://nid.naver.com/oauth2.0/token?grant_type=authorization_code' +
      `&client_id=${encodeURIComponent(env.clientId)}` +
      `&client_secret=${encodeURIComponent(env.clientSecret)}` +
      `&code=${encodeURIComponent(code)}` +
      `&state=${encodeURIComponent(state)}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenJson = (await tokenRes.json()) as NaverTokenResponse;
    if (!tokenJson.access_token) {
      console.error('[naver] token exchange failed', tokenJson);
      return res.redirect('/login?social_error=token_exchange_failed');
    }

    // 2) access_token → 프로필
    const profileRes = await fetch('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const profileJson = (await profileRes.json()) as NaverProfileResponse;
    if (profileJson.resultcode !== '00' || !profileJson.response?.id) {
      console.error('[naver] profile fetch failed', profileJson);
      return res.redirect('/login?social_error=profile_fetch_failed');
    }

    const naverId = profileJson.response.id;
    const naverEmail = profileJson.response.email;
    const naverName = profileJson.response.name || profileJson.response.nickname || `네이버사용자`;
    const naverNickname = profileJson.response.nickname || naverName;
    const naverPhone = profileJson.response.mobile?.replace(/[^0-9]/g, '') || undefined;

    // 3) users[] upsert (socialProvider+socialId 우선, 없으면 email 매칭으로 통합)
    let resolvedUser: User | null = null;
    await withKeyLock(KV_LOCK_USERS, async () => {
      const users: any[] = (await db.get('users')) || [];
      let existing = users.find(
        (u) => u.socialProvider === 'naver' && u.socialId === naverId,
      );
      if (!existing && naverEmail) {
        // 같은 이메일로 이미 가입된 사용자가 있으면 소셜 식별자만 연결한다.
        existing = users.find((u) => u.email && u.email === naverEmail);
        if (existing) {
          existing.socialProvider = 'naver';
          existing.socialId = naverId;
          existing.lastLoginAt = new Date().toISOString();
        }
      }

      if (!existing) {
        const newUser: any = {
          id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          username: naverNickname,
          email: naverEmail,
          name: naverName,
          nickname: naverNickname,
          phone: naverPhone,
          userType: 'PERSONAL',
          socialProvider: 'naver',
          socialId: naverId,
          streak: 0,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };
        // username 충돌 회피 (네이버 닉네임이 이미 다른 계정과 겹치는 경우 suffix 추가)
        let suffix = 0;
        while (users.find((u) => u.username === newUser.username)) {
          suffix += 1;
          newUser.username = `${naverNickname}_${suffix}`;
        }
        users.push(newUser);
        existing = newUser;
      } else {
        existing.lastLoginAt = new Date().toISOString();
      }
      await db.set('users', users);
      resolvedUser = existing as User;
    });

    if (!resolvedUser) {
      return res.redirect('/login?social_error=user_upsert_failed');
    }

    // 4) JWT 발급 후 SPA 의 완료 라우트로 hash fragment 전달
    const token = generateToken(resolvedUser);
    const u = resolvedUser as User;
    const params = new URLSearchParams();
    params.set('token', token);
    params.set('userId', u.id);
    params.set('username', u.username);
    return res.redirect(`/login/social/complete#${params.toString()}`);
  } catch (e) {
    console.error('[naver] callback error', e);
    return res.redirect('/login?social_error=server_error');
  }
});

export default router;
