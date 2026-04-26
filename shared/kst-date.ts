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

/**
 * `YYYY-MM-DD` 문자열을 받아 그 날짜의 요일을 월=0..일=6 인덱스로 돌려준다 (Task #144).
 *
 *  - 입력은 이미 KST 기준으로 환산된 달력 날짜라고 가정한다 (`isoToKstLocalDate` 출력).
 *  - `Date.UTC` + `getUTCDay()` 로 디바이스 시간대 영향을 받지 않는 요일을 얻는다.
 *  - 형식이 어긋난 입력은 `null` — 호출자는 안전하게 폴백한다.
 */
export function kstWeekdayMon0FromYmd(ymd: string | null | undefined): number | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(utc.getTime())) return null;
  // getUTCDay: 0=일, 1=월, ..., 6=토 → 월=0..일=6 으로 변환
  return (utc.getUTCDay() + 6) % 7;
}

/**
 * KST 기준의 ISO 시각이 속한 주(週) 의 월요일 자정 날짜를 `YYYY-MM-DD` 로 돌려준다 (Task #144).
 *
 *  - 홈 "주간 출석 도장" 7칸의 시작점(월요일)을 디바이스 시간대 영향 없이 잠그기 위한 기준.
 *  - 자정 근처(KST) 에 끝낸 세션이 UTC 디바이스에서 다른 주로 떨어지는 어긋남을 막는다.
 */
export function kstStartOfWeekMonYmd(iso: string | null | undefined): string | null {
  const ymd = isoToKstLocalDate(iso);
  if (!ymd) return null;
  const mon0 = kstWeekdayMon0FromYmd(ymd);
  if (mon0 === null) return null;
  const [y, mo, d] = ymd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d));
  utc.setUTCDate(utc.getUTCDate() - mon0);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * `YYYY-MM-DD` 문자열 두 개의 달력 일수 차이 (Task #144).
 *
 *  - 양수면 `later` 가 `earlier` 보다 뒤. DST 가 없는 KST 에서는 안전하다.
 *  - 두 입력 모두 이미 같은 시간대(KST) 에서 환산된 달력 날짜라고 가정한다.
 *  - 형식이 어긋난 입력은 `null` — 호출자는 비교를 건너뛴다.
 */
export function kstYmdDiffDays(later: string, earlier: string): number | null {
  const lm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(later);
  const em = /^(\d{4})-(\d{2})-(\d{2})$/.exec(earlier);
  if (!lm || !em) return null;
  const a = Date.UTC(Number(lm[1]), Number(lm[2]) - 1, Number(lm[3]));
  const b = Date.UTC(Number(em[1]), Number(em[2]) - 1, Number(em[3]));
  return Math.round((a - b) / 86_400_000);
}
