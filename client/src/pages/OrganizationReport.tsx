/**
 * 기관 리포트 — 단순화 버전
 *
 * 과거: 935줄의 5탭(전체/6대 지표/브레이니멀/종합평가/소속 인원) UI 가 통째로
 *       MOCK_REPORT / MOCK_TREND / MOCK_MEMBERS 하드코딩 데이터에 의존했다.
 *       기업 관리자가 보는 모든 수치(평균 뇌나이 79.9, FOX_BALANCED 25% 등)와
 *       소속 인원 15명이 전부 가짜였다.
 *
 * 현재: 실제 기관 인사이트 리포트 API(`GET /api/reports/organization/:organizationId`)
 *       를 호출하고, 응답이 없으면 "아직 기관 리포트가 없어요" 안내만 노출한다.
 *       UI 컴포넌트는 실 데이터 스키마가 안정화된 뒤 단계적으로 복원한다.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import type { OrganizationInsightReport } from '@noilink/shared';

export default function OrganizationReport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [report, setReport] = useState<OrganizationInsightReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user?.organizationId) {
        setLoading(false);
        return;
      }
      try {
        const res = await api.get<OrganizationInsightReport>(
          `/reports/organization/${user.organizationId}`,
        );
        if (cancelled) return;
        if (res.success && res.data) setReport(res.data);
      } catch {
        /* 실패해도 빈 상태로 표시 */
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.organizationId]);

  if (!user) return null;

  // 기업 리포트는 기업 관리자(ORGANIZATION) 전용
  if (user.userType !== 'ORGANIZATION' || !user.organizationId) {
    return (
      <div
        className="px-4 py-10 text-center"
        style={{ color: '#fff', paddingTop: 'calc(2.5rem + env(safe-area-inset-top))' }}
      >
        <p className="text-base font-semibold mb-2">접근 권한이 없습니다</p>
        <p className="text-sm text-gray-400 mb-6">
          기업 리포트는 기업 관리자만 볼 수 있습니다.
        </p>
        <button
          type="button"
          onClick={() => navigate('/profile')}
          className="px-6 py-2 rounded-full text-sm font-semibold"
          style={{ backgroundColor: '#AAED10', color: '#000' }}
        >
          마이페이지로
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="flex items-center justify-center min-h-[50vh]"
        style={{ color: '#999', paddingTop: 'env(safe-area-inset-top)' }}
      >
        로딩 중...
      </div>
    );
  }

  const orgName = user.organizationName ?? '소속 기관';

  if (!report) {
    return (
      <div
        className="max-w-md mx-auto px-4"
        style={{
          backgroundColor: '#0A0A0A',
          minHeight: '70vh',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div className="flex items-center pt-4 pb-2">
          <svg
            className="w-5 h-5 mr-2 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          <h1 className="text-[15px] font-semibold text-white">
            {orgName} 리포트
          </h1>
        </div>

        <div
          className="rounded-2xl p-5 mt-4"
          style={{ backgroundColor: '#1A1A1A', border: '1px solid #262626' }}
        >
          <div className="flex flex-col items-center text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: '#262626' }}
            >
              <svg
                className="w-7 h-7"
                fill="none"
                stroke="#AAED10"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 17v-6h13M9 11V5h13M3 6h.01M3 12h.01M3 18h.01"
                />
              </svg>
            </div>
            <h3 className="text-white font-semibold text-base mb-2">
              아직 기관 리포트가 없어요
            </h3>
            <p
              className="text-[13px] leading-relaxed mb-5"
              style={{ color: '#9CA3AF' }}
            >
              소속 인원이 트레이닝을 충분히 진행하면
              <br />
              평균 6대 지표·브레이니멀 분포·종합 평가가
              <br />
              자동으로 집계되어 표시됩니다.
            </p>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full py-3 rounded-xl font-medium text-[14px]"
              style={{
                backgroundColor: 'transparent',
                color: '#E5E7EB',
                border: '1px solid #2f2f2f',
              }}
            >
              홈으로
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 실 리포트 응답이 있는 경우 — 최소 카드 형태로 표시. 5탭 UI 복원은 별도 작업.
  return (
    <div
      className="px-4 pb-6 space-y-4"
      style={{
        paddingTop: 'calc(1.5rem + env(safe-area-inset-top))',
        paddingBottom: '120px',
        color: '#fff',
      }}
    >
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold">{report.organizationName} 리포트</h1>
      </div>

      <div
        className="rounded-2xl p-4"
        style={{ backgroundColor: '#1A1A1A', border: '1px solid #262626' }}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm" style={{ color: '#9CA3AF' }}>
            소속 인원
          </span>
          <span className="text-base font-semibold">
            {report.managedMemberCount}명
          </span>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm" style={{ color: '#9CA3AF' }}>
            평균 뇌나이
          </span>
          <span className="text-base font-semibold">
            {report.avgBrainAge.toFixed(1)}세
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm" style={{ color: '#9CA3AF' }}>
            대표 브레이니멀
          </span>
          <span className="text-base font-semibold">
            {report.representativeBrainimalLabel}
          </span>
        </div>
      </div>

      {report.factText && (
        <div
          className="rounded-2xl p-4"
          style={{ backgroundColor: '#1A1A1A', border: '1px solid #262626' }}
        >
          <h3 className="text-sm font-semibold mb-2">조직 특성</h3>
          <p className="text-[13px] leading-relaxed" style={{ color: '#D1D5DB' }}>
            {report.factText}
          </p>
        </div>
      )}
    </div>
  );
}
