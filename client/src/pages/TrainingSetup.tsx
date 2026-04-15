/**
 * 트레이닝 설정 화면
 * 상단 이미지, Pod 연결, 진행 회원, 세트 수/시간, BPM·레벨, 시작하기
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import { STORAGE_KEYS } from '../utils/constants';
import { TRAINING_BY_ID } from '../utils/trainingConfig';
import MemberSelectModal from '../components/MemberSelectModal/MemberSelectModal';
import type { User, Level, TrainingMode } from '@noilink/shared';
import { SESSION_MAX_MS, suggestNextSessionParams } from '@noilink/shared';
import type { TrainingRunState } from './TrainingSessionPlay';

export default function TrainingSetup() {
  const navigate = useNavigate();
  const { mode } = useParams<{ mode: string }>();
  const { user } = useAuth();
  const [connectedDevice, setConnectedDevice] = useState<{ id: string; name: string; deviceId: string } | null>(null);
  const [selectedMember, setSelectedMember] = useState<User | null>(user ?? null);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [setCount, setSetCount] = useState<number | null>(null);
  const [setTime, setSetTime] = useState<number | null>(null);
  const [bpm, setBpm] = useState(100);
  const [level, setLevel] = useState<Level>(3);
  const [freeDurationSec, setFreeDurationSec] = useState<number | null>(null);
  const [previousScore] = useState(72);

  const info = mode ? TRAINING_BY_ID[mode] : null;
  const title = info?.title ?? '트레이닝';
  const isComposite = mode === 'COMPOSITE' || mode === 'TAU';
  const isFree = mode === 'FREE';
  const maxSec = SESSION_MAX_MS / 1000;

  const totalDurationSec = useMemo(() => {
    if (isComposite) return Math.min(300, maxSec);
    if (isFree) {
      if (freeDurationSec == null) return 0;
      return Math.min(freeDurationSec, maxSec);
    }
    if (setCount === null || setTime === null) return 0;
    return Math.min(setCount * setTime, maxSec);
  }, [isComposite, isFree, freeDurationSec, setCount, setTime, maxSec]);

  const suggestion = useMemo(
    () => suggestNextSessionParams({ previousScore, currentBpm: bpm, currentLevel: level }),
    [previousScore, bpm, level]
  );

  useEffect(() => {
    if (user) setSelectedMember(user);
  }, [user]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CONNECTED_DEVICE);
      if (raw) {
        const data = JSON.parse(raw);
        setConnectedDevice({ id: data.id, name: data.name || 'NoiPod', deviceId: data.deviceId || '' });
      } else {
        setConnectedDevice(null);
      }
    } catch {
      setConnectedDevice(null);
    }
  }, []);

  const isStartEnabled =
    !!connectedDevice &&
    !!selectedMember &&
    totalDurationSec > 0 &&
    (isComposite || isFree ? (isFree ? freeDurationSec !== null : true) : setCount !== null && setTime !== null);

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 py-6" style={{ paddingBottom: '120px' }}>
        {/* 헤더 */}
        <div className="mb-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/training')}
            className="flex items-center"
            style={{ color: '#FFFFFF' }}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>
            {title}
          </h1>
        </div>

        {/* 트레이닝 대표 이미지 */}
        {info?.image && (
          <div
            className="w-full aspect-[16/10] rounded-2xl mb-4 bg-cover bg-center overflow-hidden"
            style={{
              backgroundImage: `url(${info.image})`,
              backgroundColor: '#2A2A2A',
            }}
          />
        )}

        {/* 제목 + 설명 */}
        {info && (
          <div className="mb-6">
            <h2 className="text-xl font-bold mb-2" style={{ color: '#FFFFFF' }}>
              {info.title}
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: '#B6B6B9' }}>
              {info.desc}
            </p>
          </div>
        )}

        <p className="text-xs leading-relaxed mb-4 px-1" style={{ color: '#888888' }}>
          공통 정책: 세션 최대 {maxSec}초 · 리듬/인지 페이즈 · Lv1~5 혼합색 0%~35% · 직전 성과에 따른 BPM/레벨
          자동 제안(시작 전 수정 가능)
        </p>

        {/* Pod 연결 */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold mb-2" style={{ color: '#FFFFFF' }}>
            Pod 연결
          </h2>
          <button
            onClick={() => navigate('/device')}
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl"
            style={{ backgroundColor: '#1A1A1A' }}
          >
            <div className="flex items-center gap-3">
              <svg
                className="w-6 h-6"
                style={{ color: connectedDevice ? '#AAED10' : '#999999' }}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29z" />
              </svg>
              <span style={{ color: '#FFFFFF' }}>NoiPod</span>
            </div>
            <span
              className="text-sm font-medium"
              style={{ color: connectedDevice ? '#AAED10' : '#999999' }}
            >
              {connectedDevice ? '연결됨' : '연결 안 됨'} &gt;
            </span>
          </button>
        </div>

        {/* 진행 회원 */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold mb-2" style={{ color: '#FFFFFF' }}>
            진행 회원
          </h2>
          <div className="flex items-center gap-2">
            <button
              className="px-4 py-2 rounded-full text-sm font-semibold"
              style={{
                backgroundColor: selectedMember ? '#AAED10' : '#333333',
                color: selectedMember ? '#000000' : '#999999',
              }}
            >
              {selectedMember?.name || '선택'}
            </button>
            <button
              onClick={() => setShowMemberModal(true)}
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
              style={{ backgroundColor: '#333333', color: '#999999' }}
            >
              +
            </button>
          </div>
        </div>

        {/* 트레이닝 설정 */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold mb-4" style={{ color: '#FFFFFF' }}>
            트레이닝 설정
          </h2>
          <div className="space-y-4">
            <OptionRow label="BPM">
              {[80, 100, 120, 140].map((n) => (
                <OptionBtn
                  key={n}
                  label={String(n)}
                  selected={bpm === n}
                  onClick={() => setBpm(n)}
                />
              ))}
            </OptionRow>
            <OptionRow label="레벨 (1~5)">
              {([1, 2, 3, 4, 5] as const).map((n) => (
                <OptionBtn
                  key={n}
                  label={`Lv${n}`}
                  selected={level === n}
                  onClick={() => setLevel(n)}
                />
              ))}
            </OptionRow>
            <div
              className="rounded-xl p-3 text-xs mb-2"
              style={{ backgroundColor: '#1A1A1A', color: '#B0B0B0' }}
            >
              <div className="font-semibold mb-1" style={{ color: '#FFFFFF' }}>
                자동 난이도 제안 (직전 {previousScore}점)
              </div>
              <p className="mb-2">{suggestion.reason}</p>
              <p style={{ color: '#AAED10' }}>
                → BPM {suggestion.suggestedBpm}, Lv{suggestion.suggestedLevel}
              </p>
              <button
                type="button"
                className="mt-2 px-3 py-1 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: '#AAED10', color: '#000000' }}
                onClick={() => {
                  setBpm(suggestion.suggestedBpm);
                  setLevel(suggestion.suggestedLevel);
                }}
              >
                제안 적용
              </button>
            </div>
            {isComposite && (
              <p className="text-sm" style={{ color: '#999999' }}>
                종합 트레이닝: 총 {totalDurationSec}초 고정 — RHYTHM 30초 ↔ COGNITIVE 30초 교차(기기·서버 시퀀스).
              </p>
            )}
            {!isComposite && !isFree && (
              <>
                <OptionRow label="세트 수">
                  {[1, 3, 5].map((n) => (
                    <OptionBtn
                      key={n}
                      label={String(n)}
                      selected={setCount === n}
                      onClick={() => setSetCount(n)}
                    />
                  ))}
                </OptionRow>
                <OptionRow label="세트 시간">
                  {[30, 45, 60].map((n) => (
                    <OptionBtn
                      key={n}
                      label={`${n}초`}
                      selected={setTime === n}
                      onClick={() => setSetTime(n)}
                    />
                  ))}
                </OptionRow>
              </>
            )}
            {isFree && (
              <>
                <OptionRow label="자유 연습 시간">
                  {[60, 120, 180, 300].map((n) => (
                    <OptionBtn
                      key={n}
                      label={`${n}초`}
                      selected={freeDurationSec === n}
                      onClick={() => setFreeDurationSec(n)}
                    />
                  ))}
                </OptionRow>
                <p className="text-xs" style={{ color: '#888888' }}>
                  점수 미산출 · 합계 시간·스트릭에만 반영
                </p>
              </>
            )}
            {!isComposite && !isFree && (
              <p className="text-xs" style={{ color: '#777777' }}>
                예상 총 시간: {totalDurationSec}초 (상한 {maxSec}초) · BPM {bpm} · Lv{level}
              </p>
            )}
          </div>
        </div>

        {/* 시작하기 버튼 */}
        <button
          onClick={() => {
            if (!isStartEnabled || !selectedMember || !info || !mode) return;
            const run: TrainingRunState = {
              catalogId: mode,
              apiMode: info.apiMode as TrainingMode,
              userId: selectedMember.id,
              title: info.title,
              totalDurationSec,
              bpm,
              level,
              yieldsScore: !isFree,
              isComposite: isComposite || info.apiMode === 'COMPOSITE',
            };
            navigate('/training/session', { state: run });
          }}
          disabled={!isStartEnabled}
          className="w-full py-4 rounded-3xl font-semibold transition-all"
          style={{
            backgroundColor: isStartEnabled ? '#AAED10' : '#1A1A1A',
            color: isStartEnabled ? '#000000' : '#B6B6B9',
          }}
        >
          시작하기
        </button>
      </div>

      <MemberSelectModal
        isOpen={showMemberModal}
        onClose={() => setShowMemberModal(false)}
        onSelect={setSelectedMember}
        currentUser={user}
      />
    </MobileLayout>
  );
}

function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm flex-shrink-0" style={{ color: '#999999' }}>
        {label}
      </span>
      <div className="flex gap-2 justify-end flex-wrap">{children}</div>
    </div>
  );
}

function OptionBtn({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
      style={{
        backgroundColor: selected ? '#FFFFFF' : 'transparent',
        color: selected ? '#000000' : '#FFFFFF',
        border: selected ? 'none' : '1px solid rgba(255,255,255,0.5)',
      }}
    >
      {label}
    </button>
  );
}
