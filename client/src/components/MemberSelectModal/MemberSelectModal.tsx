/**
 * 진행 회원 선택 모달
 *
 * - 기업 회원(소속 있음): 조직 멤버를 다중 선택 (체크박스 + 확인 버튼)
 * - 개인 회원(소속 없음): 본인만 선택 가능 (탭 → 즉시 확정)
 *
 * 다중 선택 동작
 *  - `initialSelectedIds` 로 부모가 가진 현재 선택을 받아 그대로 체크된 상태로 연다.
 *  - 사용자가 체크/해제하다가 "확인" 을 누르면 그 시점 선택을 부모에게 한 번에 전달.
 *  - 모달 안에서만 임시로 다루고, 모달을 닫는 즉시(취소/배경탭) 변경은 버려진다.
 *
 * 디자인 의도
 *  - 진행 회원 칩에서 X 로 개별 제거 가능 → 모달은 "추가/삭제 일괄 편집" 용도.
 *  - 빈 선택(0명) 도 허용해 부모가 자유롭게 처리 (시작 버튼 disable 등).
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../utils/api';
import type { User } from '@noilink/shared';

interface MemberSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * 사용자가 "확인" 을 눌렀을 때 호출. 빈 배열도 가능.
   * 호출 후 부모가 모달을 닫는 책임을 지므로 본 컴포넌트는 onClose 도 함께 호출한다.
   */
  onConfirm: (users: User[]) => void;
  currentUser: User | null;
  /** 부모의 현재 선택. 모달이 열릴 때 체크 상태로 복원된다. */
  initialSelectedIds?: string[];
}

const BOTTOM_NAV_HEIGHT = 'calc(64px + env(safe-area-inset-bottom))';

