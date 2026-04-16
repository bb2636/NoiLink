import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SESSION_MAX_MS } from '@noilink/shared';
import { colors } from '../theme';
import { trainingById } from '../training/trainingConfig';
import type { RootStackParamList } from '../navigation/types';
import { bleManager } from '../ble/BleManager';
import { useConnectedPod } from '../context/ConnectedPodContext';
import { submitTrainingToServer } from '../api/trainingSubmit';
import { getStoredToken, resolveTrainingUserId } from '../auth/storage';

type Nav = NativeStackNavigationProp<RootStackParamList, 'TrainingSession'>;
type Route = RouteProp<RootStackParamList, 'TrainingSession'>;

export default function TrainingSessionScreen({
  navigation,
  route,
}: {
  navigation: Nav;
  route: Route;
}) {
  const { pod } = useConnectedPod();
  const { trainingId, totalDurationSec, bpm, level, yieldsScore } = route.params;
  const info = trainingById[trainingId];
  const isComposite = trainingId === 'COMPOSITE' || info.apiMode === 'COMPOSITE';

  const capSec = Math.min(totalDurationSec, SESSION_MAX_MS / 1000);
  const [remaining, setRemaining] = useState(capSec);
  const [paused, setPaused] = useState(false);
  const [reactionCount, setReactionCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const subRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!pod) return;
      try {
        await bleManager.connect(pod.id);
        if (!mounted) return;
        subRef.current = bleManager.subscribeToCharacteristic(
          '00000000-0000-0000-0000-000000000000',
          '00000000-0000-0000-0000-000000000001',
          (_base64) => {
            setReactionCount((c) => c + 1);
          }
        );
      } catch {
        /* 연결 실패 시에도 타이머 뼈대는 동작 */
      }
    })();
    return () => {
      mounted = false;
      subRef.current?.remove();
    };
  }, [pod]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [paused]);

  const finishedRef = useRef(false);
  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    subRef.current?.remove();

    const token = await getStoredToken();
    const uid = await resolveTrainingUserId();
    let sessionId: string | undefined;
    let displayScore: number | undefined;
    let syncNote: string | undefined;

    if (token && uid) {
      setSyncing(true);
      const r = await submitTrainingToServer({
        userId: uid,
        mode: info.apiMode,
        bpm,
        level,
        totalDurationSec: capSec,
        yieldsScore,
        isComposite,
        tapCount: reactionCount,
      });
      setSyncing(false);
      sessionId = r.sessionId || undefined;
      displayScore = r.displayScore;
      syncNote = r.error;
    }

    if (!yieldsScore) {
      navigation.replace('TrainingResult', {
        trainingTitle: info.title,
        noScore: true,
        sessionId,
        syncNote,
      });
      return;
    }
    const fallback = Math.min(100, 50 + reactionCount * 2);
    navigation.replace('TrainingResult', {
      score: displayScore ?? fallback,
      trainingTitle: info.title,
      deltaFromPrevious: 12,
      sessionId,
      syncNote,
    });
  }, [navigation, info.title, info.apiMode, reactionCount, yieldsScore, capSec, bpm, level, isComposite]);

  useEffect(() => {
    if (remaining === 0) {
      void finish();
    }
  }, [remaining, finish]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>트레이닝 진행</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>BPM {bpm}</Text>
        <Text style={styles.metaText}>Lv {level}</Text>
        <Text style={styles.metaText}>반응 {reactionCount}</Text>
      </View>

      <View style={styles.circle}>
        <Text style={styles.secHint}>{remaining}초 남음 (상한 {SESSION_MAX_MS / 1000}s)</Text>
        <Text style={styles.timer}>
          {mm}:{ss}
        </Text>
        {syncing && <Text style={styles.sync}>서버 동기화…</Text>}
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.btnCancel} onPress={() => navigation.goBack()}>
          <Text style={styles.btnCancelText}>취소</Text>
        </Pressable>
        <Pressable style={styles.btnPause} onPress={() => setPaused((p) => !p)}>
          <Text style={styles.btnPauseText}>{paused ? '재개' : '일시정지'}</Text>
        </Pressable>
      </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  back: { fontSize: 28, color: colors.text, fontWeight: '300' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 20,
  },
  metaText: { fontSize: 14, color: colors.textMuted, fontWeight: '600' },
  circle: {
    alignSelf: 'center',
    width: 260,
    minHeight: 200,
    borderRadius: 130,
    borderWidth: 3,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    paddingVertical: 24,
  },
  secHint: { fontSize: 13, color: colors.textDim, marginBottom: 8 },
  timer: { fontSize: 44, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  sync: { fontSize: 12, color: colors.accent, marginTop: 8 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 'auto',
    paddingBottom: 40,
  },
  btnCancel: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  btnCancelText: { color: colors.textMuted, fontWeight: '700' },
  btnPause: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 20,
    backgroundColor: colors.accent,
  },
  btnPauseText: { color: colors.accentText, fontWeight: '800' },
});
