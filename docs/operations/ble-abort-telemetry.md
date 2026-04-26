# BLE 자동 종료 텔레메트리 (Task #57)

상태: **운영 데이터 수집 시작 — 별도 대시보드 없이 SQL 한 건으로 조회 가능**
연관 코드:
- 클라이언트 보고: [`client/src/utils/reportBleAbort.ts`](../../client/src/utils/reportBleAbort.ts)
- 호출부 (`finalizeAndAbort`): [`client/src/pages/TrainingSessionPlay.tsx`](../../client/src/pages/TrainingSessionPlay.tsx)
- 서버 엔드포인트: [`server/routes/metrics.ts`](../../server/routes/metrics.ts) — `POST /api/metrics/ble-abort`
- 페이로드 정규화: [`shared/ble-abort-event.ts`](../../shared/ble-abort-event.ts) — `sanitizeBleAbortEventInput`
- 환경 점검 안내 분류 기준: [`client/src/pages/trainingAbortReason.ts`](../../client/src/pages/trainingAbortReason.ts) — `isBleUnstableForAbort`

연관 이력: Task #38 (안내 토스트) → Task #43 (abort 배너 환경 점검 한 줄) → **본 문서 (Task #57)**.

---

## 1. 무엇이 기록되나

`TrainingSessionPlay.finalizeAndAbort('ble-disconnect')` 가 호출되는 모든 BLE
자동 종료 시점에, 클라이언트가 다음 익명 페이로드를 fire-and-forget 으로
`POST /api/metrics/ble-abort` 에 보낸다 (`navigator.sendBeacon` 1순위, `fetch
{ keepalive: true }` 폴백).

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `windows` | int ≥ 0 | 세션 동안 시작된 회복 구간 횟수 (`getRecoveryStats().windows`) |
| `totalMs` | int ≥ 0 | 회복 구간 누적 시간(ms), 진행 중인 구간 포함 |
| `bleUnstable` | boolean | `isBleUnstableForAbort` 가 환경 점검 안내 임계(windows≥1 OR totalMs≥5_000)를 넘겼는지 여부 |
| `apiMode` | TrainingMode? | 트레이닝 모드 라벨 (모드별 신뢰도 분석용, 누락 가능) |

서버는 위 페이로드에 ISO-8601 `occurredAt` 만 부착해 `bleAbortEvents` JSONB
배열에 append 한다.

### 의도적으로 포함하지 않는 정보

- `userId` / `username` / 이메일 / 디바이스 식별자 / 토큰 — 어떤 PII 도 포함하지
  않는다 (집계 외 용도로 쓰일 수 없도록 페이로드를 의도적으로 좁게 유지).
- `sessionId` — 세션 식별자도 받지 않는다. 운영 집계는 모드별/임계별 비율만으로
  충분하므로, 개별 세션 추적이 필요해질 때까지는 내보내지 않는다.

---

## 2. 한 줄 콘솔 로그

서버는 이벤트 한 건마다 다음 형식의 로그를 남긴다 (PII 없음).

```
[ble-abort] windows=2 totalMs=7500 bleUnstable=true apiMode=FOCUS
```

운영 알람·검색은 `rg "\[ble-abort\]"` 한 줄로 수집할 수 있다.

---

## 3. SQL 한 건으로 조회

PostgreSQL 백엔드(Neon/Supabase)에서 `kv_store.value` 가 JSONB 배열이므로,
다음 한 건으로 "지난 7일 BLE 자동 종료 중 환경 점검 안내가 떴던 비율" 을
조회한다.

```sql
SELECT
  COUNT(*)                                                   AS total_aborts,
  COUNT(*) FILTER (WHERE (elem->>'bleUnstable')::boolean)    AS unstable_aborts,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE (elem->>'bleUnstable')::boolean)
      / NULLIF(COUNT(*), 0),
    2
  )                                                          AS unstable_pct
FROM kv_store, jsonb_array_elements(value) AS elem
WHERE key = 'bleAbortEvents'
  AND (elem->>'occurredAt')::timestamptz > NOW() - INTERVAL '7 days';
```

모드별 분해가 필요하면 `GROUP BY elem->>'apiMode'` 를 추가한다.

```sql
SELECT
  COALESCE(elem->>'apiMode', '-')                            AS api_mode,
  COUNT(*)                                                   AS total_aborts,
  COUNT(*) FILTER (WHERE (elem->>'bleUnstable')::boolean)    AS unstable_aborts,
  ROUND(AVG((elem->>'totalMs')::numeric))                    AS avg_recovery_ms
FROM kv_store, jsonb_array_elements(value) AS elem
WHERE key = 'bleAbortEvents'
  AND (elem->>'occurredAt')::timestamptz > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY total_aborts DESC;
```

로컬 JSON / Replit DB 백엔드에서는 `bleAbortEvents` 키를 직접 읽어 동일한
집계를 스크립트로 돌리면 된다.

---

## 4. 실패 모드 — 사용자에게 영향 없음

- 클라이언트는 어떤 예외도 호출자에게 전파하지 않으며 응답을 기다리지 않는다.
- 서버는 잘못된 모양/DB 쓰기 실패에도 항상 202 로 회신한다 (`recorded:false` 또는
  `ignored:true` 플래그). 회귀 검증은 [`server/routes/metrics.test.ts`](../../server/routes/metrics.test.ts)
  의 `POST /api/metrics/ble-abort` 블록을 참고한다.
