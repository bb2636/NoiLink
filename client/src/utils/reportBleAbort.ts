/**
 * BLE 단절로 자동 종료된 세션의 운영 텔레메트리를 fire-and-forget 으로 보고한다 (Task #57).
 *
 * 정책:
 *  - 세션 종료 후 곧장 navigate 가 호출되므로 페이지가 사라져도 요청이 살아남도록
 *    `navigator.sendBeacon` 을 1순위, `fetch({ keepalive: true })` 를 폴백으로 쓴다.
 *  - 페이로드는 익명 — userId/디바이스/토큰 같은 PII 는 절대 포함하지 않는다.
 *    서버는 `BleAbortEventInput` 모양만 받는다 (`shared/ble-abort-event.ts`).
 *  - 어떤 예외도 호출자에게 전파되지 않아야 한다 — 보고 실패가 사용자 종료 흐름을 방해해선 안 된다.
 */

import type { BleAbortEventInput } from '@noilink/shared';

const BLE_ABORT_ENDPOINT = `${import.meta.env.VITE_API_URL || '/api'}/metrics/ble-abort`;

/**
 * 보고를 한 번만 시도한다 (fire-and-forget). 반환값 없음 — 결과를 기다리지 않는다.
 */
export function reportBleAbortFireAndForget(input: BleAbortEventInput): void {
  try {
    const body = JSON.stringify({
      windows: Math.max(0, Math.floor(input.windows)),
      totalMs: Math.max(0, Math.floor(input.totalMs)),
      bleUnstable: !!input.bleUnstable,
      ...(input.apiMode ? { apiMode: input.apiMode } : {}),
    });

    // 1순위: sendBeacon — 페이지 unload/navigate 후에도 브라우저가 전송을 보장한다.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(BLE_ABORT_ENDPOINT, blob)) return;
      } catch {
        // sendBeacon 이 동기 throw 하는 환경(SecurityError 등) 은 fetch 폴백으로 떨어진다.
      }
    }

    // 폴백: fetch + keepalive — 일부 WebView 에서 sendBeacon 이 막혔을 때.
    if (typeof fetch === 'function') {
      void fetch(BLE_ABORT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // 어떤 경우에도 사용자 흐름에 영향 주지 않는다.
  }
}
