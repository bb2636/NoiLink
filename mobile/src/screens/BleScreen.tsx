/**
 * BLE 스모크 테스트 — 스캔·연결 + notify/write 예제 (연결된 기기 기준)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBle } from '../ble/ble.hooks';
import { bleManager } from '../ble/BleManager';
import { base64ToUint8Array, utf8StringToBase64 } from '../ble/bleEncoding';
import { colors } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'BleScreen'>;

const DEFAULT_FILTER = { nameContains: 'NoiPod' as const };

const PLACEHOLDER_SVC = '00000000-0000-0000-0000-000000000000';
const PLACEHOLDER_CHAR = '00000000-0000-0000-0000-000000000001';

export default function BleScreen({ navigation }: { navigation: Nav }) {
  const {
    devices,
    isScanning,
    connectedDevice,
    lastError,
    startScan,
    stopScan,
    connect,
    disconnect,
    clearDevices,
    clearError,
  } = useBle(DEFAULT_FILTER);

  const [serviceUUID, setServiceUUID] = useState(PLACEHOLDER_SVC);
  const [characteristicUUID, setCharacteristicUUID] = useState(PLACEHOLDER_CHAR);
  const [writeUtf8, setWriteUtf8] = useState('ping');
  const [lastNotifyBase64, setLastNotifyBase64] = useState<string | null>(null);
  const [lastNotifyHexPreview, setLastNotifyHexPreview] = useState<string | null>(null);
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [writeBusy, setWriteBusy] = useState(false);
  const notifySubRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    return () => {
      notifySubRef.current?.remove();
      notifySubRef.current = null;
    };
  }, []);

  const stopNotifyExample = useCallback(() => {
    notifySubRef.current?.remove();
    notifySubRef.current = null;
    setNotifyBusy(false);
    console.log('[BleScreen] notify stopped');
  }, []);

  const startNotifyExample = useCallback(() => {
    stopNotifyExample();
    if (!connectedDevice) {
      console.warn('[BleScreen] connect a device first');
      return;
    }
    setNotifyBusy(true);
    notifySubRef.current = bleManager.subscribeToCharacteristic(
      serviceUUID.trim(),
      characteristicUUID.trim(),
      (base64Value) => {
        setLastNotifyBase64(base64Value);
        try {
          const bytes = base64ToUint8Array(base64Value);
          const slice = bytes.slice(0, 24);
          setLastNotifyHexPreview(
            Array.from(slice)
              .map((b) => b.toString(16).padStart(2, '0'))
              .join(' ')
          );
        } catch {
          setLastNotifyHexPreview('(decode 실패)');
        }
      }
    );
    console.log('[BleScreen] notify started', serviceUUID, characteristicUUID);
  }, [connectedDevice, serviceUUID, characteristicUUID, stopNotifyExample]);

  const runWriteExample = useCallback(async () => {
    if (!connectedDevice) return;
    setWriteBusy(true);
    try {
      const b64 = utf8StringToBase64(writeUtf8);
      await bleManager.writeCharacteristic(
        serviceUUID.trim(),
        characteristicUUID.trim(),
        b64
      );
      console.log('[BleScreen] write ok (utf8→base64)');
    } catch (e) {
      console.error('[BleScreen] write failed', e);
    } finally {
      setWriteBusy(false);
    }
  }, [connectedDevice, serviceUUID, characteristicUUID, writeUtf8]);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.backRow}>
          <Text style={styles.back}>‹ 뒤로</Text>
        </Pressable>
        <Text style={styles.title}>BLE 테스트</Text>
        <Text style={styles.sub}>네이티브 레이어만 · notify/write 예제는 연결 후 사용</Text>

        <View style={styles.row}>
          <Pressable
            style={[styles.btn, styles.btnPrimary]}
            onPress={() => void startScan(undefined, { timeoutMs: 15000 })}
            disabled={isScanning}
          >
            {isScanning ? (
              <ActivityIndicator color={colors.accentText} />
            ) : (
              <Text style={styles.btnPrimaryText}>스캔</Text>
            )}
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={stopScan}>
            <Text style={styles.btnGhostText}>스캔 중지</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={clearDevices}>
            <Text style={styles.btnGhostText}>목록 비우기</Text>
          </Pressable>
        </View>

        {connectedDevice ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>연결됨</Text>
            <Text style={styles.mono}>{connectedDevice.name ?? '(이름 없음)'}</Text>
            <Text style={styles.monoSmall}>{connectedDevice.id}</Text>
            <Pressable style={[styles.btnWide, styles.danger]} onPress={() => void disconnect()}>
              <Text style={styles.btnDangerText}>연결 해제</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.muted}>연결된 기기 없음 — 목록에서 연결 후 notify/write를 시도하세요.</Text>
        )}

        <Text style={styles.section}>GATT 예제 (연결된 기기)</Text>
        <Text style={styles.label}>Service UUID</Text>
        <TextInput
          style={styles.input}
          value={serviceUUID}
          onChangeText={setServiceUUID}
          autoCapitalize="none"
          placeholder={PLACEHOLDER_SVC}
          placeholderTextColor={colors.textDim}
        />
        <Text style={styles.label}>Characteristic UUID</Text>
        <TextInput
          style={styles.input}
          value={characteristicUUID}
          onChangeText={setCharacteristicUUID}
          autoCapitalize="none"
          placeholder={PLACEHOLDER_CHAR}
          placeholderTextColor={colors.textDim}
        />
        <View style={styles.rowTight}>
          <Pressable
            style={[styles.btn, styles.btnPrimary, !connectedDevice && styles.disabled]}
            onPress={startNotifyExample}
            disabled={!connectedDevice || notifyBusy}
          >
            <Text style={styles.btnPrimaryText}>{notifyBusy ? 'Notify 켜짐' : 'Notify 시작'}</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={stopNotifyExample}>
            <Text style={styles.btnGhostText}>Notify 중지</Text>
          </Pressable>
        </View>
        <Text style={styles.label}>마지막 notify (base64)</Text>
        <Text style={styles.monoSmall} selectable>
          {lastNotifyBase64 ?? '—'}
        </Text>
        <Text style={styles.label}>디코드 미리보기 (hex, 앞 24바이트)</Text>
        <Text style={styles.monoSmall} selectable>
          {lastNotifyHexPreview ?? '—'}
        </Text>

        <Text style={styles.label}>Write 페이로드 (UTF-8 → 내부에서 base64 인코딩)</Text>
        <TextInput
          style={styles.input}
          value={writeUtf8}
          onChangeText={setWriteUtf8}
          placeholder="텍스트 입력"
          placeholderTextColor={colors.textDim}
        />
        <Pressable
          style={[styles.btnWide, styles.btnPrimary, (!connectedDevice || writeBusy) && styles.disabled]}
          onPress={() => void runWriteExample()}
          disabled={!connectedDevice || writeBusy}
        >
          {writeBusy ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Text style={styles.btnPrimaryText}>Write 보내기</Text>
          )}
        </Pressable>

        {lastError ? (
          <View style={styles.errBox}>
            <Text style={styles.err}>{lastError}</Text>
            <Pressable onPress={clearError}>
              <Text style={styles.errDismiss}>닫기</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.section}>주변 기기 ({devices.length})</Text>
        {devices.map((item) => (
          <View key={item.id} style={styles.deviceRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name ?? '(이름 없음)'}</Text>
              <Text style={styles.monoSmall}>{item.id}</Text>
              <Text style={styles.rssi}>RSSI {item.rssi ?? '—'}</Text>
            </View>
            <Pressable
              style={[styles.btnSmall, styles.btnPrimary]}
              onPress={() => void connect(item.id)}
              disabled={!!connectedDevice && connectedDevice.id === item.id}
            >
              <Text style={styles.btnPrimaryText}>연결</Text>
            </Pressable>
          </View>
        ))}
        {devices.length === 0 ? (
          <Text style={styles.muted}>{isScanning ? '검색 중…' : '스캔을 눌러 주변 기기를 찾습니다.'}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 48 },
  backRow: { marginBottom: 8 },
  back: { color: colors.textMuted, fontSize: 14 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12, color: colors.textDim, marginBottom: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  rowTight: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: { color: colors.accentText, fontWeight: '800' },
  btnGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.text, fontWeight: '600' },
  btnWide: { marginTop: 8, marginBottom: 16, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  disabled: { opacity: 0.45 },
  danger: { backgroundColor: '#3a2020', borderWidth: 1, borderColor: '#633' },
  btnDangerText: { color: '#f88', fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { fontSize: 12, color: colors.textMuted, marginBottom: 6 },
  mono: { color: colors.text, fontWeight: '700' },
  monoSmall: { color: colors.textDim, fontSize: 11, marginTop: 4 },
  muted: { color: colors.textDim, fontSize: 13, marginBottom: 12 },
  section: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 8, marginBottom: 8 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 13,
    backgroundColor: colors.surface,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  name: { color: colors.text, fontWeight: '600' },
  rssi: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  errBox: {
    backgroundColor: '#2a1818',
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  err: { color: '#f99', flex: 1, fontSize: 13 },
  errDismiss: { color: colors.accent, fontWeight: '700' },
});
