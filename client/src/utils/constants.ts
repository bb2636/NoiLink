/**
 * 애플리케이션 상수 정의
 */

// 게임 카테고리
export const GAME_CATEGORIES = {
  MEMORY: 'memory',
  REACTION: 'reaction',
  LOGIC: 'logic',
  ATTENTION: 'attention',
  AGILITY: 'agility',  // 순발력
} as const;

// 게임 난이도
export const GAME_DIFFICULTY = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
} as const;

// 로컬 스토리지 키
export const STORAGE_KEYS = {
  USER_ID: 'noilink_user_id',
  USERNAME: 'noilink_username',
  DEVICE_ID: 'noilink_device_id',
  TOKEN: 'noilink_token',
  CONNECTED_DEVICE: 'noilink_connected_device',
  REGISTERED_DEVICES: 'noilink_registered_devices',
} as const;

// API 엔드포인트
export const API_ENDPOINTS = {
  USERS: '/api/users',
  SCORES: '/api/scores',
  TRAINING: '/api/training',
} as const;
