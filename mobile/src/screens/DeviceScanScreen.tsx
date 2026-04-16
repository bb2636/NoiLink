/**
 * 트레이닝 플로우용 NoiPod 스캔·연결 — BLE는 useBle / bleManager 만 사용
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBle } from '../ble/ble.hooks';
import { useConnectedPod } from '../context/ConnectedPodContext';
import { colors } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import type { BleDiscoveryDevice } from '../ble/ble.types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'DeviceScan'>;

const SCAN_FILTER = { nameContains: 'NoiPod' as const };

export default function DeviceScanScreen({ navigation }: { navigation: Nav }) {
  const { setPod } = useConnectedPod();
  const { devices, isScanning, startScan, stopScan, connect, clearDevices } = useBle(SCAN_FILTER);
  const [status, setStatus] = useState<string>('준비 중…');
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const kickScan = useCallback(async () => {
    try {
      setStatus('주변 기기 검색 중…');
      await startScan(SCAN_FILTER, { timeoutMs: 20000 });
      setStatus('기기를 선택해 연결하세요');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'BLE 오류');
    }
  }, [startScan]);

  useEffect(() => {
    void kickScan();
    return () => {
      stopScan();
    };
  }, [kickScan, stopScan]);

  const onConnect = async (device: BleDiscoveryDevice) => {
    try {
      setConnectingId(device.id);
      await connect(device.id);
      setPod({
        id: device.id,
        name: device.name ?? 'NoiPod',
      });
      stopScan();
      navigation.goBack();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : '연결 실패');
    } finally {
      setConnectingId(null);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>NoiPod 연결</Text>
      <Text style={styles.hint}>{status}</Text>
      <View style={styles.actions}>
        <Pressable style={styles.smallBtn} onPress={() => void kickScan()} disabled={isScanning}>
          <Text style={styles.smallBtnText}>{isScanning ? '스캔 중…' : '다시 스캔'}</Text>
        </Pressable>
        <Pressable style={styles.smallBtnGhost} onPress={stopScan}>
          <Text style={styles.smallBtnGhostText}>스캔 중지</Text>
        </Pressable>
        <Pressable style={styles.smallBtnGhost} onPress={clearDevices}>
          <Text style={styles.smallBtnGhostText}>목록 비우기</Text>
        </Pressable>
      </View>
      <FlatList
        data={devices}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          isScanning ? <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} /> : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            onPress={() => onConnect(item)}
            disabled={connectingId !== null}
          >
            <Text style={styles.name}>{item.name ?? '(이름 없음)'}</Text>
            <Text style={styles.id}>{item.id}</Text>
            {connectingId === item.id ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.link}>연결</Text>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 8 },
  hint: { fontSize: 14, color: colors.textMuted, marginBottom: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  smallBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  smallBtnText: { color: colors.accentText, fontWeight: '700', fontSize: 12 },
  smallBtnGhost: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  smallBtnGhostText: { color: colors.textMuted, fontWeight: '600', fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  rowPressed: { opacity: 0.9 },
  name: { flex: 1, color: colors.text, fontWeight: '600' },
  id: { flex: 1, color: colors.textDim, fontSize: 11 },
  link: { color: colors.accent, fontWeight: '700' },
});
