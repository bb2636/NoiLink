/**
 * 약관 관리 페이지
 */
import { useState, useEffect } from 'react';
import api from '../../utils/api';
import type { Terms, TermsType } from '@noilink/shared';

export default function AdminTerms() {
  const [activeTab, setActiveTab] = useState<TermsType>('SERVICE');
  const [terms, setTerms] = useState<Terms | null>(null);
  const [editContent, setEditContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadTerms();
  }, [activeTab]);

  const loadTerms = async () => {
    try {
      setLoading(true);
      const response = await api.getAdminTerms();
      if (response.success && response.data) {
        const activeTerm = response.data
          .filter((t: Terms) => t.type === activeTab && t.isActive)
          .sort((a: Terms, b: Terms) => (b.version || 0) - (a.version || 0))[0];
        setTerms(activeTerm || null);
        setEditContent(activeTerm?.content || '');
      }
    } catch (error) {
      console.error('Failed to load terms:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editContent.trim()) {
      alert('약관 내용을 입력해주세요.');
      return;
    }

    try {
      setSaving(true);
      let response;
      
      if (terms) {
        // 기존 약관 수정
        response = await api.updateTerm(terms.id, {
          content: editContent,
        });
      } else {
        // 새 약관 생성
        response = await api.createTerm({
          type: activeTab,
          title: activeTab === 'PRIVACY' ? '개인정보처리방침' : '서비스 이용약관',
          content: editContent,
          isRequired: true,
        });
      }

      if (response.success) {
        await loadTerms();
        alert(terms ? '약관이 수정되었습니다.' : '약관이 생성되었습니다.');
      } else {
        alert(response.error || (terms ? '약관 수정에 실패했습니다.' : '약관 생성에 실패했습니다.'));
      }
    } catch (error) {
      console.error('Failed to save terms:', error);
      alert(terms ? '약관 수정에 실패했습니다.' : '약관 생성에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2" style={{ color: '#000000' }}>
          약관 관리
        </h1>
        <p className="text-sm" style={{ color: '#666666' }}>
          서비스에 사용되는 약관을 관리(수정확인)할 수 있어요.
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-4 mb-4">
        <button
          onClick={() => setActiveTab('PRIVACY')}
          className={`px-4 py-2 font-semibold ${
            activeTab === 'PRIVACY' ? 'border-b-2' : ''
          }`}
          style={{
            color: activeTab === 'PRIVACY' ? '#000000' : '#666666',
            borderColor: activeTab === 'PRIVACY' ? '#000000' : 'transparent',
          }}
        >
          개인정보처리방침
        </button>
        <button
          onClick={() => setActiveTab('SERVICE')}
          className={`px-4 py-2 font-semibold ${
            activeTab === 'SERVICE' ? 'border-b-2' : ''
          }`}
          style={{
            color: activeTab === 'SERVICE' ? '#000000' : '#666666',
            borderColor: activeTab === 'SERVICE' ? '#000000' : 'transparent',
          }}
        >
          서비스 이용약관
        </button>
      </div>
      <div className="border-b mb-6" style={{ borderColor: '#E5E5E5' }}></div>

      {/* 약관 내용 영역 */}
      {loading ? (
        <div className="flex items-center justify-center" style={{ color: '#666666', minHeight: '60vh' }}>
          로딩 중...
        </div>
      ) : (
        <div className="relative">
          {/* 업데이트 정보 */}
          {terms && (
            <div className="mb-4 text-right">
              <span className="text-sm" style={{ color: '#666666' }}>
                자동 업데이트됨 {(() => {
                  const date = terms.updatedAt ? new Date(terms.updatedAt) : (terms.createdAt ? new Date(terms.createdAt) : new Date());
                  const year = date.getFullYear();
                  const month = String(date.getMonth() + 1).padStart(2, '0');
                  const day = String(date.getDate()).padStart(2, '0');
                  const hour = String(date.getHours()).padStart(2, '0');
                  const minute = String(date.getMinutes()).padStart(2, '0');
                  return `${year}.${month}.${day} ${hour}:${minute}`;
                })()}
              </span>
            </div>
          )}

          {/* 약관 내용 (편집 가능) */}
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full p-6 border rounded-lg whitespace-pre-wrap"
            style={{
              borderColor: '#E5E5E5',
              color: '#000000',
              backgroundColor: '#FFFFFF',
              minHeight: '60vh',
              maxHeight: '70vh',
              overflow: 'auto',
              fontFamily: 'inherit',
              fontSize: '14px',
              lineHeight: '1.6',
            }}
            placeholder="약관 내용을 입력해주세요."
          />

          {/* 저장 버튼 */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving || !editContent.trim() || (terms !== null && editContent === terms.content)}
              className="px-6 py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ 
                backgroundColor: (!editContent.trim() || (terms && editContent === terms.content)) ? '#F5F5F5' : '#2A2A2A', 
                color: (!editContent.trim() || (terms && editContent === terms.content)) ? '#999999' : '#FFFFFF' 
              }}
            >
              {saving ? '저장 중...' : '저장하기'}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
