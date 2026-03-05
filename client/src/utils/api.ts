import type { ApiResponse, User, Game, UserStats, RankingEntry, Terms, TermsType } from '@noilink/shared';

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
      const token = localStorage.getItem('noilink_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {}),
      };
      
      // JWT 토큰이 있으면 Authorization 헤더에 추가
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      // 하위 호환성을 위해 x-user-id도 유지 (토큰이 없을 때만)
      if (!token) {
        const userId = localStorage.getItem('user_id') || localStorage.getItem('noilink_user_id');
        if (userId) {
          headers['x-user-id'] = userId;
        }
      }
      
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers,
        ...options,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(error.error || `HTTP error! status: ${response.status}`);
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
    });
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

  async getLeaderboard(limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    return this.request<RankingEntry[]>(`/scores/leaderboard${params}`);
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
  
  // Rankings API
  async getRankings(type?: string, limit?: number) {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    if (limit) params.append('limit', String(limit));
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<any>(`/rankings${query}`);
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
}

export const api = new ApiClient();
export default api;
