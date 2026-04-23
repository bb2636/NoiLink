/**
 * 배너 관리 페이지
 */
import { useState, useEffect, useRef } from 'react';
import api from '../../utils/api';
import Pagination from '../../components/Admin/Pagination';
import Modal from '../../components/Admin/Modal';
import ConfirmModal from '../../components/ConfirmModal/ConfirmModal';
import SuccessBanner from '../../components/SuccessBanner/SuccessBanner';
import { placeholderImage, fallbackImg } from '../../utils/imagePlaceholder';

interface Banner {
  id: string;
  title: string;
  imageUrl: string;
  thumbnailUrl?: string;
  createdAt: string;
  order?: number;
}

export default function AdminBanners() {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [filteredBanners, setFilteredBanners] = useState<Banner[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedBanner, setSelectedBanner] = useState<Banner | null>(null);
  const [newBanner, setNewBanner] = useState({ title: '', image: null as File | null });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [bannerToDelete, setBannerToDelete] = useState<Banner | null>(null);
  const [showDeleteToast, setShowDeleteToast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const LONG_PRESS_MS = 500;

  const itemsPerPage = 10;

  useEffect(() => {
    loadBanners();
  }, []);

  useEffect(() => {
    filterBanners();
  }, [banners, searchQuery]);

  useEffect(() => {
    setTotalPages(Math.ceil(filteredBanners.length / itemsPerPage));
  }, [filteredBanners]);

  // 전역 마우스/터치 이벤트 리스너
  useEffect(() => {
    if (draggedIndex === null) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (draggedIndex === null) return;
      
      const rows = document.querySelectorAll('tbody tr');
      let targetIndex = draggedIndex;
      
      rows.forEach((row, index) => {
        const rect = row.getBoundingClientRect();
        const globalIdx = (currentPage - 1) * itemsPerPage + index;
        
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const deltaY = e.clientY - (rect.top + rect.height / 2);
          if (deltaY > 0 && globalIdx < filteredBanners.length - 1) {
            targetIndex = globalIdx + 1;
          } else if (deltaY < 0 && globalIdx > 0) {
            targetIndex = globalIdx - 1;
          } else {
            targetIndex = globalIdx;
          }
        }
      });

      if (targetIndex !== draggedIndex && targetIndex >= 0 && targetIndex < filteredBanners.length) {
        const newBanners = [...filteredBanners];
        const [removed] = newBanners.splice(draggedIndex, 1);
        newBanners.splice(targetIndex, 0, removed);
        
        const updatedBanners = newBanners.map((banner, idx) => ({
          ...banner,
          order: idx,
        }));
        
        setBanners(updatedBanners);
        setFilteredBanners(updatedBanners);
        setDraggedIndex(targetIndex);
        updateBannerOrder(updatedBanners);
      }
    };

    const handleGlobalMouseUp = () => {
      handleDragEnd();
    };

    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (draggedIndex === null || e.touches.length === 0) return;
      
      const touch = e.touches[0];
      const rows = document.querySelectorAll('tbody tr');
      let targetIndex = draggedIndex;
      
      rows.forEach((row, index) => {
        const rect = row.getBoundingClientRect();
        const globalIdx = (currentPage - 1) * itemsPerPage + index;
        
        if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
          const deltaY = touch.clientY - (rect.top + rect.height / 2);
          if (deltaY > 0 && globalIdx < filteredBanners.length - 1) {
            targetIndex = globalIdx + 1;
          } else if (deltaY < 0 && globalIdx > 0) {
            targetIndex = globalIdx - 1;
          } else {
            targetIndex = globalIdx;
          }
        }
      });

      if (targetIndex !== draggedIndex && targetIndex >= 0 && targetIndex < filteredBanners.length) {
        const newBanners = [...filteredBanners];
        const [removed] = newBanners.splice(draggedIndex, 1);
        newBanners.splice(targetIndex, 0, removed);
        
        const updatedBanners = newBanners.map((banner, idx) => ({
          ...banner,
          order: idx,
        }));
        
        setBanners(updatedBanners);
        setFilteredBanners(updatedBanners);
        setDraggedIndex(targetIndex);
        updateBannerOrder(updatedBanners);
      }
    };

    const handleGlobalTouchEnd = () => {
      handleDragEnd();
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchmove', handleGlobalTouchMove);
    window.addEventListener('touchend', handleGlobalTouchEnd);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchmove', handleGlobalTouchMove);
      window.removeEventListener('touchend', handleGlobalTouchEnd);
    };
  }, [draggedIndex, filteredBanners, currentPage, itemsPerPage]);

  const loadBanners = async () => {
    try {
      setLoading(true);
      const response = await api.getAdminBanners();
      if (response.success && response.data) {
        setBanners(response.data);
      }
    } catch (error) {
      console.error('Failed to load banners:', error);
      // 임시 데이터
      setBanners([]);
    } finally {
      setLoading(false);
    }
  };

  const filterBanners = () => {
    let filtered = [...banners];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(b => 
        b.title.toLowerCase().includes(query)
      );
    }

    setFilteredBanners(filtered);
    setCurrentPage(1);
  };

  const validateImageFile = (file: File): boolean => {
    const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
    const fileName = file.name.toLowerCase();
    const extension = fileName.substring(fileName.lastIndexOf('.'));
    return allowedExtensions.includes(extension);
  };

  const handleRegister = async () => {
    if (!newBanner.title.trim() || !newBanner.image) {
      alert('제목과 이미지를 입력해주세요.');
      return;
    }

    if (!validateImageFile(newBanner.image)) {
      alert('이미지 파일만 업로드 가능합니다. (PNG, JPG, JPEG, GIF, WEBP, BMP)');
      return;
    }

    try {
      // 이미지를 base64로 변환
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64String = reader.result as string;
          
          const response = await fetch('/api/admin/banners', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('noilink_token')}`,
            },
            body: JSON.stringify({
              title: newBanner.title,
              imageBase64: base64String,
            }),
          });

          if (response.ok) {
            await loadBanners();
            setShowRegisterModal(false);
            setNewBanner({ title: '', image: null });
          } else {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            alert(errorData.error || '배너 등록에 실패했습니다.');
          }
        } catch (error) {
          console.error('Failed to register banner:', error);
          alert('배너 등록에 실패했습니다.');
        }
      };
      
      reader.onerror = () => {
        alert('이미지 읽기에 실패했습니다.');
      };
      
      reader.readAsDataURL(newBanner.image);
    } catch (error) {
      console.error('Failed to register banner:', error);
      alert('배너 등록에 실패했습니다.');
    }
  };

  const handleDeleteClick = (banner: Banner, e: React.MouseEvent) => {
    e.stopPropagation();
    setBannerToDelete(banner);
    setShowDeleteModal(true);
  };

  const handleDeleteBanner = async () => {
    if (!bannerToDelete) return;

    try {
      const response = await api.get(`/admin/banners/${bannerToDelete.id}/delete`);
      if (response.success) {
        await loadBanners();
        setShowDeleteModal(false);
        setBannerToDelete(null);
        setShowDeleteToast(true);
      }
    } catch (error) {
      console.error('Failed to delete banner:', error);
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePressStart = (index: number, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      setDraggedIndex(index);
    }, LONG_PRESS_MS);
  };

  const handlePressEnd = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    clearLongPressTimer();
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    dragStartPos.current = null;
  };


  const updateBannerOrder = async (banners: Banner[]) => {
    try {
      // 각 배너의 order를 서버에 업데이트
      await Promise.all(
        banners.map((banner, index) =>
          fetch(`/api/admin/banners/${banner.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('noilink_token')}`,
            },
            body: JSON.stringify({ order: index }),
          })
        )
      );
    } catch (error) {
      console.error('Failed to update banner order:', error);
    }
  };

  const paginatedBanners = filteredBanners.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="p-8">
      {/* 배너 삭제 토스트 알림 */}
      <SuccessBanner
        isOpen={showDeleteToast}
        message="배너가 삭제되었습니다."
        onClose={() => setShowDeleteToast(false)}
        autoClose={true}
        duration={3000}
        backgroundColor="#666666"
        textColor="#FFFFFF"
      />
      
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2" style={{ color: '#000000' }}>
          배너 관리
        </h1>
        <p className="text-sm" style={{ color: '#666666' }}>
          전체 배너 정보를 확인할 수 있어요.
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
            배너 {banners.length}
          </button>
        </div>
        {/* 검색창 및 등록 버튼 */}
        <div className="flex items-center gap-4">
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
              placeholder="배너 제목 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 px-4 py-2 pl-10 border rounded-lg"
              style={{ borderColor: '#E5E5E5', color: '#000000' }}
            />
          </div>
          <button
            onClick={() => setShowRegisterModal(true)}
            className="px-6 py-2 rounded-lg font-semibold"
            style={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
          >
            배너 등록
          </button>
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
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5', width: '50px' }}>
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    썸네일
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    등록일
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    제목
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    관리
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    권한처리
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedBanners.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12">
                      <div className="flex flex-col items-center justify-center" style={{ color: '#666666', minHeight: '400px' }}>
                        <div className="mb-4 text-4xl">📄</div>
                        <div>배너 정보가 존재하지 않습니다.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedBanners.map((banner, index) => {
                    const globalIndex = (currentPage - 1) * itemsPerPage + index;
                    return (
                      <tr
                        key={banner.id}
                        className="border-b hover:bg-gray-50"
                        style={{ 
                          borderColor: '#E5E5E5',
                          opacity: draggedIndex === globalIndex ? 0.5 : 1,
                        }}
                      >
                        {/* 드래그 핸들 - 꾹 눌러서 드래그 활성화 */}
                        <td 
                          className="px-2 py-4 text-center cursor-move select-none"
                          onMouseDown={(e) => handlePressStart(globalIndex, e)}
                          onMouseUp={handlePressEnd}
                          onMouseLeave={handlePressEnd}
                          onTouchStart={(e) => handlePressStart(globalIndex, e)}
                          onTouchEnd={handlePressEnd}
                          onTouchCancel={handlePressEnd}
                          style={{ userSelect: 'none' }}
                          title={`${LONG_PRESS_MS / 1000}초 이상 눌러서 순서 변경`}
                        >
                          <div className="flex flex-col items-center gap-1" style={{ color: '#999999' }}>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                              <circle cx="2" cy="2" r="1" />
                              <circle cx="6" cy="2" r="1" />
                              <circle cx="10" cy="2" r="1" />
                              <circle cx="2" cy="6" r="1" />
                              <circle cx="6" cy="6" r="1" />
                              <circle cx="10" cy="6" r="1" />
                              <circle cx="2" cy="10" r="1" />
                              <circle cx="6" cy="10" r="1" />
                              <circle cx="10" cy="10" r="1" />
                            </svg>
                          </div>
                        </td>
                        {/* 썸네일 */}
                        <td className="px-4 py-4 text-center">
                          <img
                            src={banner.imageUrl || banner.thumbnailUrl || placeholderImage(banner.id || banner.title, banner.title)}
                            onError={fallbackImg(banner.id || banner.title, banner.title)}
                            alt={banner.title}
                            className="w-12 h-12 rounded object-cover mx-auto"
                          />
                        </td>
                        {/* 등록일 */}
                        <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                          {new Date(banner.createdAt).toLocaleDateString('ko-KR', {
                            year: '2-digit',
                            month: '2-digit',
                            day: '2-digit',
                          }).replace(/\.$/, '')}
                        </td>
                        {/* 제목 */}
                        <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                          {banner.title}
                        </td>
                        {/* 관리 */}
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBanner(banner);
                              setShowDetailModal(true);
                            }}
                            className="px-4 py-2 border rounded-lg text-sm"
                            style={{ borderColor: '#E5E5E5', color: '#000000' }}
                          >
                            상세보기
                          </button>
                        </td>
                        {/* 권한처리 */}
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={(e) => handleDeleteClick(banner, e)}
                            className="px-4 py-2 rounded text-sm font-semibold"
                            style={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
                          >
                            배너삭제
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {paginatedBanners.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      )}

      {/* 배너 등록 모달 */}
      <Modal
        isOpen={showRegisterModal}
        onClose={() => {
          setShowRegisterModal(false);
          setNewBanner({ title: '', image: null });
        }}
        title="배너 등록"
        width="500px"
        position="right"
      >
        <div className="flex flex-col" style={{ height: 'calc(100vh - 160px)' }}>
          <div className="flex-1 overflow-y-auto space-y-6 pr-2">
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                제목
              </label>
              <input
                type="text"
                placeholder="배너의 제목을 입력해 주세요."
                value={newBanner.title}
                onChange={(e) => setNewBanner({ ...newBanner, title: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
                style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                이미지 등록
              </label>
              {!newBanner.image ? (
                <div className="relative">
                  <input
                    type="text"
                    readOnly
                    placeholder="이미지 업로드 * 30MB 이하 (PNG, JPG 지원)"
                    className="w-full px-4 py-2 border rounded-lg pr-20"
                    style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#999999' }}
                  />
                  <label className="absolute right-2 top-1/2 transform -translate-y-1/2 px-4 py-1 border rounded-lg cursor-pointer text-sm" style={{ borderColor: '#767676', color: '#000000' }}>
                    업로드
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (!validateImageFile(file)) {
                            alert('이미지 파일만 업로드 가능합니다. (PNG, JPG, JPEG, GIF, WEBP, BMP)');
                            return;
                          }
                          setNewBanner({ ...newBanner, image: file });
                        }
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-3 p-3 border rounded-lg" style={{ borderColor: '#E5E5E5', backgroundColor: '#FFFFFF' }}>
                  <img
                    src={URL.createObjectURL(newBanner.image)}
                    alt="미리보기"
                    className="w-12 h-12 rounded object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: '#000000' }}>
                      {newBanner.image.name}
                    </div>
                    <div className="text-xs" style={{ color: '#999999' }}>
                      {(newBanner.image.size / 1024 / 1024).toFixed(1)}MB
                    </div>
                  </div>
                  <button
                    onClick={() => setNewBanner({ ...newBanner, image: null })}
                    className="flex-shrink-0 p-2 hover:bg-gray-100 rounded"
                    style={{ color: '#666666' }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex-shrink-0 pt-6">
            <button
              onClick={handleRegister}
              disabled={!newBanner.title.trim() || !newBanner.image}
              className="w-full px-4 py-3 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              style={{ 
                backgroundColor: '#F5F5F5', 
                color: (!newBanner.title.trim() || !newBanner.image) ? '#999999' : '#000000'
              }}
            >
              등록하기
            </button>
          </div>
        </div>
      </Modal>

      {/* 상세보기 모달 */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        title="상세보기"
        width="500px"
        position="right"
      >
        {selectedBanner && (
          <div className="flex flex-col" style={{ height: 'calc(100vh - 160px)' }}>
            <div className="flex-1 overflow-y-auto space-y-6 pr-2">
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  등록일
                </label>
                <input
                  type="text"
                  value={new Date(selectedBanner.createdAt).toLocaleDateString('ko-KR', {
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
                  이미지
                </label>
                <img
                  src={selectedBanner.imageUrl || selectedBanner.thumbnailUrl || placeholderImage(selectedBanner.id || selectedBanner.title, selectedBanner.title)}
                  onError={fallbackImg(selectedBanner.id || selectedBanner.title, selectedBanner.title)}
                  alt={selectedBanner.title}
                  className="w-full rounded-lg object-cover"
                  style={{ maxHeight: '400px' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  제목
                </label>
                <input
                  type="text"
                  value={selectedBanner.title}
                  readOnly
                  className="w-full px-4 py-2 border rounded-lg"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                />
              </div>
            </div>
            <div className="flex-shrink-0 pt-6">
              <button
                onClick={() => setShowDetailModal(false)}
                className="w-full px-4 py-3 rounded-lg font-semibold"
                style={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
              >
                완료
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 배너 삭제 확인 모달 */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onCancel={() => {
          setShowDeleteModal(false);
          setBannerToDelete(null);
        }}
        onConfirm={handleDeleteBanner}
        title="배너를 삭제시키겠어요?"
        message={
          <>
            배너를 삭제하시겠습니까? <br />
            삭제된 배너는 복구할 수 없습니다.
          </>
        }
        confirmText="삭제"
        cancelText="취소"
        confirmButtonStyle={{ backgroundColor: '#2A2A2A', color: '#FFFFFF' }}
        cancelButtonStyle={{ backgroundColor: '#E5E5E5', color: '#000000' }}
        modalStyle={{ backgroundColor: '#FFFFFF', titleColor: '#000000', messageColor: '#000000' }}
      />
    </div>
  );
}
