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

function getKakaoEnv(): { clientId: string; clientSecret: string; callbackUrl: string } | null {
  const clientId = process.env.KAKAO_CLIENT_ID;
  // 카카오는 Client Secret 사용을 활성화한 경우에만 필수 — 비어 있어도 진행 가능.
  const clientSecret = process.env.KAKAO_CLIENT_SECRET || '';
  const callbackUrl = process.env.KAKAO_CALLBACK_URL;
  if (!clientId || !callbackUrl) return null;
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

// =============================================================================
// 카카오 소셜 로그인 (네이버와 동일한 A안 — WebView 안에서 동일 origin 처리)
//
//   GET  /auth/kakao           : state 발급 + 카카오 인증창으로 302 리다이렉트
//   GET  /auth/kakao/callback  : 카카오 redirect_uri — code 교환 → 사용자 upsert →
//                                JWT 발급 → /login/social/complete 로 hash fragment 전달
//
// 환경변수:
//   - KAKAO_CLIENT_ID       (REST API 키)
//   - KAKAO_CLIENT_SECRET   (선택 — 카카오 개발자센터에서 활성화한 경우만 필수)
//   - KAKAO_CALLBACK_URL    (예: https://noilink.replit.app/auth/kakao/callback)
//
// 네이버와 다른 점:
//   - token 엔드포인트가 POST + x-www-form-urlencoded
//   - 프로필 응답이 { id, kakao_account: { email, profile: { nickname } } } 형태
//   - 이메일/닉네임은 사업자 인증 후 활성화된 동의항목만 내려옴 — 둘 다 없을 수 있어
//     이메일 미수집 사용자는 socialId 단독 키로만 신원 보장한다.
// =============================================================================

interface KakaoTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface KakaoProfileResponse {
  id?: number;
  kakao_account?: {
    email?: string;
    has_email?: boolean;
    is_email_valid?: boolean;
    is_email_verified?: boolean;
    profile?: {
      nickname?: string;
      profile_image_url?: string;
    };
  };
  properties?: {
    nickname?: string;
    profile_image?: string;
  };
}

router.get('/kakao', (req: Request, res: Response) => {
  const env = getKakaoEnv();
  if (!env) {
    return res
      .status(500)
      .send('카카오 로그인 환경변수(KAKAO_CLIENT_ID/CALLBACK_URL) 가 설정되지 않았습니다.');
  }
  const state = issueState();
  const url =
    'https://kauth.kakao.com/oauth/authorize?response_type=code' +
    `&client_id=${encodeURIComponent(env.clientId)}` +
    `&redirect_uri=${encodeURIComponent(env.callbackUrl)}` +
    `&state=${encodeURIComponent(state)}`;
  res.redirect(url);
});

router.get('/kakao/callback', async (req: Request, res: Response) => {
  const env = getKakaoEnv();
  if (!env) {
    return res
      .status(500)
      .send('카카오 로그인 환경변수가 설정되지 않았습니다.');
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
    // 1) code → access_token (POST + form-urlencoded)
    const tokenBody = new URLSearchParams();
    tokenBody.set('grant_type', 'authorization_code');
    tokenBody.set('client_id', env.clientId);
    tokenBody.set('redirect_uri', env.callbackUrl);
    tokenBody.set('code', code);
    if (env.clientSecret) tokenBody.set('client_secret', env.clientSecret);

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: tokenBody.toString(),
    });
    const tokenJson = (await tokenRes.json()) as KakaoTokenResponse;
    if (!tokenJson.access_token) {
      console.error('[kakao] token exchange failed', tokenJson);
      return res.redirect('/login?social_error=token_exchange_failed');
    }

    // 2) access_token → 프로필
    const profileRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
    });
    const profileJson = (await profileRes.json()) as KakaoProfileResponse;
    if (!profileJson.id) {
      console.error('[kakao] profile fetch failed', profileJson);
      return res.redirect('/login?social_error=profile_fetch_failed');
    }

    const kakaoId = String(profileJson.id);
    const kakaoEmail =
      profileJson.kakao_account?.is_email_valid && profileJson.kakao_account?.is_email_verified
        ? profileJson.kakao_account.email
        : profileJson.kakao_account?.email; // 검증 정보 미동의여도 이메일이 오면 그대로 사용
    const kakaoNickname =
      profileJson.kakao_account?.profile?.nickname ||
      profileJson.properties?.nickname ||
      `카카오사용자`;
    const kakaoName = kakaoNickname;

    // 3) users[] upsert (socialProvider+socialId 우선, 없으면 email 매칭)
    let resolvedUser: User | null = null;
    await withKeyLock(KV_LOCK_USERS, async () => {
      const users: any[] = (await db.get('users')) || [];
      let existing = users.find(
        (u) => u.socialProvider === 'kakao' && u.socialId === kakaoId,
      );
      if (!existing && kakaoEmail) {
        existing = users.find((u) => u.email && u.email === kakaoEmail);
        if (existing) {
          existing.socialProvider = 'kakao';
          existing.socialId = kakaoId;
          existing.lastLoginAt = new Date().toISOString();
        }
      }

      if (!existing) {
        const newUser: any = {
          id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          username: kakaoNickname,
          email: kakaoEmail,
          name: kakaoName,
          nickname: kakaoNickname,
          userType: 'PERSONAL',
          socialProvider: 'kakao',
          socialId: kakaoId,
          streak: 0,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };
        let suffix = 0;
        while (users.find((u) => u.username === newUser.username)) {
          suffix += 1;
          newUser.username = `${kakaoNickname}_${suffix}`;
        }
        users.push(newUser);
        existing = newUser;
      } else {
        existing.lastLoginAt = new Date().toISOString();
        // 기존 카카오 사용자 백필:
        // 첫 로그인 당시에는 이메일 동의를 안 했거나, 카카오 비즈앱 검수
        // 이전이라 이메일이 응답에 없을 수 있다. 이 경우 user.email 이
        // 비어 있는 채로 만들어지고, 마이페이지에 "이메일 없음" 으로 노출된다.
        // 이후 동의/검수가 추가돼 이메일이 응답에 포함되면, 비어 있던 값을
        // 자동으로 채워 마이페이지에 정상 표시되도록 한다.
        // 이미 이메일이 있으면(=사용자가 직접 입력했거나 다른 경로로 채워짐)
        // 카카오 값으로 덮어쓰지 않는다.
        if (kakaoEmail && !existing.email) {
          existing.email = kakaoEmail;
        }
      }
      await db.set('users', users);
      resolvedUser = existing as User;
    });

    if (!resolvedUser) {
      return res.redirect('/login?social_error=user_upsert_failed');
    }

    const token = generateToken(resolvedUser);
    const u = resolvedUser as User;
    const params = new URLSearchParams();
    params.set('token', token);
    params.set('userId', u.id);
    params.set('username', u.username);
    return res.redirect(`/login/social/complete#${params.toString()}`);
  } catch (e) {
    console.error('[kakao] callback error', e);
    return res.redirect('/login?social_error=server_error');
  }
});

export default router;
