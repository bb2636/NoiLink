# NoiPod LED OFF 프레임 컨벤션 (펌웨어 ↔ 앱 합의서)

상태: **합의 요청 / 펌웨어 구현 대기**
대상 펌웨어: NoiPod (NINA-B1 모듈) v0.x 이후
정본 코드: [`shared/ble-protocol.ts`](../../shared/ble-protocol.ts) — `encodeLedOffFrame`, `isLedOffPayload`, `COLOR_CODE.OFF`
관련 앱 코드: [`client/src/training/engine.ts`](../../client/src/training/engine.ts) — `bleOffPod`, `allOff`, `handleRhythmTap`

---

## 1. 배경

리듬(RHYTHM) 모드에서 사용자는 LED 점등 시간(`onMs`) 안에 탭해야 한다.
사용자가 `onMs` 만료 전에 탭하거나, 엔진이 `allOff()`를 호출해 페이즈를
종료하는 시점에 **앱 화면 UI는 즉시 소등**된다. 그러나 BLE LED Write 프레임에는
`onMs`(= 자동 소등 타이머)가 들어 있어, 펌웨어가 그 타이머만 보고 있으면
실제 LED는 잔여 `onMs`가 끝날 때까지 켜진 채 남는다.

이 잔상은 다음 점등 사이클과 겹쳐 사용자에게 "한 박자 늦게 꺼지는" 인상을 주고,
RHYTHM 판정 결과(점수)와 시각 피드백이 어긋나는 사용성 문제를 만든다.

해결책: 앱이 명시적으로 OFF 프레임을 송신할 때, 펌웨어가 잔여 onMs를 무시하고
즉시 LED를 소등하도록 한다.

---

## 2. 컨벤션

`OP_LED (0x01)` 프레임을 수신했을 때, **다음 두 조건 중 하나라도** 충족하면
해당 `pod`의 LED를 **즉시 소등**한다.

| 조건 | 의미 |
| --- | --- |
| `colorCode == 0xFF` | 명시적 OFF 색 (`COLOR_CODE.OFF`) |
| `onMs == 0`         | 점등 시간 0 → 즉시 OFF |

두 조건은 **OR** 관계이며, 어느 한쪽만 충족해도 OFF로 해석한다(이중 안전장치).
앱은 일반적으로 두 조건을 동시에 충족시켜 보낸다 (`encodeLedOffFrame` 참고).

펌웨어가 수행해야 하는 동작:

1. 해당 `pod`에 대해 진행 중인 자동 소등 타이머가 있다면 **취소**한다.
2. PWM/드라이버 출력을 즉시 0으로 만든다.
3. (선택) OFF 프레임 자체에 대해서는 ack/notify 없음 — 기존 LED Write와 동일.

OFF 프레임이 연속으로 와도 멱등(idempotent)으로 처리한다 (이미 꺼져 있으면 no-op).

### 2.1 BLE 전송 모드

앱은 OFF 프레임을 **`withResponse` (ack 보장) 모드**로 송신한다
(`client/src/training/engine.ts` 의 `bleOffPod`).
일반 점등 프레임은 저지연을 위해 `noResponse`를 우선 시도하지만, OFF 프레임은
전파 손실 시 잔상이 직접 보이므로 안정성을 우선한다.
펌웨어는 두 모드 모두를 동일하게 처리한다 — write 모드는 BLE 스택의 ack 여부만
다르고 페이로드/세맨틱은 같다.

---

## 3. 프레임 바이트 레이아웃

기존 `OP_LED` 프레임과 동일한 12바이트 구조를 사용한다. 새 OP 코드 없음.

```
offset  size  field        값(OFF 프레임)
0       1     SYNC_BYTE    0xA5
1       1     OP           0x01 (OP_LED)
2..5    4     tickId       u32 LE (마지막 점등의 tickId 그대로 재사용)
6       1     pod          0..3
7       1     colorCode    0xFF (COLOR_CODE.OFF)
8..9    2     onMs         u16 LE = 0x0000
10      1     flags        0
11      1     reserved     0
```

`tickId`는 새로 발급하지 않고, 같은 점등 사이클의 점등 프레임에서 사용한
`tickId`를 그대로 재사용한다. 펌웨어는 같은 점등에 대한 OFF 신호임을
이 값으로 식별할 수 있다 (필수 아님 — 단순 무시 가능).

### 3.1 테스트 벡터

펌웨어 구현 검증용 — 아래 hex가 들어오면 해당 pod의 LED는 즉시 꺼져야 한다.

```
# pod=0, tickId=0, color=OFF, onMs=0
A5 01 00 00 00 00 00 FF 00 00 00 00

# pod=2, tickId=0x12345678, color=OFF, onMs=0
A5 01 78 56 34 12 02 FF 00 00 00 00

# pod=1, tickId=0x42, color=GREEN(0x00), onMs=0  ← onMs=0 단독으로도 OFF
A5 01 42 00 00 00 01 00 00 00 00 00
```

---

## 4. 수용 기준 (앱 ↔ 펌웨어 통합 검증)

- [ ] 위 3.1의 세 테스트 벡터 모두에서 LED가 즉시 꺼진다(잔상 없음).
- [ ] 점등 직후(예: onMs=300, 50ms 경과) OFF 프레임 수신 시, **잔여 250ms를
      기다리지 않고** 50ms 시점에 LED가 꺼진다.
- [ ] RHYTHM 모드에서 사용자가 onMs 안에 탭했을 때, 화면 UI 소등 시점과
      디바이스 LED 소등 시점이 **±20ms 이내**로 일치한다 (실기기 측정 필요).
- [ ] 펌웨어 릴리스 노트에 본 컨벤션이 명시되어 있다.

### 권장 측정 절차 (±20ms)

1. NoiPod 한 대 + 카메라(120fps 이상) 또는 로직 애널라이저를 준비한다.
2. RHYTHM 모드 BPM=80 / Lv=3 (onMs ≈ 245ms) 으로 트레이닝 시작.
3. 점등 직후 100ms 경계에서 의도적으로 탭 → 화면 UI와 LED를 한 프레임에 함께 캡처.
4. 카메라 프레임 간격(8ms @ 120fps) 기준으로 두 소등 시점 차이를 측정.
5. 10회 측정 평균 |Δ| ≤ 20ms 이면 통과.

---

## 5. 앱 측 구현 위치 (참고)

| 함수 | 파일 | 역할 |
| --- | --- | --- |
| `encodeLedOffFrame` | `shared/ble-protocol.ts` | 12바이트 OFF 프레임 인코더 (정본 빌더) |
| `isLedOffPayload` | `shared/ble-protocol.ts` | 수신 페이로드가 OFF 컨벤션을 만족하는지 검사 |
| `bleOffPod` | `client/src/training/engine.ts` | 단일 Pod에 OFF 프레임 송신 |
| `allOff` | `client/src/training/engine.ts` | 모든 켜진 Pod에 OFF 프레임 일괄 송신 |
| `handleRhythmTap` | `client/src/training/engine.ts` | 사용자가 onMs 안에 탭하면 즉시 `bleOffPod` 호출 |

---

## 6. 비고 / 향후 변경

- 새로운 색 코드를 도입할 때 `0xFF`는 영구적으로 OFF에 예약된다 — 다른 색에 재사용 금지.
- 펌웨어가 OP 단위 ACK를 도입할 경우, OFF 프레임은 별도의 응답 코드를 가지지 않는다
  (기존 LED 점등 프레임과 동일한 처리).
- 본 컨벤션 변경 시 본 문서, `shared/ble-protocol.ts`, 펌웨어 릴리스 노트를 동시에
  갱신한다.
