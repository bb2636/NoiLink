/**
 * 진행 회원 선택 모달
 * 기업 회원: 조직 멤버 리스트 / 개인 회원: 본인만 표시
 * 위로 슬라이드 시 펼침, 내리면 접힘
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../utils/api';
import type { User } from '@noilink/shared';

interface MemberSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (user: User) => void;
  currentUser: User | null;
}

const BOTTOM_NAV_HEIGHT = 'calc(64px + env(safe-area-inset-bottom))';

export default function MemberSelectModal({ isOpen, onClose, onSelect, currentUser }: MemberSelectModalProps) {
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (isOpen && currentUser) {
      loadMembers();
      setExpanded(false);
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

  const filteredMembers = members.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    (m.username || '').toLowerCase().includes(search.toLowerCase())
  );

  const isPersonal = currentUser?.userType === 'PERSONAL';
  const canSelectOthers = currentUser?.userType === 'ORGANIZATION';

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
          height: expanded ? 'calc(100vh - 80px)' : '45vh',
        }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ type: 'tween', duration: 0.25 }}
        className="fixed left-0 right-0 z-50 rounded-t-2xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: '#1A1A1A',
          bottom: BOTTOM_NAV_HEIGHT,
          minHeight: '200px',
          maxHeight: 'calc(100vh - 80px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 드래그 핸들 - 위로 슬라이드 시 펼침, 내리면 접힘 */}
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
        <div className="p-4 pt-0 border-b flex-shrink-0" style={{ borderColor: '#333333' }}>
          <h2 className="text-lg font-bold" style={{ color: '#FFFFFF' }}>
            진행 회원 선택
          </h2>
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
                  onSelect(currentUser);
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
              {filteredMembers.map((member) => (
                <button
                  key={member.id}
                  onClick={() => {
                    onSelect(member);
                    onClose();
                  }}
                  className="w-full text-left px-4 py-3 rounded-lg flex items-center gap-3"
                  style={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
                >
                  <span>{member.name}</span>
                  {member.username && (
                    <span className="text-sm" style={{ color: '#999999' }}>
                      @{member.username}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
