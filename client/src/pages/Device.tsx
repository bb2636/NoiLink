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
  bleSubscribeCharacteristic,
  bleUnsubscribeCharacteristic,
} from '../native/bleBridge';
import {
  COLOR_CODE,
  CTRL_START,
  CTRL_STOP,
  tryParseAnyNotifyBase64,
} from '@noilink/shared';
import { isNoiLinkNativeShell } from '../native/initNativeBridge';
import { subscribeAckErrorBanner, type AckBannerSubscription } from '../native/nativeAckErrors';
import { getLegacyBleMode, setLegacyBleMode, subscribeLegacyBleMode } from '../native/legacyBleMode';
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
  // 사용자 기기(NINA-B1-FB55CE) 펌웨어 사양은 3바이트 `4E XX 0D` (LED) /
  // `aa 55` (START) / `ff` (STOP) 이다. 차세대 NoiPod 0xa5 12바이트 사양은
  // 별도 펌웨어이며 기본값은 현행(레거시) 사양 ON 이다.
  const [legacyMode, setLegacyModeState] = useState<boolean>(getLegacyBleMode);
  useEffect(() => subscribeLegacyBleMode(setLegacyModeState), []);
  // 테스트 점등 진행 중 표시
  const [testBlinkRunning, setTestBlinkRunning] = useState(false);
  // 진단 로그 — 송신/ack 결과를 화면에 직접 노출 (토스트가 짧아 놓쳤을 때 대비)
  const [diagLog, setDiagLog] = useState<string[]>([]);

  const pushDiag = (line: string) => {
    const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    setDiagLog((prev) => [`[${ts}] ${line}`, ...prev].slice(0, 12));
  };

  // 모든 native.ack 를 listen 해서 진단 로그에 기록.
  // ok=true 도 기록해 "메시지가 native 까지 도달했고 BLE write 까지 끝났다" 는
  // 명확한 신호를 사용자가 화면에서 볼 수 있게 한다.
  useEffect(() => {
    const onAck = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id?: string; ok?: boolean; error?: string };
      if (!detail) return;
      if (detail.ok) {
        pushDiag(`✓ ack ok (${detail.id ?? '?'})`);
      } else {
        pushDiag(`✗ ack 거부: ${detail.error ?? '(사유 없음)'}`);
      }
    };
    window.addEventListener('noilink-native-ack', onAck);
    return () => window.removeEventListener('noilink-native-ack', onAck);
  }, []);

  /**
   * 진단용 notify 구독 — Device 화면에 머무는 동안 기기가 200ms 마다 보내는
   * 5바이트 IR 패킷, NFC NDEF Text Record, 차세대 TOUCH 프레임을 분류해서
   * 진단 로그에 표시한다. IR 패킷은 너무 자주 들어오므로 throttle:
   *   - touchCount 변화는 즉시 표시 (사용자 입력 검증용)
   *   - distanceMm 변화 표시는 1.5초당 최대 1회 (스팸 방지)
   * NFC/TOUCH 는 빈도 낮으므로 매번 표시.
   */
  const lastIrCountRef = useRef<number | null>(null);
  const lastIrDistanceLogTsRef = useRef<number>(0);
  useEffect(() => {
    if (!isNative) return;
    if (!connectedId) return;
    const subId = `device-diag-${Math.random().toString(36).slice(2, 10)}`;
    bleSubscribeCharacteristic(subId, 'notify');
    pushDiag('← notify 구독 시작 (진단)');
    const onBridge = (e: Event) => {
      const msg = (e as CustomEvent<NativeToWebMessage>).detail;
      if (!msg || msg.type !== 'ble.notify') return;
      // 트레이닝 화면 등 다른 곳의 구독 스트림이 진단 로그에 섞이지 않도록
      // 우리가 만든 subId / notify 채널만 통과시킨다.
      if (msg.payload?.subscriptionId !== subId) return;
      if (msg.payload?.key !== 'notify') return;
      const b64 = msg.payload?.base64Value;
      if (!b64) return;
      const ev = tryParseAnyNotifyBase64(b64);
      if (!ev) return;
      if (ev.type === 'IR') {
        const prevCount = lastIrCountRef.current;
        lastIrCountRef.current = ev.touchCount;
        // 카운트 변화 = 사용자 입력 발생 → 즉시 표시
        if (prevCount !== null && ev.touchCount !== prevCount) {
          pushDiag(`← 터치! count ${prevCount} → ${ev.touchCount} (IR ${ev.distanceMm}mm)`);
          return;
        }
        // distance 만 보고할 땐 throttle
        const now = Date.now();
        if (now - lastIrDistanceLogTsRef.current >= 1500) {
          lastIrDistanceLogTsRef.current = now;
          pushDiag(`← IR ${ev.distanceMm}mm count=${ev.touchCount}`);
        }
      } else if (ev.type === 'NFC_TEXT') {
        pushDiag(`← NFC "${ev.text}" (${ev.language || '?'})`);
      } else if (ev.type === 'TOUCH') {
        pushDiag(`← TOUCH pod=${ev.pod} ch=${ev.channel} Δ=${ev.deltaMs}ms`);
      }
    };
    window.addEventListener('noilink-native-bridge', onBridge as EventListener);
    return () => {
      window.removeEventListener('noilink-native-bridge', onBridge as EventListener);
      bleUnsubscribeCharacteristic(subId);
      lastIrCountRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNative, connectedId]);

  /**
   * 테스트 점등: 트레이닝 화면에 들어가지 않고도 점등 신호가 기기에 도달하는지
   * 즉시 검증하기 위한 진단 도구. START → Pod 1~4 순차 점등 → STOP 순으로
   * 보낸다. 레거시 모드 ON 이면 4eXX0d/aa55/ff 형식으로, OFF 이면 NoiPod
   * 정식 12바이트 프레임으로 전송된다 (`bleWriteLed`/`bleWriteControl` 분기 그대로).
   */
  const handleTestBlink = async () => {
    if (testBlinkRunning) return;
    setTestBlinkRunning(true);
    try {
      // 환경 진단 — native shell 이 아닌 일반 웹/캐시된 PWA 에서 누른 경우
      // 모든 BLE 메시지가 silent 하게 사라지므로 가장 먼저 알린다.
      if (!isNative) {
        pushDiag('환경: 일반 웹 (네이티브 셸 아님 — BLE 메시지 보낼 수 없음)');
        return;
      }
      const modeLabel = legacyMode
        ? '현행 펌웨어 (4E XX 0D / aa55 / ff)'
        : '차세대 NoiPod (0xA5 12바이트)';
      pushDiag(`환경: 네이티브 셸 / 모드: ${modeLabel}`);
      pushDiag(legacyMode ? '→ START 송신 (aa 55)' : '→ START 송신 (a5 03 00 …)');
      bleWriteControl(CTRL_START);
      // BLE GATT 큐가 이전 write 를 끝낼 시간을 충분히 준다. 너무 빠른 연속
      // write 는 react-native-ble-plx 에서 'operation was cancelled' 로 떨어진다.
      await new Promise((r) => setTimeout(r, 500));
      for (let pod = 0; pod < 4; pod++) {
        const hexHint = legacyMode
          ? `(4E ${(pod + 1).toString(16).padStart(2, '0')} 0D)`
          : '(a5 01 …)';
        pushDiag(`→ LED Pod${pod + 1} RED 송신 ${hexHint}`);
        bleWriteLed({
          tickId: pod + 1,
          pod,
          colorCode: COLOR_CODE.RED,
          onMs: 800,
        });
        await new Promise((r) => setTimeout(r, 1000));
      }
      pushDiag(legacyMode ? '→ STOP 송신 (ff)' : '→ STOP 송신 (a5 03 01 …)');
      bleWriteControl(CTRL_STOP);
    } finally {
      setTestBlinkRunning(false);
    }
  };

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
              <div className="text-sm mb-4" style={{ color: '#999999' }}>
                배터리 | {device.battery != null ? `${device.battery}%` : '-'} &nbsp;&nbsp; 신호 | {device.signal || '-'}
              </div>
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

        {/* BLE 점등 진단 + 펌웨어 모드 토글
            - 현행 펌웨어 (NINA-B1-FB55CE 등): 3바이트 `4E XX 0D` 송신
            - 차세대 펌웨어 (NoiPod 0xA5): 12바이트 NoiPod 프레임 송신
            기본값은 현행 펌웨어(레거시 모드 ON). 차세대 펌웨어를 시험할
            때만 토글을 OFF 로 둔다. */}
        <div
          className="mt-6 rounded-2xl p-4"
          style={{ backgroundColor: '#1A1A1A' }}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex-1">
              <div className="font-semibold" style={{ color: '#FFFFFF' }}>
                BLE 점등 진단
              </div>
              <div className="text-xs mt-1" style={{ color: '#999999' }}>
                {legacyMode
                  ? '현행 펌웨어 모드 — 3바이트 4E XX 0D 로 송신합니다.'
                  : '차세대 NoiPod 모드 — 0xA5 12바이트 프레임으로 송신합니다.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={legacyMode}
              onClick={() => setLegacyBleMode(!legacyMode)}
              className="relative w-12 h-7 rounded-full transition-colors flex-shrink-0"
              style={{ backgroundColor: legacyMode ? '#AAED10' : '#333333' }}
              title="ON: 현행 펌웨어 / OFF: 차세대 NoiPod"
            >
              <span
                className="absolute top-0.5 w-6 h-6 rounded-full bg-white transition-transform"
                style={{ transform: legacyMode ? 'translateX(22px)' : 'translateX(2px)' }}
              />
            </button>
          </div>
          <button
            type="button"
            onClick={handleTestBlink}
            disabled={testBlinkRunning || !connectedId}
            className="mt-3 w-full py-2 rounded-xl text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: '#0A0A0A',
              border: '1px solid #AAED10',
              color: '#AAED10',
              opacity: testBlinkRunning || !connectedId ? 0.4 : 1,
            }}
          >
            {testBlinkRunning
              ? '테스트 점등 중…'
              : connectedId
              ? '테스트 점등 보내기 (Pod 1→4)'
              : '연결된 기기가 없어요'}
          </button>

          {/* 진단 로그 — 송신/ack 결과를 화면에 직접 누적 표시. 토스트가
              짧아 놓쳤거나 native ack 가 ok=true 인 경우에도 무엇이 일어났는지
              확인할 수 있다. 행이 없으면 패널 자체를 숨긴다. */}
          {diagLog.length > 0 && (
            <div className="mt-3 p-2 rounded-lg" style={{ backgroundColor: '#0A0A0A' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px]" style={{ color: '#999999' }}>
                  진단 로그 (최근 12건)
                </span>
                <button
                  type="button"
                  onClick={() => setDiagLog([])}
                  className="text-[10px]"
                  style={{ color: '#666666' }}
                >
                  지우기
                </button>
              </div>
              <pre
                className="text-[10px] whitespace-pre-wrap break-words leading-relaxed"
                style={{ color: '#CCCCCC', fontFamily: 'monospace', maxHeight: 180, overflowY: 'auto' }}
              >
                {diagLog.join('\n')}
              </pre>
            </div>
          )}
        </div>
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
