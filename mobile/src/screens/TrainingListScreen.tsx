import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme';
import { TRAINING_LIST } from '../training/trainingConfig';
import type { RootStackParamList } from '../navigation/types';
import { API_BASE_URL } from '../config';
import { useAuth } from '../context/AuthContext';

type Nav = NativeStackNavigationProp<RootStackParamList, 'TrainingList'>;

export default function TrainingListScreen({ navigation }: { navigation: Nav }) {
  const { isAuthenticated, displayName, logout, ready } = useAuth();
  const showApiHint = Boolean(API_BASE_URL);

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>트레이닝</Text>
          <Text style={styles.sub}>모드 선택</Text>
        </View>
        {ready && showApiHint ? (
          isAuthenticated ? (
            <View style={styles.authCol}>
              <Text style={styles.authName} numberOfLines={1}>
                {displayName || '로그인됨'}
              </Text>
              <Pressable onPress={() => void logout()} hitSlop={8}>
                <Text style={styles.authLink}>로그아웃</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.loginChip} onPress={() => navigation.navigate('Login')}>
              <Text style={styles.loginChipText}>로그인</Text>
            </Pressable>
          )
        ) : null}
      </View>
      <Pressable style={styles.bleLink} onPress={() => navigation.navigate('BleScreen')}>
        <Text style={styles.bleLinkText}>BLE 테스트 화면</Text>
      </Pressable>
      <FlatList
        data={TRAINING_LIST}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => navigation.navigate('TrainingSetup', { trainingId: item.id })}
          >
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardDesc}>{item.desc}</Text>
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
  topRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 8 },
  authCol: { alignItems: 'flex-end', maxWidth: 140 },
  authName: { fontSize: 11, color: colors.textMuted, marginBottom: 4 },
  authLink: { fontSize: 12, color: colors.accent, fontWeight: '700' },
  loginChip: {
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  loginChipText: { fontSize: 13, fontWeight: '800', color: colors.text },
  bleLink: { alignSelf: 'flex-start', marginBottom: 12, paddingVertical: 6 },
  bleLinkText: { fontSize: 12, color: colors.textMuted, fontWeight: '600', textDecorationLine: 'underline' },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  sub: {
    fontSize: 14,
    color: colors.textDim,
    marginBottom: 16,
  },
  list: { paddingBottom: 32, gap: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPressed: { opacity: 0.92 },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  cardDesc: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
  },
});
