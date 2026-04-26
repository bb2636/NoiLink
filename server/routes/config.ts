/**
 * 원격 설정 (Remote Config) 라우트 — Task #48
 *
 * BLE 단절 안내 임계값(Task #38, #44)을 앱 재배포 없이 튜닝/AB 테스트할 수 있도록
 * 서버에서 단일 진실 소스를 노출한다. 클라이언트는 부트스트랩 시점에
 * `GET /api/config/ble-stability` 를 호출해 받은 응답을
 * `makeBleStabilityResolverFromRemoteConfig()` → `setBleStabilityOverrideResolver()` 로
 * 등록한다.
 *
 * 설정 소스:
 *  - `BLE_STABILITY_REMOTE_CONFIG` 환경 변수에 JSON 문자열을 넣으면 그 값이 그대로
 *    내려간다. Replit Secrets / 운영 환경 변수로 즉시 변경 가능 (재배포 불필요).
 *  - 환경 변수가 없거나 JSON 파싱이 실패하면 빈 설정(`{ rules: [] }`)을 반환한다.
 *    클라이언트는 이 경우 오버라이드를 등록하지 않아 기본 임계값이 그대로 쓰인다.
 *
 * 응답 모양은 `shared/ble-stability-config.ts` 의 `BleStabilityRemoteConfig` 와 동일.
 * 잘못된 임계값(NaN/음수/0)/모양은 클라이언트(어댑터) 단에서 다시 한 번 거른다.
 */
import { Router, Request, Response } from 'express';
import type { BleStabilityRemoteConfig } from '@noilink/shared';

const router = Router();

const EMPTY_CONFIG: BleStabilityRemoteConfig = { rules: [] };

function loadFromEnv(): BleStabilityRemoteConfig {
  const raw = process.env.BLE_STABILITY_REMOTE_CONFIG;
  if (!raw || raw.trim().length === 0) return EMPTY_CONFIG;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as BleStabilityRemoteConfig;
    }
    console.warn('[config] BLE_STABILITY_REMOTE_CONFIG is not an object, ignoring');
    return EMPTY_CONFIG;
  } catch (err) {
    console.warn(
      '[config] BLE_STABILITY_REMOTE_CONFIG JSON parse failed:',
      err instanceof Error ? err.message : err,
    );
    return EMPTY_CONFIG;
  }
}

/**
 * GET /api/config/ble-stability
 * 인증 불필요 — 임계값은 비밀이 아니며, 부트스트랩(로그인 전)에서도 호출된다.
 */
router.get('/ble-stability', (_req: Request, res: Response) => {
  const config = loadFromEnv();
  res.json({ success: true, data: config });
});

export default router;
