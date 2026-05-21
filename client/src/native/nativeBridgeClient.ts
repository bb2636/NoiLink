import { NATIVE_BRIDGE_VERSION, type WebToNativeMessage } from '@noilink/shared';
import { isNoiLinkNativeShell } from './initNativeBridge';

function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function postToNative(message: WebToNativeMessage): void {
  if (!isNoiLinkNativeShell()) return;
  window.ReactNativeWebView!.postMessage(JSON.stringify(message));
}

/** 로그인/가입 직후 — 토큰은 AsyncStorage(네이티브)에만 신뢰 저장소로 복제됩니다. */
export function notifyNativePersistSession(token: string, userId: string, displayName?: string): void {
  postToNative({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'auth.persistSession',
    payload: { token, userId, displayName },
  });
}

export function notifyNativeClearSession(): void {
  postToNative({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'auth.clearSession',
  });
}

/** 홈에서 시스템 뒤로가기 두 번 → 네이티브 측 앱 종료 요청 (Android 만 의미 있음). */
export function notifyNativeExitApp(): void {
  postToNative({
    v: NATIVE_BRIDGE_VERSION,
    id: newRequestId(),
    type: 'app.exit',
  });
}

/** 네이티브 쉘 안에서 실행 중인지 — 홈 가드가 BackHandler 인터셉트 조건 판정에 사용. */
export { isNoiLinkNativeShell } from './initNativeBridge';
