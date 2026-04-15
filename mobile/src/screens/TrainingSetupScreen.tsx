import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Level } from '@noilink/shared';
import { SESSION_MAX_MS, suggestNextSessionParams } from '@noilink/shared';
import { colors } from '../theme';
import { trainingById } from '../training/trainingConfig';
import { useConnectedPod } from '../context/ConnectedPodContext';
import type { RootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'TrainingSetup'>;
type Route = RouteProp<RootStackParamList, 'TrainingSetup'>;

const MAX_SEC = SESSION_MAX_MS / 1000;

export default function TrainingSetupScreen({
  navigation,
  route,
}: {
  navigation: Nav;
  route: Route;
}) {
  const { pod } = useConnectedPod();
  const { trainingId } = route.params;
  const info = trainingById[trainingId];

  const isComposite = trainingId === 'COMPOSITE';
  const isFree = trainingId === 'FREE';

  const [bpm, setBpm] = useState(100);
  const [level, setLevel] = useState<Level>(3);
  const [setCount, setSetCount] = useState<number | null>(isComposite ? 1 : null);
  const [setSeconds, setSetSeconds] = useState<number | null>(isComposite ? 300 : null);
  const [freeDurationSec, setFreeDurationSec] = useState<number | null>(isFree ? 120 : null);
  /** 직전 세션 점수(데모). 추후 세션 저장소에서 불러오면 됨. */
  const [previousScore] = useState(72);

  const suggestion = useMemo(
    () => suggestNextSessionParams({ previousScore, currentBpm: bpm, currentLevel: level }),
    [previousScore, bpm, level]
  );

  const totalDurationSec = useMemo(() => {
    if (isComposite) return Math.min(300, MAX_SEC);
    if (isFree) {
      if (freeDurationSec == null) return 0;
      return Math.min(freeDurationSec, MAX_SEC);
    }
    if (!setCount || !setSeconds) return 0;
    return Math.min(setCount * setSeconds, MAX_SEC);
  }, [isComposite, isFree, freeDurationSec, setCount, setSeconds]);

  const yieldsScore = !isFree;

  const canStart =
    pod &&
    totalDurationSec > 0 &&
    (isComposite || isFree || (setCount !== null && setSeconds !== null));

  const onStart = () => {
    if (!canStart || !pod) return;
    navigation.navigate('TrainingSession', {
      trainingId,
      totalDurationSec,
      bpm,
      level,
      yieldsScore,
    });
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{info.title}</Text>
      <Text style={styles.desc}>{info.desc}</Text>

      <Text style={styles.hint}>
        공통: 세션 상한 {MAX_SEC}초 · 혼합색 비율은 레벨(Lv1 0% ~ Lv5 35%)에 따름
      </Text>

      <Text style={styles.section}>Pod 연결</Text>
      <Pressable
        style={styles.podRow}
        onPress={() => navigation.navigate('DeviceScan')}
      >
        <Text style={styles.podName}>{pod?.name ?? 'NoiPod'}</Text>
        <Text style={[styles.podState, pod ? styles.podOn : styles.podOff]}>
          {pod ? '연결됨' : '연결 안 됨'} ›
        </Text>
      </Pressable>

      <Text style={styles.section}>BPM · 난이도 레벨 (1~5)</Text>
      <OptionRow label="BPM">
        {[80, 100, 120, 140].map((n) => (
          <Chip key={n} label={String(n)} selected={bpm === n} onPress={() => setBpm(n)} />
        ))}
      </OptionRow>
      <OptionRow label="레벨">
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <Chip key={n} label={`Lv${n}`} selected={level === n} onPress={() => setLevel(n)} />
        ))}
      </OptionRow>

      <View style={styles.suggestBox}>
        <Text style={styles.suggestTitle}>자동 난이도 제안 (직전 {previousScore}점 기준)</Text>
        <Text style={styles.suggestBody}>{suggestion.reason}</Text>
        <Text style={styles.suggestMeta}>
          → BPM {suggestion.suggestedBpm}, Lv{suggestion.suggestedLevel}
        </Text>
        <Pressable
          style={styles.suggestBtn}
          onPress={() => {
            setBpm(suggestion.suggestedBpm);
            setLevel(suggestion.suggestedLevel);
          }}
        >
          <Text style={styles.suggestBtnText}>제안 적용</Text>
        </Pressable>
      </View>

      {!isComposite && !isFree && (
        <>
          <Text style={styles.section}>세션 길이 (세트 × 시간, 상한 {MAX_SEC}초)</Text>
          <OptionRow label="세트 수">
            {[1, 3, 5].map((n) => (
              <Chip key={n} label={String(n)} selected={setCount === n} onPress={() => setSetCount(n)} />
            ))}
          </OptionRow>
          <OptionRow label="세트 시간">
            {[30, 45, 60].map((n) => (
              <Chip
                key={n}
                label={`${n}초`}
                selected={setSeconds === n}
                onPress={() => setSetSeconds(n)}
              />
            ))}
          </OptionRow>
        </>
      )}

      {isComposite && (
        <Text style={styles.fixedNote}>종합 모드: 총 300초 고정 (리듬·인지 페이즈 교차는 기기·서버에서 구동)</Text>
      )}

      {isFree && (
        <>
          <Text style={styles.section}>자유 연습 시간 (상한 {MAX_SEC}초)</Text>
          <OptionRow label="타이머">
            {[60, 120, 180, 300].map((n) => (
              <Chip
                key={n}
                label={`${n}초`}
                selected={freeDurationSec === n}
                onPress={() => setFreeDurationSec(n)}
              />
            ))}
          </OptionRow>
          <Text style={styles.meta}>점수는 산출하지 않으며 합계 시간·스트릭에만 반영합니다.</Text>
        </>
      )}

      <Text style={styles.meta}>
        진행 {totalDurationSec}초 · BPM {bpm} · Lv{level} · API {info.apiMode}
        {!yieldsScore ? ' · 점수 없음' : ''}
      </Text>

      <Pressable
        style={[styles.startBtn, !canStart && styles.startDisabled]}
        onPress={onStart}
        disabled={!canStart}
      >
        <Text style={[styles.startLabel, !canStart && styles.startLabelDisabled]}>시작하기</Text>
      </Pressable>
    </ScrollView>
  );
}

