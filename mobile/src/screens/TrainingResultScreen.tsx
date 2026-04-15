import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'TrainingResult'>;
type Route = RouteProp<RootStackParamList, 'TrainingResult'>;

export default function TrainingResultScreen({
  navigation,
  route,
}: {
  navigation: Nav;
  route: Route;
}) {
  const { score, trainingTitle, deltaFromPrevious, noScore, sessionId, syncNote } = route.params;

  return (
    <View style={styles.root}>
      <Text style={styles.greet}>수고했어요 👏</Text>
      <Text style={styles.sub}>{trainingTitle}</Text>

      {sessionId ? (
        <Text style={styles.sessionId}>세션: {sessionId}</Text>
      ) : null}
      {syncNote ? (
        <Text style={styles.warn}>동기화: {syncNote}</Text>
      ) : null}

      {noScore ? (
        <View style={styles.freeBox}>
          <Text style={styles.freeTitle}>자유 트레이닝</Text>
          <Text style={styles.freeBody}>
            점수는 산출되지 않습니다. 합계 시간·스트릭은 기록에만 반영됩니다.
          </Text>
        </View>
      ) : (
        <View style={styles.ring}>
          <Text style={styles.score}>{score ?? '—'}</Text>
          {deltaFromPrevious != null && (
            <Text style={styles.delta}>+{deltaFromPrevious}점 향상</Text>
          )}
        </View>
      )}

      {!noScore && (
        <Text style={styles.note}>
          점수는 서버 지표 평균 또는 로컬 추정값입니다. 리포트는 종합 세션 3회 이상 쌓이면 생성됩니다.
        </Text>
      )}

      <Pressable style={styles.done} onPress={() => navigation.popToTop()}>
        <Text style={styles.doneText}>완료</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  greet: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 4 },
  sub: { fontSize: 15, color: colors.textMuted, marginBottom: 8 },
  sessionId: { fontSize: 11, color: colors.textDim, marginBottom: 4 },
  warn: { fontSize: 12, color: '#fbbf24', marginBottom: 12 },
  freeBox: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 24,
  },
  freeTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 8 },
  freeBody: { fontSize: 14, color: colors.textMuted, lineHeight: 22 },
  ring: {
    alignSelf: 'center',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 6,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  score: { fontSize: 56, fontWeight: '800', color: colors.text },
  delta: { fontSize: 14, color: colors.accent, fontWeight: '600', marginTop: 4 },
  note: { fontSize: 13, color: colors.textDim, lineHeight: 20, textAlign: 'center' },
  done: {
    marginTop: 'auto',
    marginBottom: 40,
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: 24,
    alignItems: 'center',
  },
  doneText: { fontSize: 16, fontWeight: '800', color: colors.accentText },
});
