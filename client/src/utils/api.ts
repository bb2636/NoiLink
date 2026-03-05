import type { ApiResponse, User, Score, Game, UserStats, LeaderboardEntry } from '@noilink/shared';

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
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
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
  async createUser(userData: { username: string; email?: string; name?: string; deviceId?: string }) {
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
    return this.request<Score>('/scores', {
      method: 'POST',
      body: JSON.stringify(scoreData),
    });
  }

  async getUserScores(userId: string) {
    return this.request<Score[]>(`/scores/user/${userId}`);
  }

  async getGameScores(gameId: string, limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    return this.request<Score[]>(`/scores/game/${gameId}${params}`);
  }

  async getLeaderboard(limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    return this.request<LeaderboardEntry[]>(`/scores/leaderboard${params}`);
  }

  // Training API
  async getGames() {
    return this.request<Game[]>('/training/games');
  }

  async getGame(gameId: string) {
    return this.request<Game>(`/training/games/${gameId}`);
  }
}

export const api = new ApiClient();
export default api;
