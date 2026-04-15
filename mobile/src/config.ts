const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process
  ?.env;

/**
 * API 베이스 URL — app.json / eas.json 의 extra 또는 EXPO_PUBLIC_API_URL
 * 예: http://10.0.2.2:5000/api (Android 에뮬 → 호스트 PC)
 */
export const API_BASE_URL = env?.EXPO_PUBLIC_API_URL ?? '';