function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.optionRow}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View style={styles.optionChips}>{children}</View>
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected ? styles.chipOn : styles.chipOff]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 8 },
  desc: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: 8 },
  hint: {
    fontSize: 12,
    color: colors.textDim,
    lineHeight: 18,
    marginBottom: 20,
  },
  section: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    marginTop: 8,
  },
  podRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  podName: { color: colors.text, fontWeight: '600' },
  podState: { fontSize: 14, fontWeight: '600' },
  podOn: { color: colors.accent },
  podOff: { color: colors.textDim },
  optionRow: { marginBottom: 14 },
  optionLabel: { fontSize: 13, color: colors.textDim, marginBottom: 8 },
  optionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipOff: { backgroundColor: 'transparent' },
  chipText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: colors.accentText },
  suggestBox: {
    marginTop: 8,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggestTitle: { fontSize: 12, fontWeight: '700', color: colors.text, marginBottom: 4 },
  suggestBody: { fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  suggestMeta: { fontSize: 12, color: colors.accent, marginTop: 6, fontWeight: '600' },
  suggestBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  suggestBtnText: { color: colors.accentText, fontWeight: '700', fontSize: 13 },
  fixedNote: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 8,
  },
  meta: { fontSize: 12, color: colors.textDim, marginTop: 12, marginBottom: 20 },
  startBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 16,
    borderRadius: 24,
    alignItems: 'center',
  },
  startDisabled: { backgroundColor: colors.surface },
  startLabel: { fontSize: 16, fontWeight: '700', color: colors.accentText },
  startLabelDisabled: { color: colors.textDim },
});
