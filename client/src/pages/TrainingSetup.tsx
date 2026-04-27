/**
 * 트레이닝 설정 화면 (이미지 2/3 디자인)
 *
 * 분기:
 *  - 기업 회원 (userType === 'ORGANIZATION'): 진행 회원 + 색상 섹션 노출
 *  - 개인 회원: 두 섹션 숨김
 *
 * Pod 연결:
 *  - 등록된 기기 최대 8개 표시 (4×2 그리드)
 *  - 사용자가 최대 4개까지 선택해 사용 가능
 *  - 선택된 pod은 라임 그린 테두리 + 토글 ON, LED ON (BLE write — 추후 연동)
 *
 * BPM:
 *  - 큰 원형 다이얼로 표시
 *  - per-user 값 (pod별 아님)
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MobileLayout } from '../components/Layout';
import { useAuth } from '../hooks/useAuth';
import { STORAGE_KEYS } from '../utils/constants';
import { TRAINING_BY_ID } from '../utils/trainingConfig';
import { ensureDemoDevicesSeeded } from '../utils/seedDemoDevices';
import MemberSelectModal from '../components/MemberSelectModal/MemberSelectModal';
import type { User, Level, TrainingMode } from '@noilink/shared';
import { SESSION_MAX_MS } from '@noilink/shared';
import type { TrainingRunState } from './TrainingSessionPlay';

const MAX_PODS_PER_USER = 4;
const TOTAL_POD_SLOTS = 8;

interface RegisteredDevice {
  id: string;
  name: string;
  deviceId: string;
  registeredAt: string;
}

const COLOR_OPTIONS = [
  { id: 'red',    color: '#E84545' },
  { id: 'green',  color: '#7FE65B' },
  { id: 'yellow', color: '#F1C232' },
  { id: 'blue',   color: '#3D6BFF' },
] as const;

export default function TrainingSetup() {
  const navigate = useNavigate();
  const { mode } = useParams<{ mode: string }>();
  const { user } = useAuth();

  const isEnterprise = user?.userType === 'ORGANIZATION';
  // 기업 소속(관리자 또는 승인된 개인 회원) — 진행 회원/색상 섹션 노출
  const hasOrganization = !!user?.organizationId;
  const info = mode ? TRAINING_BY_ID[mode] : null;
  const title = info?.title ?? '트레이닝';
  const isFree = mode === 'FREE';
  const isComposite = mode === 'COMPOSITE' || mode === 'TAU';

  // ─── 진행 회원 ───────────────────────────────────────────────
  // 다중 선택 지원 (기업 회원). 본인 + 추가로 같은 조직 멤버를 함께 진행 가능.
  // 개인 회원은 항상 [user] 한 명. 시작 시 첫 번째 멤버가 결과 저장의 1차 사용자.
  const [selectedMembers, setSelectedMembers] = useState<User[]>(user ? [user] : []);
  const [showMemberModal, setShowMemberModal] = useState(false);
  useEffect(() => {
    // 로그인 사용자가 바뀌면(혹은 처음 로드되면) 본인을 기본 선택으로 초기화
    if (user) setSelectedMembers((prev) => (prev.length === 0 ? [user] : prev));
  }, [user]);

  // 진행 회원 제거는 +(편집) 버튼이 여는 MemberSelectModal 의 일괄 onConfirm 경유.
  // (이전 디자인 복구로 칩 위 X 버튼은 제거됨 — 기능은 모달에서 그대로 유지)

  // ─── Pod 연결 ────────────────────────────────────────────────
  const [registered, setRegistered] = useState<RegisteredDevice[]>([]);
  const [selectedPodIds, setSelectedPodIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      // 데모용 기기 자동 시드 (등록된 기기가 0대일 때만 1회)
      ensureDemoDevicesSeeded();
      const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_DEVICES);
      const list: RegisteredDevice[] = raw ? JSON.parse(raw) : [];
      setRegistered(Array.isArray(list) ? list.slice(0, TOTAL_POD_SLOTS) : []);
    } catch {
      setRegistered([]);
    }
  }, []);

  const togglePod = (id: string) => {
    setSelectedPodIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_PODS_PER_USER) return prev; // 4개 초과 차단
        next.add(id);
        // TODO: BLE write 0x4E + slotIdx + 0x0D 보내서 LED ON
      }
      return next;
    });
  };

  const isPrimaryConnected = registered.length > 0;

  // ─── BPM (per-user) ─────────────────────────────────────────
  const [bpm, setBpm] = useState(0);

  // ─── 색상 (enterprise only) ──────────────────────────────────
  const [color, setColor] = useState<string>('green');

  // ─── 세션 설정 (간소화) ──────────────────────────────────────
  const [level] = useState<Level>(3);
  // 트레이닝 시간: 풀세션(종합/COMPOSITE/TAU)만 300초, 나머지는 모두 45초
  const totalDurationSec = useMemo(() => {
    if (isComposite) return SESSION_MAX_MS / 1000;
    return 45;
  }, [isComposite]);

  // ─── 시작 가능 조건 ──────────────────────────────────────────
  const isStartEnabled =
    selectedPodIds.size > 0 &&
    bpm > 0 &&
    selectedMembers.length > 0;

  const handleStart = () => {
    if (!isStartEnabled || selectedMembers.length === 0 || !info || !mode) return;
    // 첫 번째 선택 멤버가 결과 저장의 1차 사용자. 나머지는 participantIds 로 보존되어
    // 향후 다중 사용자 동시 진행 분기에서 사용된다.
    const primary = selectedMembers[0];
    const run: TrainingRunState = {
      catalogId: mode,
      apiMode: info.apiMode as TrainingMode,
      userId: primary.id,
      participantIds: selectedMembers.map((m) => m.id),
      title: info.title,
      totalDurationSec,
      bpm,
      level,
      yieldsScore: !isFree,
      isComposite: isComposite || info.apiMode === 'COMPOSITE',
    };
    navigate('/training/session', { state: run });
  };

  return (
    <MobileLayout>
      <div className="max-w-md mx-auto px-4 pb-6" style={{ paddingTop: 'calc(1.5rem + env(safe-area-inset-top))', paddingBottom: '120px' }}>
        {/* 헤더 */}
        <div className="mb-4 flex items-center gap-3">
          <button onClick={() => navigate('/training')} className="text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-white">{title}</h1>
        </div>

        {/* 대표 이미지 */}
        {info?.image && (
          <div
            className="w-full aspect-[16/9] rounded-2xl mb-4 bg-cover bg-center"
            style={{ backgroundImage: `url(${info.image})`, backgroundColor: '#2A2A2A' }}
          />
        )}

        {/* 설명 */}
        <div className="mb-6">
          <h2 className="text-lg font-bold text-white mb-2">{title}</h2>
          <p className="text-sm leading-relaxed text-gray-400">
            {info?.desc || `${title}에 대한 설명 및 필요성 강조. 이 트레이닝에서 어떤 것을 강화할 건지 설명, 트레이닝 방법 설명`}
          </p>
        </div>

        {/* Pod 연결 — 이미지 3 디자인:
              ① 섹션 타이틀("Pod 연결") 단독 분리
              ② 블루투스 아이콘 + "N개의 pod 연결 됨 >" 가로형 카드 (전체가 /device 진입 트리거)
              ③ 8개 Pod 그리드 (4×2) — 위 두 요소와 같은 섹션으로 묶음 */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-white mb-3">Pod 연결</h2>

          {/* 블루투스 + 연결 수 카드 */}
          <button
            type="button"
            onClick={() => navigate('/device')}
            className="w-full flex items-center justify-between rounded-2xl px-4 py-3 mb-3"
            style={{ backgroundColor: '#1A1A1A', border: '1px solid #2A2A2A' }}
            aria-label="기기 관리 화면으로 이동"
          >
            <svg
              className="w-5 h-5"
              style={{ color: isPrimaryConnected ? '#AAED10' : '#666' }}
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
            >
              <path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29z" />
            </svg>
            <span className="flex items-center gap-1.5">
              <span className="text-sm" style={{ color: '#D4D4D4' }}>
                {registered.length}개의 pod 연결 됨
              </span>
              <svg className="w-4 h-4" style={{ color: '#888' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </button>

          {/* 8개 Pod 그리드 (4×2) */}
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: TOTAL_POD_SLOTS }).map((_, idx) => {
              const slotNum = idx + 1;
              const device = registered[idx] ?? null;
              const isSelected = device ? selectedPodIds.has(device.id) : false;
              const canSelectMore = selectedPodIds.size < MAX_PODS_PER_USER;

              return (
                <PodSlot
                  key={idx}
                  slotNum={slotNum}
                  device={device}
                  isSelected={isSelected}
                  disabled={!device || (!isSelected && !canSelectMore)}
                  onToggle={() => device && togglePod(device.id)}
                  onManage={() => navigate('/device')}
                />
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            최대 {MAX_PODS_PER_USER}개까지 선택 가능 · 선택된 Pod에 불빛이 켜집니다
          </p>
        </section>

        {/* 진행 회원 — 기업 소속 회원 전용 (관리자/승인된 개인 회원).
              이미지 2(이전 디자인) 복구: 컴팩트한 어두운 그린 칩 + 라임 텍스트.
              개별 X 버튼은 제거하고, +(추가/편집) 버튼이 여는 모달에서 일괄 편집/제거.
              → 다중 선택 기능은 그대로 유지 (removeMember 호출은 모달 onConfirm 경유). */}
        {hasOrganization && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-white mb-3">진행 회원</h2>
            <div className="flex items-center gap-2 flex-wrap">
              {selectedMembers.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium"
                  style={{
                    backgroundColor: '#1A2A1A',
                    color: '#AAED10',
                    border: '1px solid #2A3A2E',
                  }}
                >
                  <span className="truncate max-w-[100px]">
                    {m.nickname || m.name || '회원'}
                  </span>
                </span>
              ))}
              <button
                onClick={() => setShowMemberModal(true)}
                aria-label="진행 회원 추가/편집"
                className="w-7 h-7 rounded-full flex items-center justify-center text-base leading-none"
                style={{ backgroundColor: '#2A2A2A', color: '#D4D4D4' }}
              >
                +
              </button>
            </div>
            {selectedMembers.length === 0 && (
              <p className="mt-2 text-[11px]" style={{ color: '#888' }}>
                진행 회원을 1명 이상 선택해 주세요.
              </p>
            )}
          </section>
        )}

        {/* BPM 설정 — 원형 다이얼 */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-white mb-3">BPM 설정</h2>
          <div className="rounded-2xl p-6 flex items-center justify-center" style={{ backgroundColor: '#1A1A1A' }}>
            <BpmDial value={bpm} onChange={setBpm} />
          </div>
        </section>

        {/* 색상 — 기업 회원 전용 */}
        {isEnterprise && (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-white mb-3">색상</h2>
            <div className="flex items-center gap-3">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setColor(c.id)}
                  className="w-8 h-8 rounded-full transition-all"
                  style={{
                    backgroundColor: c.color,
                    boxShadow: color === c.id ? '0 0 0 2px #fff' : 'none',
                    transform: color === c.id ? 'scale(1.1)' : 'scale(1)',
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* 시작하기 */}
        <button
          onClick={handleStart}
          disabled={!isStartEnabled}
          className="w-full py-4 rounded-3xl font-semibold transition-all"
          style={{
            backgroundColor: isStartEnabled ? '#AAED10' : '#1A1A1A',
            color: isStartEnabled ? '#000' : '#666',
          }}
        >
          시작하기
        </button>
      </div>

      <MemberSelectModal
        isOpen={showMemberModal}
        onClose={() => setShowMemberModal(false)}
        onConfirm={setSelectedMembers}
        initialSelectedIds={selectedMembers.map((m) => m.id)}
        currentUser={user}
      />
    </MobileLayout>
  );
}

// =============================================================================
// 개별 Pod 슬롯
// =============================================================================
function PodSlot({
  slotNum,
  device,
  isSelected,
  disabled,
  onToggle,
  onManage,
}: {
  slotNum: number;
  device: RegisteredDevice | null;
  isSelected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onManage: () => void;
}) {
  const accent = '#AAED10';
  const hasDevice = !!device;

  return (
    <div
      className="rounded-xl px-2.5 py-2.5 flex flex-col items-stretch min-h-[72px]"
      style={{
        backgroundColor: '#1A1A1A',
        border: isSelected ? `1.5px solid ${accent}` : '1.5px solid #2A2A2A',
      }}
    >
      {/* 위 라벨 (번호 + Pod N) */}
      <div className="flex items-center gap-1.5 mb-2">
        <span
          className="text-[11px] font-bold w-4 h-4 rounded-[3px] flex items-center justify-center leading-none"
          style={{
            backgroundColor: isSelected ? accent : 'transparent',
            color: isSelected ? '#000' : hasDevice ? '#888' : '#555',
            border: isSelected ? 'none' : `1px solid ${hasDevice ? '#555' : '#3A3A3A'}`,
          }}
        >
          {slotNum}
        </span>
        <span
          className="text-xs"
          style={{ color: hasDevice ? '#D4D4D4' : '#666' }}
        >
          Pod {slotNum}
        </span>
      </div>

      {/* 토글 또는 기기 관리 */}
      {hasDevice ? (
        <button
          onClick={onToggle}
          disabled={disabled}
          className="self-start"
        >
          <Toggle on={isSelected} />
        </button>
      ) : (
        <button
          onClick={onManage}
          className="text-[11px] text-left"
          style={{ color: '#666' }}
        >
          기기 관리 &gt;
        </button>
      )}
    </div>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className="inline-flex items-center w-9 h-5 rounded-full p-0.5 transition-colors"
      style={{ backgroundColor: on ? '#AAED10' : '#3A3A3A' }}
    >
      <span
        className="block w-4 h-4 rounded-full bg-white transition-transform"
        style={{ transform: on ? 'translateX(16px)' : 'translateX(0)' }}
      />
    </span>
  );
}

// =============================================================================
// 원형 BPM 다이얼 (0~200 BPM)
//   - 원주를 탭/드래그하면 해당 위치 → 각도 → BPM 환산
//   - 12시 방향이 0, 시계방향으로 증가
// =============================================================================
function BpmDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const MIN = 0;
  const MAX = 200;
  const SIZE = 220;
  const STROKE = 8;
  const R = (SIZE - STROKE) / 2;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const svgRef = useRef<SVGSVGElement>(null);

  // 값 → 각도 (0 BPM = 0°, 200 BPM = 360°, 12시 방향 기준)
  const angleDeg = (value / MAX) * 360;
  const indicatorX = CX + R * Math.sin((angleDeg * Math.PI) / 180);
  const indicatorY = CY - R * Math.cos((angleDeg * Math.PI) / 180);

  const handlePointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * SIZE - CX;
      const y = ((clientY - rect.top) / rect.height) * SIZE - CY;
      // 12시 = 0도, 시계방향
      let deg = (Math.atan2(x, -y) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      const next = Math.round((deg / 360) * MAX);
      onChange(Math.max(MIN, Math.min(MAX, next)));
    },
    [onChange]
  );

  // 눈금 (60개)
  const ticks = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div className="select-none touch-none">
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          handlePointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) handlePointer(e.clientX, e.clientY);
        }}
      >
        {/* 외곽 원 */}
        <circle cx={CX} cy={CY} r={R} stroke="#2A2A2A" strokeWidth={STROKE} fill="none" />

        {/* 눈금 */}
        {ticks.map((t) => {
          const deg = (t / ticks.length) * 360;
          const rad = (deg * Math.PI) / 180;
          const x1 = CX + (R - 6) * Math.sin(rad);
          const y1 = CY - (R - 6) * Math.cos(rad);
          const x2 = CX + (R - 2) * Math.sin(rad);
          const y2 = CY - (R - 2) * Math.cos(rad);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3A3A3A" strokeWidth={1} />;
        })}

        {/* 채워진 진행 호 */}
        {value > 0 && (
          <path
            d={describeArc(CX, CY, R, 0, angleDeg)}
            stroke="#AAED10"
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
          />
        )}

        {/* 인디케이터 점 */}
        <circle cx={indicatorX} cy={indicatorY} r={6} fill="#fff" />

        {/* 중앙 값 */}
        <text x={CX} y={CY - 4} textAnchor="middle" fill="#fff" fontSize="32" fontWeight="700">
          {value}
        </text>
        <text x={CX} y={CY + 22} textAnchor="middle" fill="#999" fontSize="14">
          BPM
        </text>
      </svg>
    </div>
  );
}

// SVG arc helper (12시 방향 기준 시계방향)
function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const polar = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
  };
  const start = polar(startDeg);
  const end = polar(endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}
