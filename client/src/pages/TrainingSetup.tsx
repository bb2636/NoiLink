/**
 * 트레이닝 설정 화면
 * 상단 이미지, Pod 연결, 진행 회원, 세트 수/시간/난이도, 시작하기
 */
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import { STORAGE_KEYS } from '../utils/constants';
import { TRAINING_LIST } from '../utils/trainingConfig';
import MemberSelectModal from '../components/MemberSelectModal/MemberSelectModal';
import type { User } from '@noilink/shared';

const TRAINING_BY_ID = Object.fromEntries(TRAINING_LIST.map((t) => [t.id, t]));

export default function TrainingSetup() {
  const navigate = useNavigate();
  const { mode } = useParams<{ mode: string }>();
  const { user } = useAuth();
  const [connectedDevice, setConnectedDevice] = useState<{ id: string; name: string; deviceId: string } | null>(null);
  const [selectedMember, setSelectedMember] = useState<User | null>(user ?? null);
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [setCount, setSetCount] = useState<number | null>(null);
  const [setTime, setSetTime] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<string | null>(null);

  const info = mode ? TRAINING_BY_ID[mode] : null;
  const title = info?.title ?? '트레이닝';

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
    !!connectedDevice && !!selectedMember && setCount !== null && setTime !== null && difficulty !== null;

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
            <OptionRow label="난이도">
              {['쉬움', '보통', '어려움'].map((d) => (
                <OptionBtn
                  key={d}
                  label={d}
                  selected={difficulty === d}
                  onClick={() => setDifficulty(d)}
                />
              ))}
            </OptionRow>
          </div>
        </div>

        {/* 시작하기 버튼 */}
        <button
          onClick={() => isStartEnabled && navigate('/training')}
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
