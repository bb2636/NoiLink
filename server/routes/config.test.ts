/**
 * `GET /api/config/ble-stability` 진단 메타 회귀 테스트 — Task #71.
 *
 * 잘못된 `BLE_STABILITY_REMOTE_CONFIG` 가 푸시되면 서버는 빈 설정으로 폴백하면서도
 * 응답의 `meta` 와 `getBleStabilityRemoteConfigStatus()` 양쪽에 사실을 기록해
 * 운영자가 즉시 알아챌 수 있어야 한다.
 *
 * 이 테스트가 보호하는 정책:
 *  1. 환경 변수가 비어 있을 때는 `source: 'empty'` / `parseError` 없음.
 *  2. 정상 JSON 객체일 때는 `source: 'env'` / 적용 규칙 수가 `ruleCount` 에 노출.
 *  3. JSON 파싱 실패는 `parseError` 가 채워지고 빈 설정이 내려간다.
 *  4. 객체가 아닌 JSON (배열·원시값) 도 잘못된 입력으로 간주되어 `parseError` 가 남는다.
 *  5. `getBleStabilityRemoteConfigStatus()` 는 환경 변수 변경을 즉시 반영한다
 *     (관리자 대시보드가 stale 한 값을 보여 주지 않는다는 회귀 보장).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import configRouter, { getBleStabilityRemoteConfigStatus } from './config.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/config', configRouter);
  return app;
}

const ENV_KEY = 'BLE_STABILITY_REMOTE_CONFIG';
const ORIGINAL_VALUE = process.env[ENV_KEY];

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete process.env[ENV_KEY];
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  if (ORIGINAL_VALUE === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = ORIGINAL_VALUE;
  }
  warnSpy.mockRestore();
});

describe('GET /api/config/ble-stability — 진단 메타', () => {
  it('환경 변수가 비어 있으면 빈 설정과 source=empty 메타를 내려 준다', async () => {
    const res = await request(buildApp()).get('/api/config/ble-stability');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({ rules: [] });
    expect(res.body.meta).toMatchObject({
      source: 'empty',
      ruleCount: 0,
      hasDefault: false,
    });
    expect(res.body.meta.parseError).toBeUndefined();
    expect(typeof res.body.meta.lastLoadedAt).toBe('string');
    expect(Number.isFinite(Date.parse(res.body.meta.lastLoadedAt))).toBe(true);
    // 정상 경로에서는 경고가 남지 않아야 한다.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('정상 JSON 이 들어오면 그대로 내려 주고 ruleCount/hasDefault 가 채워진다', async () => {
    process.env[ENV_KEY] = JSON.stringify({
      rules: [
        {
          match: { deviceModel: 'NoiPod-A1' },
          thresholds: { windowThreshold: 5, msThreshold: 20_000 },
        },
        {
          thresholds: { windowThreshold: 4 },
        },
      ],
      default: { msThreshold: 18_000 },
    });

    const res = await request(buildApp()).get('/api/config/ble-stability');

    expect(res.status).toBe(200);
    expect(res.body.data.rules).toHaveLength(2);
    expect(res.body.meta).toMatchObject({
      source: 'env',
      ruleCount: 2,
      rawRuleCount: 2,
      hasDefault: true,
    });
    expect(res.body.meta.parseError).toBeUndefined();
    expect(res.body.meta.validationError).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('JSON 파싱 실패는 빈 설정 + parseError 메타로 명시되며 console.warn 한 줄을 남긴다', async () => {
    process.env[ENV_KEY] = '{not json';

    const res = await request(buildApp()).get('/api/config/ble-stability');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ rules: [] });
    expect(res.body.meta).toMatchObject({
      source: 'env',
      ruleCount: 0,
      hasDefault: false,
    });
    expect(typeof res.body.meta.parseError).toBe('string');
    expect(res.body.meta.parseError.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('객체가 아닌 JSON (배열) 도 잘못된 입력으로 간주되어 parseError 가 남는다', async () => {
    process.env[ENV_KEY] = JSON.stringify([{ thresholds: { msThreshold: 10_000 } }]);

    const res = await request(buildApp()).get('/api/config/ble-stability');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ rules: [] });
    expect(res.body.meta.source).toBe('env');
    expect(res.body.meta.ruleCount).toBe(0);
    expect(typeof res.body.meta.parseError).toBe('string');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('객체가 아닌 JSON (숫자) 도 parseError 로 분류된다', async () => {
    process.env[ENV_KEY] = '42';

    const res = await request(buildApp()).get('/api/config/ble-stability');

    expect(res.status).toBe(200);
    expect(res.body.meta.source).toBe('env');
    expect(typeof res.body.meta.parseError).toBe('string');
  });

  it('JSON 은 유효하지만 모든 임계값이 음수/0/문자열이면 validationError 가 채워진다', async () => {
    // Task #71 의 핵심 폴백 케이스: JSON 자체는 깨지지 않지만 임계값이 모두 무효라
    // 클라이언트 sanitize 단계에서 규칙이 0 개로 줄어드는 상황. 이 회귀 테스트는
    // "JSON 만 검증하고 끝내는" 안일한 진단으로 회귀하지 않도록 잠근다.
    process.env[ENV_KEY] = JSON.stringify({
      rules: [
        { thresholds: { windowThreshold: -1, msThreshold: 0 } },
        { thresholds: { windowThreshold: 'oops', msThreshold: null } },
      ],
      default: { windowThreshold: -10 },
    });

    const res = await request(buildApp()).get('/api/config/ble-stability');

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({
      source: 'env',
      ruleCount: 0,
      rawRuleCount: 2,
      hasDefault: false,
    });
    expect(res.body.meta.parseError).toBeUndefined();
    expect(typeof res.body.meta.validationError).toBe('string');
    expect(res.body.meta.validationError.length).toBeGreaterThan(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('일부 규칙만 무효이면 실효 규칙 수만 ruleCount 에 반영하고 validationError 는 없다', async () => {
    process.env[ENV_KEY] = JSON.stringify({
      rules: [
        { thresholds: { windowThreshold: 5 } }, // 유효
        { thresholds: { windowThreshold: -3, msThreshold: 'no' } }, // 무효
        { thresholds: { msThreshold: 12_000 } }, // 유효
      ],
    });

    const res = await request(buildApp()).get('/api/config/ble-stability');

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({
      source: 'env',
      ruleCount: 2,
      rawRuleCount: 3,
      hasDefault: false,
    });
    expect(res.body.meta.validationError).toBeUndefined();
  });

  it('규칙이 모두 무효지만 default 가 유효하면 폴백이 살아있어 validationError 가 없다', async () => {
    process.env[ENV_KEY] = JSON.stringify({
      rules: [{ thresholds: { windowThreshold: -1 } }],
      default: { msThreshold: 9_000 },
    });

    const res = await request(buildApp()).get('/api/config/ble-stability');

    expect(res.body.meta).toMatchObject({
      source: 'env',
      ruleCount: 0,
      rawRuleCount: 1,
      hasDefault: true,
    });
    expect(res.body.meta.validationError).toBeUndefined();
  });

  it('의도된 빈 객체(`{}`/`{ rules: [] }`)는 validationError 없이 ruleCount=0 만 보고한다', async () => {
    // 빈 설정은 운영자가 일부러 오버라이드를 비운 합법적 상태이므로 경고하지 않는다.
    process.env[ENV_KEY] = JSON.stringify({});

    const res = await request(buildApp()).get('/api/config/ble-stability');

    expect(res.body.meta).toMatchObject({
      source: 'env',
      ruleCount: 0,
      rawRuleCount: 0,
      hasDefault: false,
    });
    expect(res.body.meta.parseError).toBeUndefined();
    expect(res.body.meta.validationError).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('공백만 있는 환경 변수는 의도된 빈 상태로 간주되어 parseError 없이 source=empty', async () => {
    process.env[ENV_KEY] = '   \n  ';

    const res = await request(buildApp()).get('/api/config/ble-stability');

    expect(res.status).toBe(200);
    expect(res.body.meta.source).toBe('empty');
    expect(res.body.meta.parseError).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('getBleStabilityRemoteConfigStatus()', () => {
  it('환경 변수 변경을 즉시 반영한다 (대시보드가 stale 한 값을 보지 않는다)', () => {
    delete process.env[ENV_KEY];
    expect(getBleStabilityRemoteConfigStatus()).toMatchObject({
      source: 'empty',
      ruleCount: 0,
      rawRuleCount: 0,
      hasDefault: false,
    });

    process.env[ENV_KEY] = JSON.stringify({
      rules: [{ thresholds: { msThreshold: 12_000 } }],
    });
    const ok = getBleStabilityRemoteConfigStatus();
    expect(ok.source).toBe('env');
    expect(ok.ruleCount).toBe(1);
    expect(ok.rawRuleCount).toBe(1);
    expect(ok.parseError).toBeUndefined();
    expect(ok.validationError).toBeUndefined();

    process.env[ENV_KEY] = 'oops';
    const bad = getBleStabilityRemoteConfigStatus();
    expect(bad.source).toBe('env');
    expect(bad.ruleCount).toBe(0);
    expect(typeof bad.parseError).toBe('string');

    process.env[ENV_KEY] = JSON.stringify({
      rules: [{ thresholds: { windowThreshold: -1 } }],
    });
    const invalid = getBleStabilityRemoteConfigStatus();
    expect(invalid.source).toBe('env');
    expect(invalid.ruleCount).toBe(0);
    expect(invalid.rawRuleCount).toBe(1);
    expect(typeof invalid.validationError).toBe('string');
  });

  it('lastLoadedAt 은 호출 시점에 갱신된다', async () => {
    delete process.env[ENV_KEY];
    const first = getBleStabilityRemoteConfigStatus().lastLoadedAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = getBleStabilityRemoteConfigStatus().lastLoadedAt;
    expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first));
  });
});