export default function MemberSelectModal({
  isOpen,
  onClose,
  onConfirm,
  currentUser,
  initialSelectedIds,
}: MemberSelectModalProps) {
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  // 모달 안에서만 다루는 임시 선택 집합 (확인 누르기 전엔 부모 상태에 영향 없음).
  const [draftSelected, setDraftSelected] = useState<Set<string>>(new Set());
  // initialSelectedIds 는 부모 렌더마다 새 배열 참조가 들어오므로,
  // useEffect 의존성에 직접 넣으면 모달이 열려있는 동안 부모 리렌더가 일어날 때마다
  // 사용자가 만든 draft 가 통째로 덮어써지는 버그가 생긴다.
  // → ref 로 항상 최신값만 보관하고, 모달이 "닫힘 → 열림" 으로 전환될 때만
  //   ref 의 현재 값을 draft 의 시드로 쓴다.
  const initialIdsRef = useRef<string[] | undefined>(initialSelectedIds);
  initialIdsRef.current = initialSelectedIds;

  useEffect(() => {
    if (isOpen && currentUser) {
      loadMembers();
      setExpanded(false);
      setSearch('');
      setDraftSelected(new Set(initialIdsRef.current ?? []));
    }
  }, [isOpen, currentUser]);

  const loadMembers = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const res = await api.getOrganizationMembers();
      if (res.success && res.data) {
        setMembers(res.data);
      }
    } catch {
      setMembers([currentUser]);
    } finally {
      setLoading(false);
    }
  };

  const filteredMembers = useMemo(
    () =>
      members.filter(
        (m) =>
          m.name.toLowerCase().includes(search.toLowerCase()) ||
          (m.username || '').toLowerCase().includes(search.toLowerCase()),
      ),
    [members, search],
  );

  const isPersonal = !currentUser?.organizationId;
  const canSelectOthers = !!currentUser?.organizationId;

  const toggleMember = (id: string) => {
    setDraftSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    // 멤버 리스트 순서를 유지하면서 선택된 것만 골라 부모에게 전달
    const ordered = members.filter((m) => draftSelected.has(m.id));
    onConfirm(ordered);
    onClose();
  };

  const selectedCount = draftSelected.size;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center"
      />
      {/* 모달 아래 여백(네비 위)을 모달 배경색과 동일하게 채움 */}
      <div
        className="fixed left-0 right-0 bottom-0 z-50"
        style={{ height: BOTTOM_NAV_HEIGHT, backgroundColor: '#1A1A1A' }}
      />
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{
          opacity: 1,
          y: 0,
          height: expanded ? 'calc(100vh - 80px)' : '55vh',
        }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ type: 'tween', duration: 0.25 }}
        className="fixed left-0 right-0 z-50 rounded-t-2xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: '#1A1A1A',
          bottom: BOTTOM_NAV_HEIGHT,
          minHeight: '240px',
          maxHeight: 'calc(100vh - 80px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 드래그 핸들 */}
        <motion.div
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.1}
          onDragEnd={(_, info) => {
            if (info.offset.y < -30 || info.velocity.y < -200) setExpanded(true);
            else if (info.offset.y > 30 || info.velocity.y > 200) setExpanded(false);
          }}
          onClick={() => setExpanded((e) => !e)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setExpanded((prev) => !prev)}
          className="w-full py-3 flex justify-center cursor-grab active:cursor-grabbing touch-none"
          style={{ color: '#666666' }}
        >
          <span
            className="block w-10 h-1 rounded-full"
            style={{ backgroundColor: '#666666' }}
          />
        </motion.div>

        <div className="px-4 pb-3 border-b flex-shrink-0" style={{ borderColor: '#333333' }}>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: '#FFFFFF' }}>
              진행 회원 선택
            </h2>
            {canSelectOthers && (
              <span className="text-xs" style={{ color: '#AAED10' }}>
                {selectedCount}명 선택
              </span>
            )}
          </div>
          {canSelectOthers && (
            <div className="mt-3 relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="회원의 이름을 입력해 보세요."
                className="w-full px-4 py-2 rounded-lg bg-transparent border focus:outline-none"
                style={{ borderColor: '#333333', color: '#FFFFFF' }}
              />
              <svg
                className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5"
                style={{ color: '#999999' }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          )}
        </div>

        <div
          className="overflow-y-auto flex-1 p-4 scrollbar-hide"
          style={{ minHeight: 0 }}
        >
          {loading ? (
            <div className="py-8 text-center" style={{ color: '#999999' }}>
              로딩 중...
            </div>
          ) : isPersonal ? (
            <button
              onClick={() => {
                if (currentUser) {
                  // 개인 회원은 본인만 가능 → 즉시 확정.
                  onConfirm([currentUser]);
                  onClose();
                }
              }}
              className="w-full text-left px-4 py-3 rounded-lg"
              style={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
            >
              {currentUser?.name} (본인)
            </button>
          ) : filteredMembers.length === 0 ? (
            <p className="py-4 text-center" style={{ color: '#B6B6B9' }}>
              검색 결과가 없습니다.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredMembers.map((member) => {
                const checked = draftSelected.has(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member.id)}
                    className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors"
                    style={{
                      backgroundColor: checked ? '#2a3a14' : '#2A2A2A',
                      color: '#FFFFFF',
                      border: checked ? '1px solid #AAED10' : '1px solid transparent',
                    }}
                  >
                    {/* 체크박스 */}
                    <span
                      className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: checked ? '#AAED10' : 'transparent',
                        border: checked ? 'none' : '1.5px solid #555',
                      }}
                    >
                      {checked && (
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="#000"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l3 3 7-7" />
                        </svg>
                      )}
                    </span>
                    <span className="flex-1 truncate">{member.name}</span>
                    {member.id === currentUser?.id && (
                      <span className="text-xs flex-shrink-0" style={{ color: '#AAED10' }}>
                        본인
                      </span>
                    )}
                    {member.username && member.id !== currentUser?.id && (
                      <span
                        className="text-sm flex-shrink-0 truncate"
                        style={{ color: '#999999' }}
                      >
                        @{member.username}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 다중 선택 모드일 때만 하단 확인 버튼 노출. 개인 회원은 위 버튼 탭으로 즉시 확정. */}
        {canSelectOthers && (
          <div
            className="p-4 border-t flex-shrink-0 flex gap-2"
            style={{ borderColor: '#333333' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl font-semibold"
              style={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 py-3 rounded-xl font-semibold"
              style={{
                backgroundColor: '#AAED10',
                color: '#000',
              }}
            >
              확인 ({selectedCount})
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
