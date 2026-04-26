import type { ApiResponse, User, Game, UserStats, RankingEntry, Terms, TermsType } from '@noilink/shared';
import { STORAGE_KEYS } from './constants';
import { clearAllDismissals as clearAllRecoveryCoachingDismissals } from './recoveryCoachingDismissal';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

/**
 * API 클라이언트 유틸리티
 */
class ApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      // headers 는 마지막에 둬야 한다 — options 를 뒤에 펼치면 (caller 가 headers 를
      // 넘긴 경우) 위에서 합쳐 둔 Authorization/Content-Type 이 다시 덮여 사라진다.
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        
        // 401 에러인 경우 토큰이 만료되었거나 유효하지 않을 수 있음
        if (response.status === 401) {
          // 토큰 제거하고 로그인 페이지로 리다이렉트
          localStorage.removeItem(STORAGE_KEYS.TOKEN);
          localStorage.removeItem(STORAGE_KEYS.USER_ID);
          localStorage.removeItem(STORAGE_KEYS.USERNAME);
          // Task #98 — 명시적 logout() 과 동일하게 회복 코칭 닫힘 기억도 비운다.
          // 같은 기기에서 다른 계정으로 다시 로그인했을 때 이전 사용자의 닫힘
          // 상태가 카드 노출을 막지 않도록.
          clearAllRecoveryCoachingDismissals();

          // 현재 페이지가 로그인 페이지가 아닐 때만 리다이렉트
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
        
        // 404 에러는 조용히 반환 (데이터가 없을 수 있음)
        if (response.status === 404) {
          return {
            success: false,
            error: errorData.error || 'Not found',
          };
        }
        
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const body = (await response.json()) as ApiResponse<T>;
      // 서버 idempotency 캐시 hit 신호(`X-Idempotent-Replayed: true`) 를 헤더에서
      // 읽어 응답 객체에 합쳐 둔다. 본문은 첫 응답과 동일하게 유지되도록 서버가
      // 의도적으로 변경하지 않으므로(회귀 보호 중), 신호는 헤더 → 객체 필드로만
      // 흘려보낸다. 호출부(예: 결과 저장)는 이 값을 보고 사용자에게 "이미 저장된
      // 결과를 불러왔어요" 같은 1회성 안내를 띄울 수 있다.
      if (response.headers.get('X-Idempotent-Replayed') === 'true') {
        body.replayed = true;
      }
      return body;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Users API
  async createUser(userData: { 
    username: string; 
    email?: string; 
    name?: string; 
    age?: number;
    password?: string;
    phone?: string;
    userType?: 'PERSONAL' | 'ORGANIZATION';
    deviceId?: string;
  }) {
    return this.request<User>('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    }) as Promise<ApiResponse<User> & { token?: string }>;
  }

  async getUser(userId: string) {
    return this.request<User>(`/users/${userId}`);
  }

  async updateUser(userId: string, userData: Partial<User>) {
    return this.request<User>(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
  }

  async getUserStats(userId: string) {
    return this.request<UserStats>(`/users/${userId}/stats`);
  }

  // Scores API
  async saveScore(scoreData: {
    userId: string;
    gameId: string;
    score: number;
    accuracy?: number;
    timeSpent?: number;
    level?: number;
  }) {
    return this.request<any>('/scores', {
      method: 'POST',
      body: JSON.stringify(scoreData),
    });
  }

  async getUserScores(userId: string) {
    return this.request<any[]>(`/scores/user/${userId}`);
  }

  async getGameScores(gameId: string, limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    return this.request<any[]>(`/scores/game/${gameId}${params}`);
  }

  // Training API
  async getGames() {
    return this.request<Game[]>('/training/games');
  }

  async getGame(gameId: string) {
    return this.request<Game>(`/training/games/${gameId}`);
  }
  
  // Home API
  async getCondition(userId: string) {
    return this.request<any>(`/home/condition/${userId}`);
  }
  
  async getMission(userId: string) {
    return this.request<any>(`/home/mission/${userId}`);
  }
  
  async getQuickStart(userId: string) {
    return this.request<any>(`/home/quickstart/${userId}`);
  }
  
  // Sessions API
  async createSession(sessionData: any, opts?: { idempotencyKey?: string }) {
    return this.request<any>('/sessions', {
      method: 'POST',
      body: JSON.stringify(sessionData),
      ...(opts?.idempotencyKey
        ? { headers: { 'Idempotency-Key': opts.idempotencyKey } }
        : {}),
    });
  }
  
  async getUserSessions(userId: string, options?: { limit?: number; mode?: string; isComposite?: boolean }) {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.mode) params.append('mode', options.mode);
    if (options?.isComposite !== undefined) params.append('isComposite', String(options.isComposite));
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<any[]>(`/sessions/user/${userId}${query}`);
  }
  
  // Metrics API
  async saveRawMetrics(rawMetrics: any, opts?: { idempotencyKey?: string }) {
    return this.request<any>('/metrics/raw', {
      method: 'POST',
      body: JSON.stringify(rawMetrics),
      ...(opts?.idempotencyKey
        ? { headers: { 'Idempotency-Key': opts.idempotencyKey } }
        : {}),
    });
  }
  
  async calculateMetrics(rawMetrics: any, opts?: { idempotencyKey?: string }) {
    return this.request<any>('/metrics/calculate', {
      method: 'POST',
      body: JSON.stringify(rawMetrics),
      ...(opts?.idempotencyKey
        ? { headers: { 'Idempotency-Key': opts.idempotencyKey } }
        : {}),
    });
  }
  
  // Reports API
  async generateReport(userId: string) {
    return this.request<any>('/reports/generate', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }
  
  async getUserReports(userId: string, limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    return this.request<any[]>(`/reports/user/${userId}${params}`);
  }

  async getOrganizationInsightReport(organizationId: string) {
    return this.request<any>(`/reports/organization/${organizationId}`);
  }

  async generateOrganizationInsightReport(organizationId: string) {
    return this.request<any>('/reports/organization/generate', {
      method: 'POST',
      body: JSON.stringify({ organizationId }),
    });
  }

  async getOrganizationSessionsForTrend(organizationId: string) {
    return this.request<any[]>(`/sessions/organization/${organizationId}/trend`);
  }
  
  // Rankings API
  async getRankings(type?: string, limit?: number, organizationId?: string) {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    if (limit) params.append('limit', String(limit));
    if (organizationId) params.append('organizationId', organizationId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<Record<string, RankingEntry[]>>(`/rankings${query}`);
  }
  
  // Generic GET method
  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint);
  }
  
  // Login API
  async login(email: string, password: string): Promise<ApiResponse<User> & { token?: string }> {
    const response = await fetch(`${API_BASE_URL}/users/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      return {
        success: false,
        error: error.error || `HTTP error! status: ${response.status}`,
      };
    }

    return await response.json();
  }

  // Terms API
  async getTerms(type?: TermsType): Promise<ApiResponse<Terms[]>> {
    const query = type ? `?type=${type}` : '';
    return this.request<Terms[]>(`/terms${query}`);
  }

  async getTermByType(type: TermsType): Promise<ApiResponse<Terms>> {
    return this.request<Terms>(`/terms/${type.toLowerCase()}`);
  }

  // Admin Terms API
  async getAdminTerms(): Promise<ApiResponse<Terms[]>> {
    return this.request<Terms[]>('/admin/terms');
  }

  async createTerm(termData: {
    type: TermsType;
    title: string;
    content: string;
    isRequired?: boolean;
  }): Promise<ApiResponse<Terms>> {
    return this.request<Terms>('/admin/terms', {
      method: 'POST',
      body: JSON.stringify(termData),
    });
  }

  async updateTerm(termId: string, termData: {
    title?: string;
    content?: string;
    isRequired?: boolean;
    isActive?: boolean;
  }): Promise<ApiResponse<Terms>> {
    return this.request<Terms>(`/admin/terms/${termId}`, {
      method: 'PUT',
      body: JSON.stringify(termData),
    });
  }

  async deleteTerm(termId: string): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>(`/admin/terms/${termId}`, {
      method: 'DELETE',
    });
  }

  // Auth API
  async getMe(): Promise<ApiResponse<User>> {
    return this.request<User>('/users/me');
  }

  async getOrganizationMembers(): Promise<ApiResponse<User[]>> {
    return this.request<User[]>('/users/organization-members');
  }

  async updateProfile(data: {
    username?: string;
    currentPassword?: string;
    newPassword?: string;
  }): Promise<ApiResponse<User>> {
    return this.request<User>('/users/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /** 기업 회원 기관 승인 요청(서버에서 approvalStatus → PENDING) */
  async requestOrganizationApproval(): Promise<ApiResponse<User> & { message?: string }> {
    return this.request<User>('/users/me/organization-approval-request', {
      method: 'POST',
    }) as Promise<ApiResponse<User> & { message?: string }>;
  }

  /** 가입 가능한 기업 목록 */
  async listOrganizations(): Promise<
    ApiResponse<Array<{ id: string; name: string; memberCount: number }>>
  > {
    return this.request<Array<{ id: string; name: string; memberCount: number }>>(
      '/users/organizations',
    );
  }

  /** 개인 회원 → 특정 기업 가입 신청 */
  async requestOrganizationJoin(
    organizationId: string,
  ): Promise<ApiResponse<User> & { message?: string }> {
    return this.request<User>('/users/me/organization-join-request', {
      method: 'POST',
      body: JSON.stringify({ organizationId }),
    }) as Promise<ApiResponse<User> & { message?: string }>;
  }

  /** 개인 회원 가입 신청 취소 */
  async cancelOrganizationJoin(): Promise<ApiResponse<User> & { message?: string }> {
    return this.request<User>('/users/me/organization-join-request/cancel', {
      method: 'POST',
    }) as Promise<ApiResponse<User> & { message?: string }>;
  }

  /** 기업 관리자: 가입 신청 대기 회원 목록 */
  async getPendingOrganizationMembers(): Promise<ApiResponse<User[]>> {
    return this.request<User[]>('/users/me/pending-organization-members');
  }

  /** 기업 관리자: 가입 신청 승인 */
  async approveOrganizationMember(
    userId: string,
  ): Promise<ApiResponse<User> & { message?: string }> {
    return this.request<User>(
      `/users/me/pending-organization-members/${userId}/approve`,
      { method: 'POST' },
    ) as Promise<ApiResponse<User> & { message?: string }>;
  }

  /** 기업 관리자: 가입 신청 반려 */
  async rejectOrganizationMember(
    userId: string,
  ): Promise<ApiResponse<User> & { message?: string }> {
    return this.request<User>(
      `/users/me/pending-organization-members/${userId}/reject`,
      { method: 'POST' },
    ) as Promise<ApiResponse<User> & { message?: string }>;
  }

  // Password Reset API (3-step OTP flow)
  /**
   * 1단계: 휴대폰 번호로 OTP 발급 요청.
   * 응답엔 사용자 존재 여부가 노출되지 않음.
   * 개발 환경에서는 응답에 devOtp 포함 (테스트 편의).
   */
  async requestPasswordReset(phone: string): Promise<
    ApiResponse<{ message: string; ttlSeconds: number; devOtp?: string; smsUnavailable?: boolean }>
  > {
    return this.request<{ message: string; ttlSeconds: number; devOtp?: string; smsUnavailable?: boolean }>(
      '/users/reset-password/request',
      { method: 'POST', body: JSON.stringify({ phone }) },
    );
  }

  /**
   * 2단계: OTP 검증 후 단기 reset 토큰 수령.
   */
  async verifyPasswordResetOtp(
    phone: string,
    otp: string,
  ): Promise<ApiResponse<{ resetToken: string; expiresInSeconds: number }>> {
    return this.request<{ resetToken: string; expiresInSeconds: number }>(
      '/users/reset-password/verify',
      { method: 'POST', body: JSON.stringify({ phone, otp }) },
    );
  }

  /**
   * 3단계: reset 토큰으로 새 비밀번호 설정 (one-time).
   */
  async resetPassword(
    resetToken: string,
    password: string,
  ): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>('/users/reset-password', {
      method: 'POST',
      body: JSON.stringify({ resetToken, password }),
    });
  }

  // Admin API
  async getAdminUsers(params?: { page?: number; limit?: number; userType?: string }): Promise<ApiResponse<User[]>> {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', String(params.page));
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.userType) query.append('userType', params.userType);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.request<User[]>(`/admin/users${queryString}`);
  }

  async getAdminRecoveryStats(params?: { period?: '7d' | '30d' }): Promise<ApiResponse<{
    period: '7d' | '30d';
    threshold: { avgMsPerSession: number; minSessions: number };
    rows: Array<{
      userId: string;
      name: string | null;
      email: string | null;
      userType: 'PERSONAL' | 'ORGANIZATION' | null;
      sessionsCount: number;
      sessionsWithRecovery: number;
      totalMs: number;
      windowsTotal: number;
      avgMsPerSession: number;
      exceedsThreshold: boolean;
    }>;
  }>> {
    const query = new URLSearchParams();
    if (params?.period) query.append('period', params.period);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/admin/recovery-stats${queryString}`);
  }

  async getAdminBanners(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/admin/banners');
  }

  // Public Banners API (for home page)
  async getBanners(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/home/banners');
  }

  async getAdminSessions(params?: { page?: number; limit?: number; userId?: string }): Promise<ApiResponse<any[]>> {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', String(params.page));
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.userId) query.append('userId', params.userId);
    const queryStr = query.toString() ? `?${query.toString()}` : '';
    return this.request<any[]>(`/admin/sessions${queryStr}`);
  }

  async getAdminInquiries(): Promise<ApiResponse<any[]>> {
    return this.request<any[]>('/admin/inquiries');
  }

  async answerInquiry(inquiryId: string, answer: string): Promise<ApiResponse<any>> {
    return this.request<any>(`/admin/inquiries/${inquiryId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answer }),
    });
  }

  // User Inquiry API
  async createInquiry(title: string, content: string): Promise<ApiResponse<any>> {
    const userId = localStorage.getItem(STORAGE_KEYS.USER_ID);
    if (!userId) {
      return Promise.resolve({ success: false, error: 'User not logged in' });
    }
    return this.request<any>('/users/inquiries', {
      method: 'POST',
      body: JSON.stringify({ userId, title, content }),
    });
  }

  async getUserInquiries(): Promise<ApiResponse<any[]>> {
    const userId = localStorage.getItem(STORAGE_KEYS.USER_ID);
    if (!userId) {
      return Promise.resolve({ success: false, error: 'User not logged in', data: [] });
    }
    return this.request<any[]>(`/users/inquiries/${userId}`);
  }
}

export const api = new ApiClient();
export default api;
