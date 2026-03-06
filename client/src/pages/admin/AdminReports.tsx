/**
 * 유저 리포트 관리 페이지
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../utils/api';
import type { Session, PhaseMeta } from '@noilink/shared';
import Pagination from '../../components/Admin/Pagination';
import Modal from '../../components/Admin/Modal';

type ReportTab = 'personal' | 'corporate';
type CorporateViewMode = 'company-list' | 'employee-list';

interface ReportData {
  id: string;
  userId: string;
  userName: string;
  userEmail?: string;
  userPhone?: string;
  userType: 'PERSONAL' | 'ORGANIZATION';
  organizationName?: string;
  session: Session;
  setCount: number;
  setTime: number;
  difficulty: string;
  progressTime: number;
  errorCount: number;
  touchCount: number;
}

interface CompanyData {
  name: string;
  memberCount: number;
  lastActivity?: string;
  members: ReportData[];
}

export default function AdminReports() {
  const [activeTab, setActiveTab] = useState<ReportTab>('personal');
  const [reports, setReports] = useState<ReportData[]>([]);
  const [filteredReports, setFilteredReports] = useState<ReportData[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [trainingType, setTrainingType] = useState<string>('all');
  const [selectedReport, setSelectedReport] = useState<ReportData | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // 기업 리포트 관련 상태
  const [corporateViewMode, setCorporateViewMode] = useState<CorporateViewMode>('company-list');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyData[]>([]);
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('');

  const itemsPerPage = 10;

  useEffect(() => {
    loadReports();
  }, []);

  useEffect(() => {
    if (activeTab === 'personal' || (activeTab === 'corporate' && corporateViewMode === 'employee-list')) {
      filterReports();
    }
  }, [reports, activeTab, searchQuery, trainingType, companies, corporateViewMode, employeeSearchQuery]);
  
  // 기업 리포트 탭으로 전환 시 기업 목록으로 리셋
  useEffect(() => {
    if (activeTab === 'corporate') {
      setCorporateViewMode('company-list');
      setSelectedCompany(null);
      setEmployeeSearchQuery('');
      setCurrentPage(1);
    }
  }, [activeTab]);

  // 드롭다운 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    setTotalPages(Math.ceil(filteredReports.length / itemsPerPage));
  }, [filteredReports]);

  const loadReports = async () => {
    try {
      setLoading(true);
      // 세션 데이터 로드
      const sessionsResponse = await api.getAdminSessions({ limit: 1000 });
      const usersResponse = await api.getAdminUsers({ limit: 1000 });

      if (sessionsResponse.success && sessionsResponse.data && usersResponse.success && usersResponse.data) {
        const sessions = sessionsResponse.data;
        const users = usersResponse.data;

        const reportData: ReportData[] = sessions
          .map(session => {
            const user = users.find(u => u.id === session.userId);
            const userType = user?.userType;
            // ADMIN 타입은 제외
            if (userType === 'ADMIN') {
              return null;
            }
            const validUserType = (userType === 'PERSONAL' || userType === 'ORGANIZATION') ? userType : 'PERSONAL';
            return {
              id: session.id,
              userId: session.userId,
              userName: user?.name || 'Unknown',
              userEmail: user?.email,
              userPhone: user?.phone,
              organizationName: user?.organizationName,
              userType: validUserType,
              session,
              setCount: session.phases?.length || 0,
              setTime: session.duration / 1000, // ms to seconds
              difficulty: `Level ${session.level}`,
              progressTime: session.duration / 1000,
              errorCount: session.phases?.reduce((sum: number, p: PhaseMeta) => sum + (p.missCount || 0), 0) || 0,
              touchCount: session.phases?.reduce((sum: number, p: PhaseMeta) => sum + (p.tickCount || 0), 0) || 0,
            } as ReportData;
          })
          .filter((r): r is ReportData => r !== null);

        setReports(reportData);
        
        // 기업별 그룹화 (승인 완료된 기업회원만)
        const approvedOrgReports = reportData.filter(r => 
          r.userType === 'ORGANIZATION' && 
          users.find(u => u.id === r.userId)?.approvalStatus === 'APPROVED'
        );
        
        const companyMap = new Map<string, CompanyData>();
        approvedOrgReports.forEach(report => {
          const orgName = report.organizationName || 'Unknown';
          if (!companyMap.has(orgName)) {
            companyMap.set(orgName, {
              name: orgName,
              memberCount: 0,
              members: [],
            });
          }
          const company = companyMap.get(orgName)!;
          if (!company.members.find(m => m.userId === report.userId)) {
            company.memberCount++;
          }
          company.members.push(report);
          
          // 최근 활동 날짜 업데이트
          const sessionDate = new Date(report.session.createdAt || '');
          if (!company.lastActivity || sessionDate > new Date(company.lastActivity)) {
            company.lastActivity = sessionDate.toISOString();
          }
        });
        
        setCompanies(Array.from(companyMap.values()));
      }
    } catch (error) {
      console.error('Failed to load reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterReports = () => {
    let filtered = [...reports];

    // 탭별 필터링
    if (activeTab === 'personal') {
      filtered = filtered.filter(r => r.userType === 'PERSONAL');
    } else if (activeTab === 'corporate') {
      // 기업 리포트는 승인 완료된 기업회원만 표시
      filtered = filtered.filter(r => {
        if (r.userType !== 'ORGANIZATION') return false;
        // loadReports에서 이미 승인 완료된 기업회원만 companies에 포함되므로
        // companies에 있는 기업의 리포트만 표시
        return companies.some(c => c.name === r.organizationName);
      });
    }

    // 검색 필터링
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      if (activeTab === 'corporate' && corporateViewMode === 'company-list') {
        // 기업명 검색
        filtered = filtered.filter(r => 
          r.organizationName?.toLowerCase().includes(query)
        );
      } else {
        filtered = filtered.filter(r => 
          r.userName.toLowerCase().includes(query)
        );
      }
    }

    // 트레이닝 종류 필터링
    if (trainingType !== 'all') {
      filtered = filtered.filter(r => r.session.mode === trainingType);
    }

    setFilteredReports(filtered);
    setCurrentPage(1);
  };

  const paginatedReports = filteredReports.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getTabCount = (tab: ReportTab) => {
    if (tab === 'personal') {
      return reports.filter(r => r.userType === 'PERSONAL').length;
    } else {
      return companies.length;
    }
  };
  
  // 선택된 기업의 직원 목록 필터링
  const getCompanyEmployees = () => {
    if (!selectedCompany) return [];
    const company = companies.find(c => c.name === selectedCompany);
    if (!company) return [];
    
    let employees = [...company.members];
    
    // 직원명 검색
    if (employeeSearchQuery.trim()) {
      const query = employeeSearchQuery.toLowerCase();
      employees = employees.filter(e => 
        e.userName.toLowerCase().includes(query)
      );
    }
    
    // 트레이닝 종류 필터링
    if (trainingType !== 'all') {
      employees = employees.filter(e => e.session.mode === trainingType);
    }
    
    // 중복 제거 (같은 유저의 리포트는 하나만 표시)
    const uniqueEmployees = new Map<string, ReportData>();
    employees.forEach(e => {
      if (!uniqueEmployees.has(e.userId)) {
        uniqueEmployees.set(e.userId, e);
      }
    });
    
    return Array.from(uniqueEmployees.values());
  };
  
  const companyEmployees = getCompanyEmployees();
  const paginatedEmployees = companyEmployees.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  const employeeTotalPages = Math.ceil(companyEmployees.length / itemsPerPage);

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2" style={{ color: '#000000' }}>
          유저 리포트 관리
        </h1>
        <p className="text-sm" style={{ color: '#666666' }}>
          전체 유저 정보를 확인할 수 있어요.
        </p>
      </div>

      {/* 탭 및 검색 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-4">
          <button
            onClick={() => setActiveTab('personal')}
            className={`px-4 py-2 font-semibold ${
              activeTab === 'personal' ? 'border-b-2' : ''
            }`}
            style={{
              color: activeTab === 'personal' ? '#000000' : '#666666',
              borderColor: activeTab === 'personal' ? '#000000' : 'transparent',
            }}
          >
            개인별 리포트 {getTabCount('personal')}
          </button>
          <button
            onClick={() => setActiveTab('corporate')}
            className={`px-4 py-2 font-semibold ${
              activeTab === 'corporate' ? 'border-b-2' : ''
            }`}
            style={{
              color: activeTab === 'corporate' ? '#000000' : '#666666',
              borderColor: activeTab === 'corporate' ? '#000000' : 'transparent',
            }}
          >
            기업 리포트 {getTabCount('corporate')}
          </button>
        </div>
        {/* 검색창 및 필터 */}
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
              placeholder="유저명, 기업명 등 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 border rounded-lg"
              style={{ borderColor: '#E5E5E5', color: '#000000', width: '300px' }}
            />
          </div>
          {/* 트레이닝 종류 드롭다운 */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="px-4 py-2 border rounded-lg flex items-center justify-between"
              style={{ 
                borderColor: '#E5E5E5', 
                color: '#000000',
                backgroundColor: '#FFFFFF',
                minWidth: '150px'
              }}
            >
              <span>
                {trainingType === 'all' ? '트레이닝 종류' : 
                 trainingType === 'COMPOSITE' ? '좌우 통합' :
                 trainingType === 'FREE' ? '랜덤' :
                 trainingType === 'MEMORY' ? '시퀀스' :
                 trainingType === 'FOCUS' ? '포커스' : '트레이닝 종류'}
              </span>
              <svg
                className={`w-4 h-4 ml-2 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <AnimatePresence>
              {isDropdownOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg z-50 overflow-hidden"
                  style={{ minWidth: '150px', boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)' }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setTrainingType('COMPOSITE');
                      setIsDropdownOpen(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                    style={{ color: '#000000' }}
                  >
                    <span>좌우 통합</span>
                    {trainingType === 'COMPOSITE' && (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTrainingType('FREE');
                      setIsDropdownOpen(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                    style={{ color: '#000000' }}
                  >
                    <span>랜덤</span>
                    {trainingType === 'FREE' && (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTrainingType('MEMORY');
                      setIsDropdownOpen(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                    style={{ color: '#000000' }}
                  >
                    <span>시퀀스</span>
                    {trainingType === 'MEMORY' && (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTrainingType('FOCUS');
                      setIsDropdownOpen(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between"
                    style={{ color: '#000000' }}
                  >
                    <span>포커스</span>
                    {trainingType === 'FOCUS' && (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* 기업 리포트 - 기업 목록 또는 직원 목록 */}
      {activeTab === 'corporate' && corporateViewMode === 'employee-list' && (
        <div className="mb-4">
          <button
            onClick={() => {
              setCorporateViewMode('company-list');
              setSelectedCompany(null);
              setEmployeeSearchQuery('');
            }}
            className="flex items-center gap-2 text-sm"
            style={{ color: '#666666' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>기업 리포트</span>
          </button>
          <div className="mt-2 flex items-center gap-3">
            <div className="text-xl">🏢</div>
            <h2 className="text-xl font-bold" style={{ color: '#000000' }}>
              {selectedCompany}
            </h2>
          </div>
          <p className="text-sm mt-1" style={{ color: '#666666' }}>
            기업별 트레이닝 현황을 한눈에 확인할 수 있어요.
          </p>
        </div>
      )}

      {/* 테이블 */}
      {loading ? (
        <div className="flex items-center justify-center" style={{ color: '#666666', minHeight: '60vh' }}>
          로딩 중...
        </div>
      ) : activeTab === 'corporate' && corporateViewMode === 'company-list' ? (
        // 기업 목록 테이블
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: '#E5E5E5' }}>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    기업명
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    인원 수
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    최근 활동
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    기업 리포트
                  </th>
                </tr>
              </thead>
              <tbody>
                {companies.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12">
                      <div className="flex flex-col items-center justify-center" style={{ color: '#666666', minHeight: '400px' }}>
                        <div className="mb-4 text-4xl">📄</div>
                        <div>기업 리포트 정보가 존재하지 않습니다.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  companies
                    .filter(c => !searchQuery.trim() || c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                    .map((company) => (
                      <tr key={company.name} className="border-b hover:bg-gray-50" style={{ borderColor: '#E5E5E5' }}>
                        <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                          {company.name}
                        </td>
                        <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                          {company.memberCount}명
                        </td>
                        <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                          {company.lastActivity 
                            ? new Date(company.lastActivity).toLocaleDateString('ko-KR', {
                                year: '2-digit',
                                month: '2-digit',
                                day: '2-digit',
                              }).replace(/\.$/, '')
                            : '-'}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={() => {
                              setSelectedCompany(company.name);
                              setCorporateViewMode('employee-list');
                              setCurrentPage(1);
                            }}
                            className="px-4 py-2 border rounded-lg text-sm"
                            style={{ borderColor: '#E5E5E5', color: '#000000' }}
                          >
                            보러가기
                          </button>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
          {companies.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(companies.filter(c => !searchQuery.trim() || c.name.toLowerCase().includes(searchQuery.toLowerCase())).length / itemsPerPage)}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      ) : activeTab === 'corporate' && corporateViewMode === 'employee-list' ? (
        // 직원 목록 테이블
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: '#E5E5E5' }}>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    직원명
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    세트 수
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    세트 시간
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    난이도
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    진행 시간
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    오류 횟수
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    터치 횟수
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    관리
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12">
                      <div className="flex flex-col items-center justify-center" style={{ color: '#666666', minHeight: '400px' }}>
                        <div className="mb-4 text-4xl">📄</div>
                        <div>직원 리포트 정보가 존재하지 않습니다.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedEmployees.map((report) => (
                    <tr key={report.id} className="border-b hover:bg-gray-50" style={{ borderColor: '#E5E5E5' }}>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.userName}
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.setCount}
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.setTime}초
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.difficulty === 'Level 1' ? '쉬움' : report.difficulty === 'Level 2' ? '보통' : '어려움'}
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.progressTime}초
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.errorCount}회
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.touchCount}회
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => {
                            setSelectedReport(report);
                            setShowDetailModal(true);
                          }}
                          className="px-4 py-2 border rounded-lg text-sm"
                          style={{ borderColor: '#E5E5E5', color: '#000000' }}
                        >
                          상세보기
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {paginatedEmployees.length > 0 && (
            <Pagination
              currentPage={currentPage}
              totalPages={employeeTotalPages}
              onPageChange={setCurrentPage}
            />
          )}
        </>
      ) : (
        // 개인 리포트 테이블
        <>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b" style={{ borderColor: '#E5E5E5' }}>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    유저명
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    세트 수
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    세트 시간
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    난이도
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    진행시간
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    오류 횟수
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    터치 횟수
                  </th>
                  <th className="px-6 py-4 text-center text-sm font-semibold" style={{ color: '#767676', backgroundColor: '#F5F5F5' }}>
                    개인 리포트
                  </th>
                </tr>
              </thead>
              <tbody>
                {paginatedReports.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-12">
                      <div className="flex flex-col items-center justify-center" style={{ color: '#666666', minHeight: '400px' }}>
                        <div className="mb-4 text-4xl">📄</div>
                        <div>유저 리포트 정보가 존재하지 않습니다.</div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedReports.map((report) => (
                    <tr key={report.id} className="border-b hover:bg-gray-50" style={{ borderColor: '#E5E5E5' }}>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.userName}
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.setCount}
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.setTime}초
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.difficulty === 'Level 1' ? '쉬움' : report.difficulty === 'Level 2' ? '보통' : '어려움'}
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.progressTime}초
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.errorCount}회
                      </td>
                      <td className="px-6 py-4 text-sm text-center" style={{ color: '#000000' }}>
                        {report.touchCount}회
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => {
                            setSelectedReport(report);
                            setShowDetailModal(true);
                          }}
                          className="px-4 py-2 border rounded-lg text-sm"
                          style={{ borderColor: '#E5E5E5', color: '#000000' }}
                        >
                          상세보기
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {paginatedReports.length > 0 && (
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
        {selectedReport && (
          <div className="flex flex-col" style={{ height: 'calc(100vh - 160px)' }}>
            <div className="flex-1 overflow-y-auto space-y-6 pr-2">
              {selectedReport.userType === 'ORGANIZATION' && selectedReport.organizationName && (
                <div>
                  <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                    기업명
                  </label>
                  <input
                    type="text"
                    value={selectedReport.organizationName}
                    readOnly
                    className="w-full px-4 py-2 border rounded-lg"
                    style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  {selectedReport.userType === 'ORGANIZATION' ? '직원명' : '유저명'}
                </label>
                <input
                  type="text"
                  value={selectedReport.userName}
                  readOnly
                  className="w-full px-4 py-2 border rounded-lg"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  이메일
                </label>
                <input
                  type="text"
                  value={selectedReport.userEmail || '-'}
                  readOnly
                  className="w-full px-4 py-2 border rounded-lg"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  휴대폰 번호
                </label>
                <input
                  type="text"
                  value={selectedReport.userPhone || '-'}
                  readOnly
                  className="w-full px-4 py-2 border rounded-lg"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  트레이닝 종류
                </label>
                <input
                  type="text"
                  value={
                    selectedReport.session.mode === 'COMPOSITE' ? '좌우 통합' :
                    selectedReport.session.mode === 'FREE' ? '랜덤' :
                    selectedReport.session.mode === 'MEMORY' ? '시퀀스' :
                    selectedReport.session.mode === 'FOCUS' ? '포커스' :
                    selectedReport.session.mode
                  }
                  readOnly
                  className="w-full px-4 py-2 border rounded-lg"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  세트 수
                </label>
                <input
                  type="text"
                  value={selectedReport.setCount}
                  readOnly
                  className="w-full px-4 py-2 border rounded-lg"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  세트 시간
                </label>
                <input
                  type="text"
                  value={`${Math.round(selectedReport.setTime)} 조`}
                  readOnly
                  className="w-full px-4 py-2 border rounded-lg"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  난이도
                </label>
                <input
                  type="text"
                  value={selectedReport.difficulty === 'Level 1' ? '쉬움' : selectedReport.difficulty === 'Level 2' ? '보통' : '어려움'}
                  readOnly
                  className="w-full px-4 py-2 border rounded-lg"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  진행 시간
                </label>
                <input
                  type="text"
                  value={`${Math.round(selectedReport.progressTime)} 조`}
                  readOnly
                  className="w-full px-4 py-2 border rounded-lg"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  오류 횟수
                </label>
                <input
                  type="text"
                  value={`${selectedReport.errorCount} 회`}
                  readOnly
                  className="w-full px-4 py-2 border rounded-lg"
                  style={{ backgroundColor: '#F5F5F5', borderColor: '#E5E5E5', color: '#000000' }}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2" style={{ color: '#000000' }}>
                  터치 횟수
                </label>
                <input
                  type="text"
                  value={`${selectedReport.touchCount} 회`}
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
    </div>
  );
}
