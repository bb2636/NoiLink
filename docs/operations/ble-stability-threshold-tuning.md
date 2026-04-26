# BLE 단절 안내 임계값 튜닝 가이드 (운영 데이터 기반)

상태: **1차 결정 = 기본값 유지 / 운영 데이터 N≥X 누적 후 재검토**
연관 코드:
- 임계값·오버라이드 훅: [`shared/ble-stability-config.ts`](../../shared/ble-stability-config.ts)
- 호출부 (안내 토스트): [`client/src/pages/TrainingSessionPlay.tsx`](../../client/src/pages/TrainingSessionPlay.tsx) — `resolveBleStabilityThresholds()`
- 회복 메타 정의: [`shared/types.ts`](../../shared/types.ts) — `RecoveryRawMetrics { excludedMs, windows }`
- 집계 로직: [`shared/recovery-stats.ts`](../../shared/recovery-stats.ts) — `aggregateRecoveryStats`, `shouldShowRecoveryCoaching`
- 정규화 (저장 직전): [`server/routes/metrics.ts`](../../server/routes/metrics.ts) — `normalizeRecoveryInPlace`

연관 이력: Task #38 (안내 토스트 도입) → Task #44 (임계값 단일 소스로 이관 + 오버라이드 훅) → **본 문서 (Task #47)**.

---

## 1. 배경

`DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD = 3`,
`DEFAULT_BLE_STABILITY_MS_THRESHOLD = 15_000` 두 값은 한 세션 안에서
회복 구간이 잦거나 누적 회복 시간이 길 때 **"BLE 환경 점검" 토스트를
1회만** 띄우는 기준이다. 임계가 너무 낮으면 단발성 잡음에도 토스트가 떠
사용자가 안내를 무시하게 되고, 너무 높으면 정작 환경 문제가 있는
사용자에게 안내가 도달하지 못한다.

도입 시점에는 기획 추정값을 그대로 썼기 때문에, 실제 운영 분포를 보고
(a) 기본값을 유지할지, (b) 디바이스 모델/펌웨어별 오버라이드를 등록할지
결정해야 한다. 본 문서는 그 분석 절차와 결정 근거를 남긴다.

---

## 2. 분석 단위와 데이터 위치

세션마다 1행씩 저장되는 `rawMetrics.recovery` (`RecoveryRawMetrics`)가
입력이다. 음수·NaN·누락은 `normalizeRecoveryInPlace`에서 이미 정규화돼
저장되므로, 분석 쿼리에서는 안전한 모양만 가정하면 된다.

| 컬럼 | 의미 | 비고 |
| --- | --- | --- |
| `recovery.windows` | 세션 내 회복 구간 발생 횟수 | 정수, 0 이상 |
| `recovery.excludedMs` | 세션 내 누적 회복 시간(ms) | 정수, 0 이상 |
| `recovery` 자체가 없음 | 단절이 한 번도 없었던 세션 | 분모(전체 세션)에는 포함, 분자에는 0으로 취급 |

분석 분모는 **"최근 N주의 모든 세션"** 이다. 회복이 없었던 세션을
빠뜨리면 평균이 과대 추정된다 (`aggregateRecoveryStats` 의 분모 정의와
동일하게 맞춘다).

---

## 3. 권장 분석 절차

### 3.1 기간 / 표본 크기

- 최근 **4주** 누적, 디바이스 모델/펌웨어 키로 그룹핑.
- 그룹별 표본이 **세션 ≥ 100건** 이상일 때만 의사결정에 사용한다.
  (소표본 그룹은 "데이터 부족 → 기본값 유지"로 분류)

### 3.2 분포 지표 (그룹별)

각 디바이스 모델·펌웨어 그룹에 대해 다음을 계산한다.

