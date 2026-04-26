/**
 * KST(한국 표준시, `Asia/Seoul`) 기준의 표시용 날짜 헬퍼 (Task #132).
 *
 * 배경:
 *  결과 화면 비교 카드의 직전 날짜 라벨은 직전 세션의 `createdAt` (ISO 8601, UTC)
 *  을 그대로 `new Date(...).getMonth()/getDate()` 로 변환해 만들었다. 즉 라벨이
 *  사용자의 브라우저 로컬 시간대로 결정돼, 자정 근처에 끝낸 세션이 다른 시간대
 *  디바이스에서 다른 날짜로 보이는 미세한 어긋남이 생길 수 있었다.
 *
 *  서비스는 한국 사용자를 기본으로 하므로 표시용 기준 시간대를 KST 로 고정한다.
 *  서버가 ISO 와 함께 KST 기준의 `YYYY-MM-DD` 표시용 문자열을 함께 내려주면
 *  클라이언트는 디바이스 시간대와 무관하게 항상 같은 라벨을 그릴 수 있다.
 *
 *  같은 헬퍼를 정상 완료 흐름(클라이언트가 사용자 이력에서 직전 세션 ISO 를 골라
 *  navigate state 로 결과 화면에 넘겨주는 경로)에서도 재사용해 두 흐름의 라벨이
 *  서로 어긋나지 않게 잠근다.
 */

/** 표시용 시간대(고정 KST). 응답의 `timeZone` 필드와 동일. */
export const KST_TIME_ZONE = 'Asia/Seoul';

/**
 * ISO 8601 UTC 시각을 KST 기준의 `YYYY-MM-DD` 문자열로 변환한다.
 *
 *  - `en-CA` 로케일은 `YYYY-MM-DD` 표기를 안정적으로 돌려준다(Node/브라우저 공통).
 *  - 자정 근처(UTC 15:00 = KST 다음 날 00:00) 케이스를 정확히 다음 날로 넘긴다.
 *  - 잘못된 ISO(파싱 실패)면 `null` — 호출자는 라벨을 폴백("직전") 으로 처리.
 */
export function isoToKstLocalDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // formatToParts 로 조립해 로케일/구현체에 따른 구분자 차이를 피한다.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}
