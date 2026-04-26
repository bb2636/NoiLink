# ack 거부 토스트 텔레메트리 (Task #116)

상태: **운영 데이터 수집 시작 — 별도 대시보드 없이 SQL 한 건으로 조회 가능**
연관 코드:
- 클라이언트 보고: [`client/src/utils/reportAckBannerEvent.ts`](../../client/src/utils/reportAckBannerEvent.ts)
- 호출부 (subscribe + burst 추적): [`client/src/native/nativeAckErrors.ts`](../../client/src/native/nativeAckErrors.ts) — `subscribeAckErrorBanner`
- 외부 닫힘 알림(`notifyDismissed()`) 트리거:
  - [`client/src/pages/Device.tsx`](../../client/src/pages/Device.tsx)
  - [`client/src/pages/DeviceAdd.tsx`](../../client/src/pages/DeviceAdd.tsx)
  - [`client/src/pages/TrainingSessionPlay.tsx`](../../client/src/pages/TrainingSessionPlay.tsx)
- 서버 엔드포인트: [`server/routes/metrics.ts`](../../server/routes/metrics.ts) — `POST /api/metrics/ack-banner`
- 페이로드 정규화: [`shared/ack-banner-event.ts`](../../shared/ack-banner-event.ts) — `sanitizeAckBannerEventInput`

연관 이력: Task #77 (디버그 키 토스트) → Task #106 (burst 코얼레싱) → Task #109 (자동 닫힘 5초) → **본 문서 (Task #116)**.

---

## 1. 무엇이 기록되나

`subscribeAckErrorBanner` 가 노출하는 **burst** — 같은 ack 거부 사유가 짧은 시간 안에
연속으로 들어오는 묶음 — 이 끝나는 시점마다 클라이언트가 다음 익명 페이로드를
fire-and-forget 으로 `POST /api/metrics/ack-banner` 에 보낸다 (`navigator.sendBeacon`
1순위, `fetch { keepalive: true }` 폴백).

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `reason` | `auto-dismiss` \| `user-dismiss` \| `unmount` | burst 가 어떻게 끝났는지 (아래 표 참고) |
| `burstCount` | int ≥ 1 | burst 안에 누적된 거부 횟수 (단발도 1) |
| `burstDurationMs` | int ≥ 0 | 첫 거부부터 닫힘 시점까지의 경과 시간(ms) |

서버는 위 페이로드에 ISO-8601 `occurredAt` 만 부착해 `ackBannerEvents` JSONB
배열에 append 한다.

### `reason` 라벨 의미

| 값 | 의미 | 운영 해석 |
| --- | --- | --- |
| `auto-dismiss` | `subscribeAckErrorBanner` 의 자동 닫힘 타이머가 끝까지 살아남아 발화 | 토스트가 "조용히" 사라진 케이스. 비율이 높을수록 사용자는 토스트를 적극적으로 닫지 않고 흘려보낸다는 신호. |
| `user-dismiss` | 페이지가 `notifyDismissed()` 로 banner 가 외부에서 닫혔음을 알림 (현재는 `SuccessBanner` 의 `onClose` 가 트리거) | 사용자가 토스트를 읽고 닫았거나 SuccessBanner 의 자체 timeout 이 먼저 발화한 케이스. |
| `unmount` | 활성 burst 가 있는 상태에서 구독 해제(`unsubscribe()`) — 보통 화면 전환/언마운트 | "burst 가 끝났는데 자동 닫힘이 발화 못한" 코너 케이스 추적용. 비율이 비정상적으로 높으면 자동 닫힘 임계값(5초) 보다 짧은 화면 체류로 운영 데이터가 새고 있음을 의미. |

### 의도적으로 포함하지 않는 정보

- `userId` / `username` / 이메일 / 디바이스 식별자 / 토큰 — 어떤 PII 도 포함하지 않는다.
- 거부 사유 본문(`debugKey`, `error.message`) — 1차 버전에서는 받지 않는다. 어떤
  거부 키가 burst 를 만드는지 분해가 필요해지면 화이트리스트(예: `type` 만) 로만
  추가하기로 한다 — Task #106 의 `parseAckErrorString` 출력 일부를 카테고리로 보낼 수 있다.
