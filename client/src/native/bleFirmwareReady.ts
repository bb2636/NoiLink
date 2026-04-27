/**
 * NoiPod 본체에 정식 펌웨어가 탑재되어 있는지 추적한다.
 *
 * 정식 펌웨어가 광고 이름을 'NoiPod-XXXX' 로 바꾸기로 펌웨어팀과 합의되어
 * 있으므로(`shared/ble-constants.ts` 주석 참고), 광고 이름의 prefix 만으로
 * 펌웨어 탑재 여부를 추정한다.
 *
 * 펌웨어가 없으면(예: u-blox NINA-B1 모듈의 디폴트 BLE-UART 펌웨어 그대로,
 * 광고명 'NINA-B1-XXXXXX'):
 *  - LED/SESSION/CONTROL write 를 보내봐야 모듈 단에서 무시된다.
 *  - 일부 NINA 펌웨어는 idle 상태에서 자동 disconnect 하기도 한다.
 *  - withResponse write 는 ack 가 없어 timeout → ack(false) 토스트로 이어질 수 있다.
 *
 * 따라서 "펌웨어 미탑재" 로 판단되면 웹 측이 다음을 자동으로 적용한다:
 *  1) `bleBridge.post()` 가 BLE write 메시지를 silent no-op 처리 (실패도 안 일어남).
 *  2) `TrainingSessionPlay` 가 BLE 단절을 트레이닝 종료 사유로 보지 않음.
 *  3) 트레이닝은 화면 PodGrid + 화면 탭만으로 정상 완주된다.
 *
 * 이 모듈의 상태는 native bridge 의 `ble.connection` 이벤트가 도착할 때마다
 * `setBleConnectedDeviceName()` 으로 갱신된다(`initNativeBridge.ts` 에서 호출).
 */

const NOIPOD_FIRMWARE_PREFIX = 'NOIPOD';

/**
 * 광고 이름이 정식 NoiPod 펌웨어로 보이는가?
 * 대소문자는 무시한다(펌웨어팀이 'NoiPod-XXXX' 든 'noipod-xxxx' 든 광고 가능).
 */
export function looksLikeNoiPodFirmware(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.trim().toUpperCase().startsWith(NOIPOD_FIRMWARE_PREFIX);
}

let lastDeviceName: string | null = null;

/**
 * 마지막으로 연결된(또는 직전에 연결되어 있던) BLE 기기 이름을 갱신한다.
 *
 * - name 이 truthy 면 그 이름으로 갱신
 * - name 이 falsy 면(단절 / 미연결 통보) 직전 상태를 그대로 유지한다.
 *   트레이닝 도중 단절되었을 때 직전 펌웨어 판정을 잃어 abort 가드가
 *   풀려 버리는 사고를 방지한다. 다음 연결 이벤트가 오면 그때 다시 set 된다.
 */
export function setBleConnectedDeviceName(name: string | null | undefined): void {
  if (!name) return;
  lastDeviceName = name;
}

/** 디버그/테스트용 — 명시적으로 상태를 비운다. */
export function resetBleFirmwareReadyState(): void {
  lastDeviceName = null;
}

/** 가장 최근에 본 기기 이름. 미본 상태면 null. */
export function getLastBleDeviceName(): string | null {
  return lastDeviceName;
}

/**
 * 현재 연결 대상이 정식 펌웨어를 탑재했다고 추정되는가?
 *
 * 정책 변경(사용자 결정): NoiLink 의 본질은 "앱은 타이머 + 신호 전달기,
 * 실제 점등/입력 캡처는 기기 펌웨어"이다. 따라서 광고명 휴리스틱으로
 * 임의로 시연 모드를 끼워넣지 않는다. 항상 정식 펌웨어가 있다고 가정해
 * BLE write 를 native 로 그대로 보낸다. 기기 펌웨어가 없거나 응답이 없는
 * 케이스는 사용자가 BLE 단절/응답 부재로 인지한다.
 *
 * 모듈 자체와 `looksLikeNoiPodFirmware` / `setBleConnectedDeviceName` 등은
 * 디버그·향후 명시적 토글(예: 디바이스 페이지의 "데모 모드" 스위치)용으로
 * 그대로 둔다.
 */
export function getBleFirmwareReady(): boolean | null {
  return true;
}
