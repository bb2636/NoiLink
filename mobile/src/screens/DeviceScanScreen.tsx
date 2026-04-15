import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Device } from 'react-native-ble-plx';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  connectDevice,
  requestBlePermissions,
  startScan,
  whenPoweredOn,
  getBleManager,
} from '../ble/noiPodBle';
import { useConnectedPod } from '../context/ConnectedPodContext';
import { colors } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'DeviceScan'>;

export default function DeviceScanScreen({ navigation }: { navigation: Nav }) {
  const { setPod } = useConnectedPod();
  const [devices, setDevices] = useState<Device[]>([]);
  const [status, setStatus] = useState<string>('초기화 중…');
  const [connectingId, setConnectingId] = useState<string | null>(null);

  useEffect(() => {
    let scan: { stop: () => void } | null = null;
    let cancelled = false;

    (async () => {
      try {
        const ok = await requestBlePermissions();
        if (!ok) {
          setStatus('블루투스 권한이 필요합니다.');
          return;
        }
        const ble = getBleManager();
        await whenPoweredOn(ble);
        if (cancelled) return;
        setStatus('주변 기기 검색 중…');
        const seen = new Set<string>();
        scan = startScan(
          (d) => {
            if (!seen.has(d.id)) {
              seen.add(d.id);
              setDevices((prev) => [...prev, d]);
            }
          },
          () => {}
        );
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'BLE 오류');
      }
    })();

    return () => {
      cancelled = true;
      scan?.stop();
    };
  }, []);

  const onConnect = async (device: Device) => {
    try {
      setConnectingId(device.id);
      await connectDevice(device.id);
      setPod({
        id: device.id,
        name: device.name ?? 'NoiPod',
      });
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
      <FlatList
        data={devices}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          !status.includes('검색') ? null : (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          )
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
  hint: { fontSize: 14, color: colors.textMuted, marginBottom: 16 },
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
