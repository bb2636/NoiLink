import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_TOKEN = 'noilink_mobile_auth_token';
const KEY_USER_ID = 'noilink_mobile_user_id';
const KEY_USER_NAME = 'noilink_mobile_user_name';

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await AsyncStorage.getItem(KEY_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function getStoredToken(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_TOKEN);
}

export async function clearStoredAuth(): Promise<void> {
  await AsyncStorage.removeItem(KEY_TOKEN);
  await AsyncStorage.removeItem(KEY_USER_ID);
  await AsyncStorage.removeItem(KEY_USER_NAME);
}

export async function setStoredAuth(token: string, userId: string, displayName?: string): Promise<void> {
  await AsyncStorage.setItem(KEY_TOKEN, token);
  await AsyncStorage.setItem(KEY_USER_ID, userId);
  if (displayName) await AsyncStorage.setItem(KEY_USER_NAME, displayName);
  else await AsyncStorage.removeItem(KEY_USER_NAME);
}

/** 서버 제출용: 로그인 시 저장된 사용자 ID */
export async function resolveTrainingUserId(): Promise<string | null> {
  const uid = await AsyncStorage.getItem(KEY_USER_ID);
  if (uid?.trim()) return uid.trim();
  return null;
}

export async function getStoredUserDisplay(): Promise<{ userId: string | null; name: string | null }> {
  const userId = await AsyncStorage.getItem(KEY_USER_ID);
  const name = await AsyncStorage.getItem(KEY_USER_NAME);
  return { userId: userId?.trim() || null, name: name?.trim() || null };
}