1. `windows` 분포: P50 / P75 / P90 / P95 / P99
2. `excludedMs` 분포: P50 / P75 / P90 / P95 / P99
3. `windows == 0 && excludedMs == 0` 인 세션 비율 (= "회복 한 번도 안
   일어난 세션 비율")
4. 현 임계 (`windows ≥ 3` 또는 `excludedMs ≥ 15_000`) 를 넘는 세션
   비율 = **현재 토스트 노출률** 추정치

### 3.3 결정 규칙

| 그룹의 현재 토스트 노출률 | 해석 | 액션 |
| --- | --- | --- |
| < 1% | 거의 안 뜸 — 임계가 너무 높거나 환경 양호 | 기본값 유지 (false-positive 위험만 있음) |
| 1% ~ 10% | 양호. 단절이 누적된 일부 사용자에게만 안내 | **기본값 유지** (현 정책) |
| 10% ~ 25% | 주의. 모델·펌웨어 차원의 환경 이슈가 의심됨 | 모델별 임계 **상향** 오버라이드 검토 + 환경 점검 가이드 별도 보강 (Task #43 라인) |
| > 25% | 임계가 노이즈처럼 트리거됨 — 안내 신뢰도 손상 | 모델별 임계 **상향** 오버라이드 즉시 등록, 동시에 펌웨어/디바이스 품질 이슈 트래킹 |

또한 **P75 가 현 임계의 절반 이상**이면 (예: `windows P75 ≥ 2`,
`excludedMs P75 ≥ 7_500`), 일상적으로 임계 근처에서 노는 그룹이므로
임계를 한 단계 올리는 것을 우선 검토한다.

### 3.4 쿼리 스케치

`rawMetrics` 컬렉션이 JSON 행 단위라 그룹핑 키(디바이스 모델·펌웨어)는
세션 메타에서 끌어오는 것이 자연스럽다. 현재 스키마에는 디바이스 모델
필드가 별도로 없으므로, 분석 시점에는 다음 중 하나를 사용한다:

- 클라이언트가 세션 시작 시 보내는 `byModeMetrics` / 세션 메타에 디바이스
  모델/펌웨어를 추가로 기록한 뒤 (별도 작업) 그 키로 조인.
- 그 전에는 **전체 모집단** 한 그룹으로 두고 위 분포만 본다.

집계 로직은 `aggregateRecoveryStats` 와 같은 정의를 재사용해 분석 결과와
런타임 코칭 신호의 정의가 어긋나지 않도록 한다 — `EMPTY_STATS`,
`sessionsWithRecovery` 의 분모/분자 약속을 그대로 따른다.

---

## 4. 1차 결정 (2026-04 시점)

**현재는 기본값을 유지한다.** 근거:

1. 디바이스 모델 키가 세션 메타에 아직 정형화돼 있지 않다 — 그룹별
   분포를 의미 있게 비교할 수 없다. 모델 키를 세션 메타에 영속화하는
   별도 작업이 선행돼야 그룹별 오버라이드가 가능하다.
2. Task #38/44 도입 직후로 표본이 충분히 누적되지 않았다. 표본이
   확보되기 전에 임계를 흔들면 노출률 변화의 원인을 임계 변경과 자연
   분포 변동 중 어느 쪽으로 돌릴지 가릴 수 없다.
3. 현 임계 (`windows ≥ 3 || excludedMs ≥ 15s`)는 "한 세션 안에서
   회복이 3번 또는 15초 누적" 이라는, 사용자가 체감하기에 분명히 잦은
   수준에서만 트리거한다. 보수적인 기본값으로서 false-positive 위험이
   낮다.

결과: `DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD`,
`DEFAULT_BLE_STABILITY_MS_THRESHOLD` 값을 **변경하지 않고**,
`setBleStabilityOverrideResolver` 도 등록하지 않는다 (즉, 호출부는
shared 의 기본값을 그대로 사용).

---

## 5. 재검토 트리거 (소유자 / 주기)

- **소유자**: 백엔드/플랫폼 당번 (운영 메트릭 대시보드 점검 책임자).
- **주기**: 매주 1회 운영 대시보드 점검 시 §7 표를 갱신하고, 트리거가
  걸리면 본 문서를 다시 연다. 변경이 없어도 표의 "최근 점검일" 만은
  매주 갱신해 점검이 살아있음을 표시한다.

다음 중 **하나라도** 발생하면 본 문서를 다시 연다.

- 누적 표본이 모델/펌웨어 키 그룹별로 100세션 ≥ 인 그룹이 둘 이상
  생긴다.
- 결과 화면 회복 안내 / 토스트 노출률이 운영 대시보드 기준 **10% 이상**
  으로 일주일 연속 유지된다.
- 펌웨어 릴리스가 BLE 안정성에 영향을 주는 변경을 포함한다 — 신·구
  펌웨어 분포가 같다고 가정할 수 없다.
- 사용자 CS 또는 인박스에서 "토스트가 너무 자주 뜬다 / 한 번도 못 봤다"
  유형의 피드백이 누적된다.

재검토 시 §3 절차를 그대로 돌리고, 결과·결정·날짜를 §6 변경 이력에
추가한다. 운영 대시보드에서 노출률을 직접 확인할 수 없는 동안에는
§7 표를 수동으로 채워 결정의 근거 데이터를 남긴다.

---

## 6. 변경 이력

| 날짜 | 결정 | 근거 요약 |
| --- | --- | --- |
| 2026-04-26 | 기본값 유지, 오버라이드 미등록 | 모델 키 미정형 + 표본 미축적 (§7 표가 비어 있음). §4 참고. |

---

## 7. 현재 표본 / 실측치

§3 절차로 산출한 분포를 매주 이 표에 채워 의사결정 근거로 남긴다.
**현재 (2026-04-26 점검) 분석 환경의 `rawMetrics` 누적 행수는 0** 으로,
프로덕션 백엔드에서 같은 쿼리를 다시 돌려야 의미 있는 수치가 나온다.
표는 모델 키가 세션 메타에 정형화된 뒤에는 모델/펌웨어 그룹별로
한 행씩 분리해 쓴다.

| 점검일 | 그룹 (model/firmware) | 기간 | 세션 수 | windows P50/P90/P95 | excludedMs P50/P90/P95 (ms) | 임계 초과 세션 비율 (= 토스트 노출률 추정치) | 비고 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-04-26 | 전체 (모델 미정형) | 최근 4주 | 0 | – / – / – | – / – / – | – | 분석 환경의 `data/db.json` 에 `rawMetrics` 행 없음. 프로덕션에서 재집계 필요. |

표 채우는 법:

1. 프로덕션 DB 에서 `rawMetrics` 의 최근 4주 행을 가져온다.
2. 각 행의 `recovery.windows`, `recovery.excludedMs` (없으면 0,0) 로
   `aggregateRecoveryStats` 와 같은 정의의 분포를 계산한다 — 분모는
   "회복 없는 세션 포함 전체 세션 수" 임을 잊지 않는다.
3. 임계 초과 세션 = `windows ≥ DEFAULT_BLE_STABILITY_WINDOW_THRESHOLD`
   **또는** `excludedMs ≥ DEFAULT_BLE_STABILITY_MS_THRESHOLD` 인 행. 이
   비율이 §3.3 의 결정 규칙 입력값이 된다.
4. 결과를 표에 한 행 추가하고 (위 행은 지우지 않음 — 시계열로 쌓는다)
   비고에 점검자/특이사항을 적는다.

---

## 부록 A. 모델별 오버라이드 등록 템플릿

추후 분석에서 특정 모델의 임계만 조정해야 할 때, 앱 부트스트랩 또는
원격 설정 적용 시점에서 **단 한 번** 다음과 같이 등록한다.

```ts
// 예: client/src/main.tsx 또는 부트스트랩 모듈에서
import { setBleStabilityOverrideResolver } from '@noilink/shared';

setBleStabilityOverrideResolver(({ deviceModel }) => {
  // 모델별 임계만 부분 오버라이드 — 미반환 필드는 기본값을 그대로 사용한다.
  if (deviceModel === 'NoiPod-A1') {
    return { windowThreshold: 5, msThreshold: 25_000 };
  }
  return null; // 그 외 모델은 기본값 유지
});
```

주의:

- 부분 오버라이드(`Partial<BleStabilityThresholds>`)만 돌려줘도 된다 —
  나머지 필드는 shared 의 기본값으로 보강된다.
- `null`/`undefined` 또는 NaN/음수는 안전하게 무시되고 기본값이 쓰인다
  (`pickPositive` 가드).
- 컨텍스트의 `deviceModel` 을 채우려면 호출부 (현재
  `TrainingSessionPlay.tsx` 의 `resolveBleStabilityThresholds({ userId })`)
  에 디바이스 식별자를 함께 넘기도록 수정해야 한다 — 모델 키 정형화
  작업과 함께 진행한다.
