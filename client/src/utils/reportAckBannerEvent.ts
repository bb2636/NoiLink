/**
 * `subscribeAckErrorBanner` 의 burst 통계(자동 닫힘 / 사용자 닫힘 / 화면 이탈)를
 * fire-and-forget 으로 운영 텔레메트리 서버에 보고한다 (Task #116).
 *
 * 정책:
 *  - burst 가 끝나는 시점이 종종 화면 전환과 겹치므로(예: 트레이닝 화면 unmount),
 *    `navigator.sendBeacon` 1순위, `fetch({ keepalive: true })` 폴백을 둔다 — 보고가 살아남도록.
 *  - 페이로드는 익명 — userId/디바이스/에러 본문 같은 PII 는 절대 포함하지 않는다.
 *    서버는 `AckBannerEventInput` 모양만 받는다 (`shared/ack-banner-event.ts`).
 *  - 어떤 예외도 호출자에게 전파되지 않아야 한다 — 보고 실패가 토스트 닫힘/구독 해제 흐름을
 *    가로막아선 안 된다.
 */

import type { AckBannerEventInput } from '@noilink/shared';

const ACK_BANNER_ENDPOINT = `${import.meta.env.VITE_API_URL || '/api'}/metrics/ack-banner`;

/**
 * 보고를 한 번만 시도한다 (fire-and-forget). 반환값 없음 — 결과를 기다리지 않는다.
 */
export function reportAckBannerEventFireAndForget(input: AckBannerEventInput): void {
  try {
    const body = JSON.stringify({
      reason: input.reason,
      burstCount: Math.max(1, Math.floor(input.burstCount)),
      burstDurationMs: Math.max(0, Math.floor(input.burstDurationMs)),
    });

    // 1순위: sendBeacon — 페이지 unload/navigate 후에도 브라우저가 전송을 보장한다.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(ACK_BANNER_ENDPOINT, blob)) return;
      } catch {
        // sendBeacon 이 동기 throw 하는 환경(SecurityError 등) 은 fetch 폴백으로 떨어진다.
      }
    }

    // 폴백: fetch + keepalive — 일부 WebView 에서 sendBeacon 이 막혔을 때.
    if (typeof fetch === 'function') {
      void fetch(ACK_BANNER_ENDPOINT, {
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
