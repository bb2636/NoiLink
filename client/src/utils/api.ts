import type { ApiResponse, User, Game, UserStats, RankingEntry, Terms, TermsType } from '@noilink/shared';
import { STORAGE_KEYS } from './constants';

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
      
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers,
        ...options,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        
        // 401 에러인 경우 토큰이 만료되었거나 유효하지 않을 수 있음
        if (response.status === 401) {
          // 토큰 제거하고 로그인 페이지로 리다이렉트
          localStorage.removeItem(STORAGE_KEYS.TOKEN);
          localStorage.removeItem(STORAGE_KEYS.USER_ID);
          localStorage.removeItem(STORAGE_KEYS.USERNAME);
          
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

      return await response.json();
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
  async createSession(sessionData: any) {
    return this.request<any>('/sessions', {
      method: 'POST',
      body: JSON.stringify(sessionData),
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
  async saveRawMetrics(rawMetrics: any) {
    return this.request<any>('/metrics/raw', {
      method: 'POST',
      body: JSON.stringify(rawMetrics),
    });
  }
  
  async calculateMetrics(rawMetrics: any) {
    return this.request<any>('/metrics/calculate', {
      method: 'POST',
      body: JSON.stringify(rawMetrics),
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

  // Get user by username (for login)
  async getUserByUsername(username: string): Promise<ApiResponse<User>> {
    // 임시: 모든 사용자 조회 후 필터링 (실제로는 서버에 엔드포인트 추가 필요)
    const response = await this.request<User[]>('/users');
    if (response.success && response.data) {
      const user = response.data.find(u => u.username === username);
      return {
        success: !!user,
        data: user || undefined,
        error: user ? undefined : 'User not found',
      };
    }
    return {
      success: false,
      error: 'Failed to fetch users',
    };
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

  // Password Reset API
  async findUserByPhone(phone: string): Promise<ApiResponse<User>> {
    return this.request<User>(`/users/find-by-phone/${phone}`);
  }

  async resetPassword(phone: string, password: string): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>('/users/reset-password', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
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
