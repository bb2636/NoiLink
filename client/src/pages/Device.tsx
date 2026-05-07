/**
 * 기기 관리 페이지
 * 등록된 기기 목록, 연결/해제, 기기 추가 이동
 */
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import SuccessBanner from '../components/SuccessBanner/SuccessBanner';
import { STORAGE_KEYS } from '../utils/constants';
import { ensureDemoDevicesSeeded } from '../utils/seedDemoDevices';
import {
  bleConnect,
  bleDisconnect,
  bleWriteLed,
  bleWriteControl,
  getLegacyEmittedCount,
  getLegacyLastEmittedFrameHex,
} from '../native/bleBridge';
import { COLOR_CODE, CTRL_START, CTRL_STOP } from '@noilink/shared';
import { getBleFirmwareReady } from '../native/bleFirmwareReady';
import { getLegacyBleMode } from '../native/legacyBleMode';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { subscribeAckErrorBanner, type AckBannerSubscription } from '../native/nativeAckErrors';
import type { NativeToWebMessage } from '@noilink/shared';

export interface DeviceInfo {
  id: string;
  name: string;
  deviceId: string;
  isConnected: boolean;
  battery?: number;
  signal?: '안정적' | '불안정' | null;
}

interface RegisteredDevice {
  id: string;
  name: string;
  deviceId: string;
  registeredAt: string;
}

function getConnectedDeviceId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONNECTED_DEVICE);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.id ?? null;
  } catch {
    return null;
  }
}

