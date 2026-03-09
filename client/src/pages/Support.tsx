/**
 * 고객센터 페이지 (회원용)
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import MobileLayout from '../components/Layout/MobileLayout';

interface Inquiry {
  id: string;
  date?: string;
  createdAt?: string;
  title: string;
  content: string;
  status: 'PENDING' | 'ANSWERED';
  answer?: string;
  answerDate?: string;
}

export default function Support() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [newInquiry, setNewInquiry] = useState({ title: '', content: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // ProtectedRoute가 이미 인증을 체크하므로, 여기서는 로딩만 확인
    if (authLoading) {
      return;
    }
    if (activeTab === 'history' && user) {
      loadInquiries();
    }
  }, [user, authLoading, activeTab]);

  const loadInquiries = async () => {
    try {
      setLoading(true);
      const response = await api.getUserInquiries();
      if (response.success && response.data) {
        setInquiries(response.data);
      }
    } catch (error) {
      console.error('Failed to load inquiries:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInquiry = async () => {
    if (!newInquiry.title.trim() || !newInquiry.content.trim()) {
      alert('제목과 내용을 입력해주세요.');
      return;
    }

    try {
      setSubmitting(true);
      const response = await api.createInquiry(newInquiry.title, newInquiry.content);
      
      if (response.success) {
        setNewInquiry({ title: '', content: '' });
        setActiveTab('history');
        await loadInquiries();
        alert('문의가 등록되었습니다.');
      } else {
        alert(response.error || '문의 등록에 실패했습니다.');
      }
    } catch (error) {
      console.error('Failed to create inquiry:', error);
      alert('문의 등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <MobileLayout>
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
          <div className="text-white">로딩 중...</div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout>
      <div style={{ backgroundColor: '#0A0A0A', paddingBottom: '100px' }}>
        <div className="max-w-md mx-auto px-4 py-6">
          {/* 헤더 */}
          <div className="mb-6 flex items-center gap-4">
            <button
              onClick={() => navigate('/profile')}
              className="flex items-center"
              style={{ color: '#FFFFFF' }}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>
              고객센터
            </h1>
          </div>

          {/* 탭 */}
          <div className="flex mb-6">
            <button
              onClick={() => setActiveTab('create')}
              className="flex-1 px-4 py-2 font-semibold text-center border-b-2"
              style={{
                color: activeTab === 'create' ? '#AAED10' : '#D6D6D6',
                borderColor: activeTab === 'create' ? '#AAED10' : '#666666',
              }}
            >
              1:1 문의하기
            </button>
            <button
              onClick={() => {
                setActiveTab('history');
                loadInquiries();
              }}
              className="flex-1 px-4 py-2 font-semibold text-center border-b-2"
              style={{
                color: activeTab === 'history' ? '#AAED10' : '#D6D6D6',
                borderColor: activeTab === 'history' ? '#AAED10' : '#666666',
              }}
            >
              나의 문의 내역
            </button>
          </div>

          {/* 탭 내용 */}
          {activeTab === 'create' ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#FFFFFF' }}>
                  제목
                </label>
                <input
                  type="text"
                  value={newInquiry.title}
                  onChange={(e) => {
                    if (e.target.value.length <= 30) {
                      setNewInquiry({ ...newInquiry, title: e.target.value });
                    }
                  }}
                  placeholder="문의하실 내용의 제목을 입력해 주세요."
                  maxLength={30}
                  className="w-full px-4 py-3 rounded-lg focus:outline-none"
                  style={{ 
                    backgroundColor: '#1A1A1A', 
                    borderColor: '#333333', 
                    color: '#FFFFFF',
                    border: '1px solid #333333',
                    outline: 'none'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#333333';
                  }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#FFFFFF' }}>
                  문의 내용
                </label>
                <textarea
                  value={newInquiry.content}
                  onChange={(e) => {
                    if (e.target.value.length <= 500) {
                      setNewInquiry({ ...newInquiry, content: e.target.value });
                    }
                  }}
                  placeholder="문의 내용을 구체적으로 작성해 주세요."
                  rows={8}
                  maxLength={500}
                  className="w-full px-4 py-3 rounded-lg focus:outline-none"
                  style={{ 
                    backgroundColor: '#1A1A1A', 
                    borderColor: '#333333', 
                    color: '#FFFFFF',
                    border: '1px solid #333333',
                    resize: 'none',
                    outline: 'none'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#333333';
                  }}
                />
              </div>
              <button
                onClick={handleCreateInquiry}
                disabled={submitting || !newInquiry.title.trim() || !newInquiry.content.trim()}
                className="w-full py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ 
                  backgroundColor: submitting || !newInquiry.title.trim() || !newInquiry.content.trim() ? '#333333' : '#AAED10', 
                  color: submitting || !newInquiry.title.trim() || !newInquiry.content.trim() ? '#666666' : '#000000' 
                }}
              >
                {submitting ? '등록 중...' : '등록하기'}
              </button>
            </div>
          ) : (
            <>
              {loading ? (
                <div className="text-center py-12" style={{ color: '#B6B6B9' }}>
                  로딩 중...
                </div>
              ) : inquiries.length === 0 ? (
                <div className="flex items-center justify-center" style={{ minHeight: '400px', color: '#D6D6D6' }}>
                  작성한 문의 내역이 없습니다.
                </div>
              ) : (
                <div className="space-y-3">
                  {inquiries.map((inquiry) => (
                    <div
                      key={inquiry.id}
                      onClick={() => navigate(`/support/inquiry/${inquiry.id}`)}
                      className="p-4 rounded-lg cursor-pointer"
                      style={{ backgroundColor: '#1A1A1A' }}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold flex-1 mr-2" style={{ color: '#FFFFFF' }}>
                          {inquiry.title}
                        </h3>
                        <button
                          className="px-3 py-1 text-xs font-medium"
                          style={{
                            color: inquiry.status === 'ANSWERED' ? '#000000' : '#FFFFFF',
                            backgroundColor: inquiry.status === 'ANSWERED' ? '#AAED10' : '#666666',
                            border: 'none',
                            borderRadius: '20px',
                          }}
                        >
                          {inquiry.status === 'ANSWERED' ? '답변완료' : '답변대기'}
                        </button>
                      </div>
                      <div className="text-xs mt-2" style={{ color: '#666666' }}>
                        {new Date(inquiry.date || inquiry.createdAt || '').toLocaleDateString('ko-KR', {
                          year: '2-digit',
                          month: '2-digit',
                          day: '2-digit',
                        }).replace(/\.$/, '')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </MobileLayout>
  );
}
