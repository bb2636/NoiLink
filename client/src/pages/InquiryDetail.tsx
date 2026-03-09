/**
 * 문의 상세보기 페이지
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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

export default function InquiryDetail() {
  const { inquiryId } = useParams<{ inquiryId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (inquiryId) {
      loadInquiry();
    }
  }, [inquiryId]);

  const loadInquiry = async () => {
    try {
      setLoading(true);
      const response = await api.getUserInquiries();
      if (response.success && response.data) {
        const foundInquiry = response.data.find((i: Inquiry) => i.id === inquiryId);
        if (foundInquiry) {
          setInquiry(foundInquiry);
        }
      }
    } catch (error) {
      console.error('Failed to load inquiry:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <MobileLayout>
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
          <div className="text-white">로딩 중...</div>
        </div>
      </MobileLayout>
    );
  }

  if (!inquiry) {
    return (
      <MobileLayout>
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#0A0A0A' }}>
          <div className="text-white">문의를 찾을 수 없습니다.</div>
        </div>
      </MobileLayout>
    );
  }

  const inquiryDate = new Date(inquiry.date || inquiry.createdAt || '');
  const formattedInquiryDate = `${inquiryDate.getFullYear()}.${String(inquiryDate.getMonth() + 1).padStart(2, '0')}.${String(inquiryDate.getDate()).padStart(2, '0')}`;

  return (
    <MobileLayout>
      <div style={{ backgroundColor: '#0A0A0A', paddingBottom: '100px' }}>
        <div className="max-w-md mx-auto px-4 py-6">
          {/* 헤더 - 상단 고정 (스크롤 시에도 보임) */}
          <div 
            className="mb-6 flex items-center gap-2 sticky top-0 z-10 -mx-4 px-4 py-4 -mt-6 pt-6"
            style={{ backgroundColor: '#0A0A0A' }}
          >
            <button
              onClick={() => navigate('/support')}
              className="flex items-center"
              style={{ color: '#FFFFFF' }}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold" style={{ color: '#FFFFFF' }}>
              문의 상세보기
            </h1>
          </div>

          {/* 문의 정보 */}
          <div className="space-y-4">
            <div style={{ color: '#FFFFFF' }}>
              <div className="text-sm mb-1" style={{ color: '#999999' }}>{formattedInquiryDate}</div>
            </div>

            <div style={{ color: '#FFFFFF' }}>
              <div className="text-lg font-semibold mb-3">{inquiry.title}</div>
            </div>

            <div style={{ color: '#FFFFFF' }}>
              <div className="whitespace-pre-wrap leading-relaxed">{inquiry.content}</div>
            </div>

            {/* 구분선 */}
            <div className="border-t my-6" style={{ borderColor: '#333333' }}></div>

            {/* 답변 내역 */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-lg font-semibold" style={{ color: '#FFFFFF' }}>
                  답변 내역
                </div>
                {inquiry.status === 'ANSWERED' && inquiry.answerDate && (
                  <div className="text-sm" style={{ color: '#999999' }}>
                    {(() => {
                      const answerDate = new Date(inquiry.answerDate);
                      return `${answerDate.getFullYear()}.${String(answerDate.getMonth() + 1).padStart(2, '0')}.${String(answerDate.getDate()).padStart(2, '0')}`;
                    })()}
                  </div>
                )}
              </div>
              {inquiry.status === 'ANSWERED' && inquiry.answer ? (
                <div className="whitespace-pre-wrap leading-relaxed" style={{ color: '#FFFFFF' }}>
                  {inquiry.answer}
                </div>
              ) : (
                <div style={{ color: '#FFFFFF' }}>
                  {user?.name || '고객'} 님의 소중한 의견을 확인 중입니다. 잠시만 기다려주세요.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </MobileLayout>
  );
}