function loadRegisteredDevices(): RegisteredDevice[] {
  try {
    // 데모 기기 자동 시드 — 사용자가 한 번도 추가/삭제한 적 없을 때만 1회 동작
    ensureDemoDevicesSeeded();
    const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_DEVICES);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRegisteredDevices(list: RegisteredDevice[]): void {
  localStorage.setItem(STORAGE_KEYS.REGISTERED_DEVICES, JSON.stringify(list));
}

export default function Device() {
  const navigate = useNavigate();
  const isNative = isNoiLinkNativeShell();
  const [connectedId, setConnectedId] = useState<string | null>(getConnectedDeviceId);
  const [registered, setRegistered] = useState<RegisteredDevice[]>(loadRegisteredDevices);
  // 브릿지가 web→native 메시지를 거부할 때 (`native.ack.ok=false`) 화면에 띄울 안내.
  // 핵심 흐름(연결/해제) 도중 조용히 실패하지 않도록 짧은 토스트로 사유를 노출한다 (Task #77).
  const [ackErrorBanner, setAckErrorBanner] = useState<string | null>(null);
  // BLE 진단 — 연결된 기기 카드 하단에 한 줄로 노출. 트레이닝 화면과 동일한
  // 출처(getBleFirmwareReady / getLegacyBleMode / getLegacyEmittedCount /
  // getLegacyLastEmittedFrameHex)로 1Hz 폴링. "연결됨 표시인데 점등이 안 들어옴"
  // 같은 모호한 상태를 사용자/QA 가 화면에서 즉시 추적할 수 있게 한다.
  const [bleDiag, setBleDiag] = useState<{
    fwLabel: string;
    legacyLabel: string;
    emitted: number;
    lastFrame: string;
  }>({ fwLabel: '?', legacyLabel: '?', emitted: 0, lastFrame: '' });
  // 테스트 점등 진행 중 표시 — 다중 클릭 방지 + 버튼 라벨 전환에 사용.
  const [testBlinkRunning, setTestBlinkRunning] = useState(false);

  /**
   * 테스트 점등 — 트레이닝 화면에 진입하지 않고도 점등 신호가 실제로
   * 기기에 도달해 LED 가 켜지는지 즉시 확인할 수 있는 진단 도구.
   * START → Pod 1~4 순차 RED 점등 → STOP 순으로 보낸다.
   * 레거시 모드 ON 이면 `4eXX0d`/`aa55`/`ff` 형식, OFF 이면 NoiPod 정식
   * 12바이트 프레임으로 송신된다(`bleWriteLed`/`bleWriteControl` 분기).
   *
   * "기기 연결은 됐는데 점등이 안 들어옴"과 "기기가 아예 안 받음" 을
   * 사용자가 스스로 분리할 수 있게 한다 — 점등이 한 개라도 들어오면
   * BLE 채널은 살아있으므로 트레이닝 측 문제로 좁혀진다.
   */
  const handleTestBlink = async () => {
    if (testBlinkRunning) return;
    setTestBlinkRunning(true);
    try {
      bleWriteControl(CTRL_START);
      await new Promise((r) => setTimeout(r, 200));
      for (let pod = 0; pod < 4; pod++) {
        bleWriteLed({ tickId: pod, pod, colorCode: COLOR_CODE.RED, onMs: 500 });
        await new Promise((r) => setTimeout(r, 700));
      }
      bleWriteControl(CTRL_STOP);
    } finally {
      setTestBlinkRunning(false);
    }
  };
  useEffect(() => {
    const tick = () => {
      const fw = getBleFirmwareReady();
      // 좁은 화면 가로 오버플로 방지 — 앞 20자만 노출.
      const raw = getLegacyLastEmittedFrameHex() || '';
      const lastFrame = raw.length > 20 ? `${raw.slice(0, 20)}…` : raw;
      setBleDiag({
        fwLabel: fw === true ? 'O' : fw === false ? 'X' : '?',
        legacyLabel: getLegacyBleMode() ? 'ON' : 'OFF',
        emitted: getLegacyEmittedCount(),
        lastFrame,
      });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const devicesWithConnection: DeviceInfo[] = registered.map((d) => ({
    id: d.id,
    name: d.name,
    deviceId: d.deviceId,
    isConnected: connectedId === d.id,
  }));

  // localStorage / 네이티브 BLE 이벤트로 연결 상태 동기화.
  // (1) 'storage' — 다른 탭/창에서 변경된 경우 (web 전용)
  // (2) 'noilink-native-bridge' (ble.connection) — native 측 BLE 연결/해제
  // (3) visibilitychange / focus — 다른 페이지에서 연결/해제가 일어난 뒤
  //     디바이스 페이지로 돌아오거나, 폰을 잠갔다 깨운 직후에도 마지막
  //     상태가 즉시 화면에 반영되도록 보강. 사용자가 "기기 관리에서
  //     실시간으로 보이지 않는다"고 신고한 케이스 대응.
  useEffect(() => {
    const reloadFromStorage = () => {
      setConnectedId(getConnectedDeviceId());
      setRegistered(loadRegisteredDevices());
    };
    window.addEventListener('storage', reloadFromStorage);

    const bridgeHandler = (e: Event) => {
      const msg = (e as CustomEvent<NativeToWebMessage>).detail;
      if (msg.type !== 'ble.connection') return;
      const c = msg.payload.connected;
      if (c) {
        try {
          localStorage.setItem(
            STORAGE_KEYS.CONNECTED_DEVICE,
            JSON.stringify({ id: c.id, name: c.name || 'NoiPod', deviceId: c.id }),
          );
        } catch {}
        setConnectedId(c.id);
        // 새 기기가 native 단에서 막 등록된 경우도 함께 끌어온다.
        setRegistered(loadRegisteredDevices());
      } else {
        // 연결 종료 (정상/오류 모두)
        localStorage.removeItem(STORAGE_KEYS.CONNECTED_DEVICE);
        setConnectedId(null);
      }
    };
    window.addEventListener('noilink-native-bridge', bridgeHandler as EventListener);

    const onVisible = () => {
      if (document.visibilityState === 'visible') reloadFromStorage();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', reloadFromStorage);

    return () => {
      window.removeEventListener('storage', reloadFromStorage);
      window.removeEventListener('noilink-native-bridge', bridgeHandler as EventListener);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', reloadFromStorage);
    };
  }, []);

  // ack(ok=false) 구독 — 브릿지가 거부한 사유를 사용자/QA 가 모두 읽을 수 있는
  // 토스트로 노출. 디버그 키(`type:reason@field`)도 함께 보여줘 버그 리포트 단서를 남긴다.
  // 같은 사유가 연속으로 쏟아지면 카운터로 묶어 보여줘 토스트 깜빡임을 막는다 (Task #106).
  // 외부 닫힘은 ackBannerSubRef 의 두 콜백으로 분리해 흘린다 — X 닫기 버튼은
  // notifyDismissed() (user-dismiss), SuccessBanner 자체 duration 타이머는
  // notifyBannerTimeout() (banner-timeout). 운영 텔레메트리에서 "진짜 사용자
  // 닫힘 비율" 을 단독으로 읽을 수 있게 한다 (Task #116, Task #129).
  const ackBannerSubRef = useRef<AckBannerSubscription | null>(null);
  useEffect(() => {
    const sub = subscribeAckErrorBanner(setAckErrorBanner);
    ackBannerSubRef.current = sub;
    return () => {
      sub.unsubscribe();
      ackBannerSubRef.current = null;
    };
  }, []);

  const handleConnectAction = (device: DeviceInfo) => {
    if (device.isConnected) {
      // 연결 해제 → 네이티브 BLE disconnect
      if (isNative) bleDisconnect(device.id);
      localStorage.removeItem(STORAGE_KEYS.CONNECTED_DEVICE);
      setConnectedId(null);
    } else {
      // 등록된 기기 재연결 시도
      if (isNative) {
        bleConnect(device.id);
      } else {
        navigate('/device/add');
      }
    }
  };

  const handleRemove = (device: DeviceInfo) => {
    if (!confirm(`"${device.name}" 기기를 등록 해제하시겠어요?`)) return;
    if (device.isConnected && isNative) bleDisconnect(device.id);
    const next = registered.filter((d) => d.id !== device.id);
    saveRegisteredDevices(next);
    setRegistered(next);
    if (device.isConnected) {
      localStorage.removeItem(STORAGE_KEYS.CONNECTED_DEVICE);
      setConnectedId(null);
    }
  };

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 pb-6" style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))', paddingBottom: '120px' }}>
        {/* 헤더 — 뒤로가기 버튼 터치 영역(48×48) 확보, 타이틀과 명확히 구분 */}
        <div className="mb-6 flex items-center gap-2">
          <button
            onClick={() => navigate(-1)}
            type="button"
            aria-label="뒤로가기"
            className="w-10 h-10 -ml-2 flex items-center justify-center rounded-full"
            style={{ color: '#FFFFFF' }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>
            기기 관리
          </h1>
        </div>

        {/* 기기 목록 */}
        <div className="space-y-4 mb-6">
          {devicesWithConnection.map((device) => (
            <div
              key={device.id}
              className="rounded-2xl p-4"
              style={{ backgroundColor: '#1A1A1A' }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#2A2A2A' }}>
                    <svg className="w-5 h-5" style={{ color: '#AAED10' }} fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold" style={{ color: '#FFFFFF' }}>{device.name}</span>
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: device.isConnected ? '#AAED10' : '#EF4444' }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/device/${device.id}`)}
                  type="button"
                  className="flex items-center gap-1"
                  style={{ color: device.isConnected ? '#AAED10' : '#EF4444', fontSize: '14px' }}
                >
                  {device.isConnected ? '연결됨' : '연결 안됨'}
                  <span className="w-4 h-4 rounded-full border flex items-center justify-center text-xs">i</span>
                </button>
              </div>
              <div className="text-sm mb-2" style={{ color: '#999999' }}>
                배터리 | {device.battery != null ? `${device.battery}%` : '측정 미지원'} &nbsp;&nbsp; 신호 | {device.signal || '측정 미지원'}
              </div>
              {/* BLE 진단 한 줄 — "연결됨 표시인데 점등이 안 들어옴" 같은 모호한
                  상태를 화면에서 즉시 식별할 수 있게 펌웨어 ready / 레거시 모드 /
                  누적 송신 횟수 / 마지막 송신 프레임을 노출한다. 트레이닝 화면의
                  진단 라인과 동일 정보 — 두 화면 어디서나 같은 단서로 추적 가능.
                  - FW=X → bleBridge 가 모든 write 를 silent skip → 점등 0건 원인 1순위.
                  - 송신=0 → 트레이닝 자체가 시작 안 됨 / 본 화면에서는 정상.
                  - 마지막 프레임 hex → 송신은 됐는데 본체가 안 깜빡이면 본체측 무시. */}
              {device.isConnected && (
                <div
                  className="text-[10px] font-mono mb-4"
                  style={{ color: '#666' }}
                  data-testid={`device-ble-diag-${device.id}`}
                >
                  BLE: FW={bleDiag.fwLabel} · L={bleDiag.legacyLabel} · 송신={bleDiag.emitted}
                  {bleDiag.lastFrame ? ` · ${bleDiag.lastFrame}` : ''}
                </div>
              )}
              {/* 테스트 점등 — 연결된 기기에만 노출. 트레이닝에 들어가지 않고도
                  점등 신호가 실제 기기에 도달해 LED 가 켜지는지 확인할 수 있다.
                  진단 라인의 송신 카운트가 +5 (START + Pod×4) 증가하지만 LED 가
                  안 켜지면 펌웨어/하드웨어 측 무응답으로 좁혀진다. */}
              {device.isConnected && (
                <button
                  type="button"
                  onClick={handleTestBlink}
                  disabled={testBlinkRunning}
                  className="mb-3 w-full py-2 rounded-xl text-sm font-semibold transition-opacity"
                  style={{
                    backgroundColor: '#0A0A0A',
                    border: '1px solid #AAED10',
                    color: '#AAED10',
                    opacity: testBlinkRunning ? 0.4 : 1,
                  }}
                >
                  {testBlinkRunning ? '테스트 점등 중…' : '테스트 점등 보내기 (Pod 1→4)'}
                </button>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => handleConnectAction(device)}
                  className="flex-1 py-2 rounded-lg text-sm font-semibold"
                  style={{
                    backgroundColor: device.isConnected ? '#2A2A2A' : '#AAED10',
                    color: device.isConnected ? '#FFFFFF' : '#000000',
                  }}
                >
                  {device.isConnected ? '연결 해제' : '연결 하기'}
                </button>
                <button
                  onClick={() => handleRemove(device)}
                  className="px-3 py-2 rounded-lg text-sm font-semibold"
                  style={{ backgroundColor: '#2A2A2A', color: '#EF4444' }}
                  title="등록 해제"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 기기 추가 버튼 */}
        <button
          onClick={() => navigate('/device/add')}
          className="w-full py-6 rounded-2xl flex items-center justify-center border-2 border-dashed"
          style={{ borderColor: '#333333', backgroundColor: '#1A1A1A', color: '#999999' }}
        >
          <span className="text-3xl mr-2">+</span>
          <span className="font-semibold">기기 추가</span>
        </button>

      </div>

      {/* 브릿지 거부(ack ok=false) 토스트 — 한국어 안내 + 디버그 키 (Task #77).
          Task #129: X 닫기 버튼을 노출하고 사용자 닫힘만 user-dismiss 로 흘린다.
          SuccessBanner 자체 duration 타이머는 banner-timeout 으로 분리 보고. */}
      <SuccessBanner
        isOpen={!!ackErrorBanner}
        message={ackErrorBanner ?? ''}
        backgroundColor="#3a1212"
        textColor="#fca5a5"
        duration={5000}
        showCloseButton
        onClose={() => {
          ackBannerSubRef.current?.notifyBannerTimeout();
          setAckErrorBanner(null);
        }}
        onUserClose={() => {
          ackBannerSubRef.current?.notifyDismissed();
          setAckErrorBanner(null);
        }}
      />
    </MobileLayout>
  );
}
