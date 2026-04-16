/**
 * BLE 훅 — UI는 useBle()만 사용하고 Plx/BleManager 직접 호출하지 않음
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Device } from 'react-native-ble-plx';
import { bleManager } from './BleManager';
import type { BleDiscoveryDevice, BleScanFilter, BleScanOptions } from './ble.types';

export interface UseBleResult {
  devices: BleDiscoveryDevice[];
  isScanning: boolean;
  connectedDevice: BleDiscoveryDevice | null;
  lastError: string | null;
  startScan: (filterOverride?: BleScanFilter, options?: BleScanOptions) => Promise<void>;
  stopScan: () => void;
  connect: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  clearDevices: () => void;
  clearError: () => void;
}

/**
 * @param defaultFilter 스캔 시 기본 필터(이름·서비스 UUID 플레이스홀더). startScan()에 다른 필터를 넘기면 덮어씀
 */
export function useBle(defaultFilter?: BleScanFilter): UseBleResult {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [devices, setDevices] = useState<BleDiscoveryDevice[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const scanStopRef = useRef<(() => void) | null>(null);
  const defaultFilterRef = useRef(defaultFilter);
  defaultFilterRef.current = defaultFilter;

  useEffect(() => {
    return bleManager.subscribe(() => bump());
  }, []);

  const clearDevices = useCallback(() => {
    setDevices([]);
    console.log('[useBle] devices cleared');
  }, []);

  const clearError = useCallback(() => setLastError(null), []);

  const stopScan = useCallback(() => {
    scanStopRef.current?.();
    scanStopRef.current = null;
    bleManager.stopScan();
    console.log('[useBle] stopScan');
  }, []);

  const startScan = useCallback(
    async (filterOverride?: BleScanFilter, options?: BleScanOptions) => {
      setLastError(null);
      const filter = filterOverride ?? defaultFilterRef.current;
      try {
        await bleManager.ensureReady();
        setDevices([]);
        stopScan();

        const { stop } = bleManager.startDeviceScan(
          filter,
          (device: Device) => {
            const snap = bleManager.toDiscoverySnapshot(device);
            setDevices((prev) => {
              const map = new Map(prev.map((d) => [d.id, d]));
              const prevRow = map.get(snap.id);
              map.set(snap.id, {
                id: snap.id,
                name: snap.name ?? prevRow?.name ?? null,
                rssi: snap.rssi ?? prevRow?.rssi ?? null,
                lastSeenAt: Date.now(),
              });
              return Array.from(map.values());
            });
          },
          options ?? { timeoutMs: 15000 }
        );

        scanStopRef.current = stop;
        console.log('[useBle] scan started', { filter, options });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[useBle] startScan failed', msg);
        setLastError(msg);
      }
    },
    [stopScan]
  );

  const connect = useCallback(async (deviceId: string) => {
    setLastError(null);
    try {
      await bleManager.connect(deviceId);
      console.log('[useBle] connect ok', deviceId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[useBle] connect failed', msg);
      setLastError(msg);
      throw e;
    }
  }, []);

  const disconnect = useCallback(async () => {
    setLastError(null);
    try {
      await bleManager.disconnect();
      console.log('[useBle] disconnect ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[useBle] disconnect failed', msg);
      setLastError(msg);
    }
  }, []);

  useEffect(() => {
    return () => {
      scanStopRef.current?.();
      scanStopRef.current = null;
    };
  }, []);

  return {
    devices,
    isScanning: bleManager.isScanning(),
    connectedDevice: bleManager.getConnectedSummary(),
    lastError,
    startScan,
    stopScan,
    connect,
    disconnect,
    clearDevices,
    clearError,
  };
}