- 화면 식별자 — 어떤 페이지에서 burst 가 났는지도 1차에는 받지 않는다. 페이지별 분해가
  필요해지면 `subscribeAckErrorBanner` 호출 시 카테고리 라벨을 인자로 추가하기로.

---

## 2. 한 줄 콘솔 로그

서버는 이벤트 한 건마다 다음 형식의 로그를 남긴다 (PII 없음).

```
[ack-banner] reason=auto-dismiss burstCount=3 burstDurationMs=4999
```

운영 알람·검색은 `rg "\[ack-banner\]"` 한 줄로 수집할 수 있다.

---

## 3. SQL 한 건으로 조회

PostgreSQL 백엔드(Neon/Supabase)에서 `kv_store.value` 가 JSONB 배열이므로,
다음 한 건으로 "지난 7일 ack 거부 토스트의 자동 닫힘 vs 사용자 닫힘 vs 화면 이탈 비율"을
조회한다.

```sql
SELECT
  elem->>'reason'                                              AS reason,
  COUNT(*)                                                     AS events,
  ROUND(AVG((elem->>'burstCount')::numeric), 2)                AS avg_burst_count,
  ROUND(AVG((elem->>'burstDurationMs')::numeric))              AS avg_burst_ms,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY (elem->>'burstDurationMs')::numeric
  )                                                            AS p50_burst_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY (elem->>'burstDurationMs')::numeric
  )                                                            AS p95_burst_ms
FROM kv_store, jsonb_array_elements(value) AS elem
WHERE key = 'ackBannerEvents'
  AND (elem->>'occurredAt')::timestamptz > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY events DESC;
```

자동 닫힘 임계값(`ACK_ERROR_AUTO_DISMISS_MS`, 현재 5_000ms) 튜닝 근거는 다음으로
요약한다.

- **`reason=auto-dismiss` 비율이 압도적으로 높고 `p95_burst_ms` 가 임계값에 가깝다면**
  → burst 가 임계값 안에서 충분히 식고 있다는 신호. 임계값을 낮춰도 (예: 3000ms)
  사용자가 카운터를 충분히 인지할 수 있다.
- **`reason=user-dismiss` 비율이 높고 `avg_burst_ms` 가 임계값보다 훨씬 짧다면**
  → 사용자가 토스트를 적극적으로 닫고 있어 임계값을 더 줄여도 무방하다.
- **`reason=unmount` 비율이 비정상적으로 높다면 (예: 10% 초과)**
  → "burst 가 끝났는데도 자동 닫힘이 발화 못한 채 사용자가 페이지를 뜬" 코너 케이스가
  있다는 신호. 자동 닫힘 임계값을 늘리거나 화면 전환 직전 강제 마감 훅 추가를 검토.

로컬 JSON / Replit DB 백엔드에서는 `ackBannerEvents` 키를 직접 읽어 동일한
집계를 스크립트로 돌리면 된다 — `node scripts/ack-banner-stats.mjs --days 7`
한 줄이 reason 별 events / avg_burst_count / avg_burst_ms / p50/p95 burst_ms 를
PostgreSQL 백엔드와 같은 한 줄 형식으로 출력한다 (스크립트는 `server/db.ts` 의
동일 추상화를 거치므로 PostgreSQL 백엔드에서도 같은 명령으로 동작한다).

---

## 4. 실패 모드 — 사용자에게 영향 없음

- 클라이언트는 어떤 예외도 호출자에게 전파하지 않으며 응답을 기다리지 않는다.
  `onTelemetry` 가 throw 해도 토스트/구독 흐름은 멈추지 않는다 (회귀 보호:
  [`client/src/native/__tests__/nativeAckErrors.test.ts`](../../client/src/native/__tests__/nativeAckErrors.test.ts)
  의 "onTelemetry 가 throw 해도" 케이스).
- 서버는 잘못된 모양/DB 쓰기 실패에도 항상 202 로 회신한다 (`recorded:false` 또는
  `ignored:true` 플래그). 회귀 검증은 [`server/routes/metrics.test.ts`](../../server/routes/metrics.test.ts)
  의 `POST /api/metrics/ack-banner` 블록을 참고한다.
- 같은 burst 가 두 번 보고되지 않도록 `subscribeAckErrorBanner` 안에 게이트가 있다
  (자동 닫힘 발화 후 들어온 `notifyDismissed()` 는 무시 — 회귀 보호 케이스 있음).
