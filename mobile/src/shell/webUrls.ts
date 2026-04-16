const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env;

/**
 * Vite 클라이언트 로드 URL.
 * 개발: LAN IP + 포트 (예: http://192.168.0.10:5173). 에뮬레이터는 http://10.0.2.2:5173.
 */
export function getWebClientOrigin(): string {
  const url = env?.EXPO_PUBLIC_WEB_CLIENT_URL?.trim();
  if (url) return url.replace(/\/$/, '');
  return 'http://localhost:5173';
}
