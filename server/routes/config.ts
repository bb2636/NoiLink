/**
 * 원격 설정 (Remote Config) 라우트 — Task #48, Task #71
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
 * 진단 메타 (Task #71):
 *  - 응답 envelope 의 `meta` 와, 별도 export `getBleStabilityRemoteConfigStatus()` 로
 *    노출된다. 잘못된 입력이 푸시되어 빈 설정으로 폴백된 경우:
 *    - JSON 자체가 깨졌으면 `parseError` 가 채워지고
 *    - JSON 은 멀쩡하지만 임계값이 전부 무효(음수/0/문자열)라 실효 규칙이 0 개로
 *      줄었으면 `validationError` 가 채워진다.
 *    덕분에 운영자는 `console.warn` 한 줄을 놓쳐도 응답·헬스체크·관리자
 *    대시보드(`/api/admin/dashboard`) 어디에서나 사실을 확인할 수 있다.
 *
 * 응답 모양은 `shared/ble-stability-config.ts` 의 `BleStabilityRemoteConfig` 와 동일.
 */
import { Router, Request, Response } from 'express';
import {
  summarizeBleStabilityRemoteConfig,
  type BleStabilityRemoteConfig,
  type BleStabilityRemoteConfigDiagnostics,
} from '@noilink/shared';

const router = Router();

const EMPTY_CONFIG: BleStabilityRemoteConfig = { rules: [] };

interface LoadResult {
  config: BleStabilityRemoteConfig;
  diagnostics: BleStabilityRemoteConfigDiagnostics;
}

/**
 * 환경 변수에서 한 번 읽어 설정과 진단 메타를 함께 반환한다.
 * 부작용 없는 순수 함수에 가깝지만, `lastLoadedAt` 만은 호출 시각을 기준으로 한다.
 */
function loadFromEnv(): LoadResult {
  const raw = process.env.BLE_STABILITY_REMOTE_CONFIG;
  const lastLoadedAt = new Date().toISOString();

  if (!raw || raw.trim().length === 0) {
    return {
      config: EMPTY_CONFIG,
      diagnostics: {
        source: 'empty',
        ruleCount: 0,
        rawRuleCount: 0,
        hasDefault: false,
        lastLoadedAt,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      '[config] BLE_STABILITY_REMOTE_CONFIG JSON parse failed:',
      message,
    );
    return {
      config: EMPTY_CONFIG,
      diagnostics: {
        source: 'env',
        ruleCount: 0,
        rawRuleCount: 0,
        hasDefault: false,
        parseError: message,
        lastLoadedAt,
      },
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const message = 'BLE_STABILITY_REMOTE_CONFIG must be a JSON object';
    console.warn(`[config] ${message}, ignoring`);
    return {
      config: EMPTY_CONFIG,
      diagnostics: {
        source: 'env',
        ruleCount: 0,
        rawRuleCount: 0,
        hasDefault: false,
        parseError: message,
        lastLoadedAt,
      },
    };
  }

  const config = parsed as BleStabilityRemoteConfig;
  const summary = summarizeBleStabilityRemoteConfig(config);

  // JSON 은 멀쩡하지만 sanitize 후 적용 가능한 규칙이 하나도 안 남으면 — 운영자가
  // "튜닝이 적용되지 않는다"고 의심할 가장 흔한 원인이다.
  // 빈 설정(`{ rules: [] }` 또는 `{}`)은 의도된 비움이므로 경고하지 않는다.
  let validationError: string | undefined;
  const rawDeclaredAnything = summary.rawRuleCount > 0 || summary.rawHasDefault;
  const effectiveAnything =
    summary.effectiveRuleCount > 0 || summary.effectiveHasDefault;
  if (rawDeclaredAnything && !effectiveAnything) {
    validationError =
      'BLE_STABILITY_REMOTE_CONFIG declared rules/default but all thresholds were invalid (non-positive number, NaN, or non-numeric); applying empty config';
    console.warn(`[config] ${validationError}`);
  }

  return {
    config,
    diagnostics: {
      source: 'env',
      ruleCount: summary.effectiveRuleCount,
      rawRuleCount: summary.rawRuleCount,
      hasDefault: summary.effectiveHasDefault,
      validationError,
      lastLoadedAt,
    },
  };
}

/**
 * 현재 적용 중인 원격 설정의 진단 메타를 반환한다 (Task #71).
 *
 * 관리자 대시보드(`/api/admin/dashboard`) 등에서 호출해 운영자가
 * "현재 규칙이 몇 개 적용 중이며, 마지막 파싱이 성공했는지" 를 즉시 확인할 수
 * 있도록 한다. 환경 변수는 호출 시마다 즉시 다시 읽으므로, 운영자가 Secrets 값을
 * 바꾸자마자 다음 요청에 반영된다.
 */
export function getBleStabilityRemoteConfigStatus(): BleStabilityRemoteConfigDiagnostics {
  return loadFromEnv().diagnostics;
}

/**
 * GET /api/config/ble-stability
 * 인증 불필요 — 임계값은 비밀이 아니며, 부트스트랩(로그인 전)에서도 호출된다.
 *
 * 응답에 `meta` 진단을 포함해, 잘못된 환경 변수로 빈 설정이 내려간 사실을
 * 공개 응답에서도 확인할 수 있다 (Task #71). 메시지에는 비밀이 포함되지 않는다.
 */
router.get('/ble-stability', (_req: Request, res: Response) => {
  const { config, diagnostics } = loadFromEnv();
  res.json({ success: true, data: config, meta: diagnostics });
});

export default router;
