/**
 * legacyBleMode getter/setter + 1회성 마이그레이션 회귀 테스트.
 *
 * 마이그레이션 키가 없는 상태에서:
 *  - storage 가 비어있으면 → ON 기본값 + 마이그레이션 키 박힘
 *  - storage 에 '0' 이 있으면 (어제 빌드의 강제-OFF 잔여) → 제거되고 ON 으로 복귀
 *  - storage 에 '1' 이 있으면 → 그대로 유지
 *
 * 마이그레이션 키가 이미 박혀있으면:
 *  - storage 의 '0' 은 그대로 유지 (사용자가 명시적으로 OFF 한 결과)
 *  - storage 의 '1' 은 그대로 유지
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getLegacyBleMode, setLegacyBleMode } from '../legacyBleMode';

const STORAGE_KEY = 'noilink:ble:legacyMode';
const MIGRATION_KEY = 'noilink:ble:legacyMode:m1.cleanForcedOff';

describe('legacyBleMode 마이그레이션 (m1.cleanForcedOff)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('마이그레이션 키 없음 + storage 비어있음 → ON, 마이그레이션 키 박힘', () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_KEY)).toBeNull();
    expect(getLegacyBleMode()).toBe(true);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe('1');
    // 사용자가 토글 안 했으므로 STORAGE_KEY 는 미설정 그대로
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("마이그레이션 키 없음 + storage='0' (어제 빌드 잔여) → 제거되고 ON", () => {
    localStorage.setItem(STORAGE_KEY, '0');
    expect(getLegacyBleMode()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MIGRATION_KEY)).toBe('1');
  });

  it("마이그레이션 키 없음 + storage='1' → ON 유지", () => {
    localStorage.setItem(STORAGE_KEY, '1');
    expect(getLegacyBleMode()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
    expect(localStorage.getItem(MIGRATION_KEY)).toBe('1');
  });

  it("마이그레이션 키 이미 있음 + storage='0' → OFF 유지 (명시적 OFF 보존)", () => {
    localStorage.setItem(MIGRATION_KEY, '1');
    localStorage.setItem(STORAGE_KEY, '0');
    expect(getLegacyBleMode()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
  });

  it('마이그레이션은 1회만 실행 (재호출해도 사용자가 OFF 한 값을 청소 안 함)', () => {
    // 1회차: 비어있는 상태 → ON, MIGRATION 키 박힘
    expect(getLegacyBleMode()).toBe(true);
    expect(localStorage.getItem(MIGRATION_KEY)).toBe('1');
    // 사용자가 명시적으로 OFF 누름
    setLegacyBleMode(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
    // 2회차: 마이그레이션이 다시 동작해서 '0' 을 청소하면 안 된다
    expect(getLegacyBleMode()).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
  });

  it('setLegacyBleMode(true) 후 OFF 로 토글하면 다음 getter 도 OFF', () => {
    setLegacyBleMode(true);
    expect(getLegacyBleMode()).toBe(true);
    setLegacyBleMode(false);
    expect(getLegacyBleMode()).toBe(false);
  });
});
