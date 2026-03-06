/**
 * 고객센터 페이지
 */
import { useState, useEffect } from 'react';
import api from '../../utils/api';
import Pagination from '../../components/Admin/Pagination';
import Modal from '../../components/Admin/Modal';

interface Inquiry {
  id: string;
  date: string;
  createdAt?: string;
  title: string;
  content: string;
  status: 'PENDING' | 'ANSWERED';
  answer?: string;
  answerDate?: string;
  userId: string;
  userName?: string;
}

export default function AdminSupport() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [filteredInquiries, setFilteredInquiries] = useState<Inquiry[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInquiry, setSelectedInquiry] = useState<Inquiry | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [loading, setLoading] = useState(true);

  const itemsPerPage = 10;

  useEffect(() => {
    loadInquiries();
  }, []);

  useEffect(() => {
    filterInquiries();
  }, [inquiries, searchQuery]);

  useEffect(() => {
    setTotalPages(Math.ceil(filteredInquiries.length / itemsPerPage));
  }, [filteredInquiries]);

  const loadInquiries = async () => {
    try {
      setLoading(true);
      const response = await api.getAdminInquiries();
      if (response.success && response.data) {
        // 최신순 정렬
        const sortedInquiries = [...response.data].sort((a, b) => {
          const dateA = new Date(a.date || a.createdAt || '').getTime();
          const dateB = new Date(b.date || b.createdAt || '').getTime();
          return dateB - dateA;
        });
        setInquiries(sortedInquiries);
      } else {
        setInquiries([]);
      }
    } catch (error) {
      console.error('Failed to load inquiries:', error);
      setInquiries([]);
    } finally {
      setLoading(false);
    }
  };

  const filterInquiries = () => {
    let filtered = [...inquiries];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(i => 
        i.title.toLowerCase().includes(query) ||
        i.content.toLowerCase().includes(query)
      );
    }

    setFilteredInquiries(filtered);
    setCurrentPage(1);
  };

  const handleAnswer = async () => {
    if (!selectedInquiry || !answerText.trim()) {
      alert('답변 내용을 입력해주세요.');
      return;
    }

    try {
      const response = await api.answerInquiry(selectedInquiry.id, answerText);

      if (response.success) {
        await loadInquiries();
        setShowDetailModal(false);
        setAnswerText('');
      }
    } catch (error) {
      console.error('Failed to answer inquiry:', error);
    }
  };

  const paginatedInquiries = filteredInquiries.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2" style={{ color: '#000000' }}>
          고객센터
        </h1>
        <p className="text-sm" style={{ color: '#666666' }}>
          문의 내역을 확인할 수 있어요.
        </p>
      </div>

      {/* 탭 및 검색 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-4">
          <button
            className="px-4 py-2 font-semibold border-b-2"
            style={{
              color: '#000000',
              borderColor: '#000000',
            }}
          >
            문의 내역 {inquiries.length}
          </button>
        </div>
        {/* 검색창 */}
        <div className="flex items-center relative">
          <svg 
            className="absolute left-3 w-5 h-5" 
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
          <input
            type="text"
            placeholder="Q 제목, 내용 등 검색"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-4 py-2 border rounded-lg"
            style={{ borderColor: '#E5E5E5', color: '#000000', width: '300px' }}
          />
        </div>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div className="flex items-center justify-center" style={{ color: '#666666', minHeight: '60vh' }}>
          로딩 중...
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: '#E5E5E5' }}>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    번호
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    문의일
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    제목
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    내용
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    답변 상태
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    관리
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedInquiries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12">
                      <div className="flex flex-col items-center justify-center" style={{ color: '#666666', minHeight: '400px' }}>
                        <div className="mb-4 text-4xl">📄</div>
                        <div>문의 내역이 없습니다.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedInquiries.map((inquiry, index) => {
                    const inquiryNumber = (currentPage - 1) * itemsPerPage + index + 1;
                    return (
                      <tr key={inquiry.id} className="border-b hover:bg-gray-50" style={{ borderColor: '#E5E5E5' }}>
                        <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                          {inquiryNumber}
                        </td>
                        <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {new Date(inquiry.date || inquiry.createdAt || '').toLocaleDateString('ko-KR', {
                          year: '2-digit',
                          month: '2-digit',
                          day: '2-digit',
                        }).replace(/\.$/, '')}
                        </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {inquiry.title}
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {inquiry.content.length > 30 ? `${inquiry.content.substring(0, 30)}...` : inquiry.content}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span
                          className="px-3 py-1 rounded text-sm font-medium"
                          style={{
                            color: inquiry.status === 'ANSWERED' ? '#0066FF' : '#FF9500',
                            backgroundColor: inquiry.status === 'ANSWERED' ? '#E6F2FF' : '#FFF4E6',
                          }}
                        >
                          {inquiry.status === 'ANSWERED' ? '답변완료' : '답변대기'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => {
                            setSelectedInquiry(inquiry);
                            setAnswerText(inquiry.answer || '');
                            setShowDetailModal(true);
                          }}
                          className="px-4 py-2 border rounded-lg text-sm"
                          style={{ borderColor: '#E5E5E5', color: '#000000' }}
                        >
                          상세보기
                        </button>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {paginatedInquiries.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}

      {/* 상세보기 모달 */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title="상세보기"
        width="500px"
        position="right"
      >
        {selectedInquiry && (
          <div className="flex flex-col" style={{ height: 'calc(100vh - 160px)', maxHeight: 'calc(100vh - 160px)' }}>
            <div className="flex-1 overflow-y-auto" style={{ paddingRight: '8px' }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                    문의일
                  </label>
                  <input
                    type="text"
                    value={new Date(selectedInquiry.date || selectedInquiry.createdAt || '').toLocaleDateString('ko-KR', {
                      year: '2-digit',
                      month: '2-digit',
                      day: '2-digit',
                    }).replace(/\.$/, '')}
                    readOnly
                    className="w-full px-4 py-2 border rounded-lg"
                    style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                    제목
                  </label>
                  <input
                    type="text"
                    value={selectedInquiry.title}
                    readOnly
                    className="w-full px-4 py-2 border rounded-lg"
                    style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                    내용
                  </label>
                  <textarea
                    value={selectedInquiry.content}
                    readOnly
                    rows={4}
                    className="w-full px-4 py-2 border rounded-lg"
                    style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000', resize: 'none' }}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                    답변 상태
                  </label>
                  <span
                    className="px-3 py-1 rounded text-sm font-medium inline-block"
                    style={{
                      color: selectedInquiry.status === 'ANSWERED' ? '#0066FF' : '#FF9500',
                      backgroundColor: selectedInquiry.status === 'ANSWERED' ? '#E6F2FF' : '#FFF4E6',
                    }}
                  >
                    {selectedInquiry.status === 'ANSWERED' ? '답변완료' : '답변대기'}
                  </span>
                </div>

                {selectedInquiry.answerDate && (
                  <div>
                    <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                      답변일
                    </label>
                    <input
                      type="text"
                      value={new Date(selectedInquiry.answerDate).toLocaleDateString('ko-KR', {
                        year: '2-digit',
                        month: '2-digit',
                        day: '2-digit',
                      }).replace(/\.$/, '')}
                      readOnly
                      className="w-full px-4 py-2 border rounded-lg"
                      style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                    />
                  </div>
                )}

                {selectedInquiry.answer && (
                  <div>
                    <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                      답변 내용
                    </label>
                    <textarea
                      value={selectedInquiry.answer}
                      readOnly
                      rows={4}
                      className="w-full px-4 py-2 border rounded-lg"
                      style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000', resize: 'none' }}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                    {selectedInquiry.answer ? '답변 수정' : '답변 작성'}
                  </label>
                  <textarea
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    rows={4}
                    placeholder="답변 내용을 입력해주세요."
                    className="w-full px-4 py-2 border rounded-lg"
                    style={{ borderColor: '#E5E5E5', color: '#000000', backgroundColor: '#FFFFFF', resize: 'none' }}
                  />
                </div>
              </div>
            </div>
            <div className="flex-shrink-0 pt-4">
              <button
                onClick={handleAnswer}
                className="w-full px-4 py-3 rounded-lg font-semibold"
                style={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
              >
                답변하기
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
