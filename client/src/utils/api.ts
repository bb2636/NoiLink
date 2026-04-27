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

  // Task #146 → Task #149 — 사용자 단건 조회도 같은 in-flight 가드.
  // 키는 endpoint(userId 포함) 단위라 다른 사용자 조회는 분리된다.
  async getUser(userId: string) {
    const path = `/users/${userId}`;
    return this.coalesceInflight<User>(`GET ${path}`, () => this.request<User>(path));
  }

  async updateUser(userId: string, userData: Partial<User>) {
    return this.request<User>(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
  }

  // Task #146 → Task #149 — 사용자 통계 조회도 같은 in-flight 가드.
  async getUserStats(userId: string) {
    const path = `/users/${userId}/stats`;
    return this.coalesceInflight<UserStats>(`GET ${path}`, () =>
      this.request<UserStats>(path),
    );
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

  // Task #146 → Task #149 — 사용자 스코어 목록 조회도 같은 in-flight 가드.
  async getUserScores(userId: string) {
    const path = `/scores/user/${userId}`;
    return this.coalesceInflight<any[]>(`GET ${path}`, () => this.request<any[]>(path));
  }

  // Task #146 → Task #149 — 게임 스코어 목록 조회도 같은 in-flight 가드.
  // 키는 (gameId + limit) 가 query 로 직렬화된 endpoint 단위라 limit 가
  // 다르면 분리된다.
  async getGameScores(gameId: string, limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    const path = `/scores/game/${gameId}${params}`;
    return this.coalesceInflight<any[]>(`GET ${path}`, () => this.request<any[]>(path));
  }

  // Training API
  // Task #146 → Task #149 — 게임 목록/단건 조회도 같은 in-flight 가드.
  // 라우팅 전환 + Strict Mode 이중 마운트로 거의 동시에 두 번 호출될 수
  // 있는 경합 보호.
  async getGames() {
    const path = '/training/games';
    return this.coalesceInflight<Game[]>(`GET ${path}`, () => this.request<Game[]>(path));
  }

  async getGame(gameId: string) {
    const path = `/training/games/${gameId}`;
    return this.coalesceInflight<Game>(`GET ${path}`, () => this.request<Game>(path));
  }
  
  // Home API
  // Task #146 — 자주 호출되는 조회 API 들도 동시 호출이 1회 네트워크 요청으로
  // 합쳐지도록 `coalesceInflight` 헬퍼(아래)에 키 기반으로 묶는다. 키는
  // (메서드 + endpoint) 단위라 같은 userId 의 동시 두 번 호출만 합쳐지고,
  // 다른 userId 호출은 영향이 없다.
  async getCondition(userId: string) {
    const path = `/home/condition/${userId}`;
    return this.coalesceInflight<any>(`GET ${path}`, () => this.request<any>(path));
  }

  async getMission(userId: string) {
    const path = `/home/mission/${userId}`;
    return this.coalesceInflight<any>(`GET ${path}`, () => this.request<any>(path));
  }

  async getQuickStart(userId: string) {
    const path = `/home/quickstart/${userId}`;
    return this.coalesceInflight<any>(`GET ${path}`, () => this.request<any>(path));
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
  
  // Task #146 → Task #148 — 사용자 세션 조회도 같은 in-flight 가드를 통해
  // 동시 호출(부트 + 라우팅 전환 + 포커스 복귀가 거의 동시에 트리거되는
  // 경합)을 1회 fetch 로 합친다. 키는 (userId + 옵션) 까지 포함된 endpoint
  // 단위라 다른 사용자/다른 limit/mode/isComposite 조회는 분리된다.
  async getUserSessions(userId: string, options?: { limit?: number; mode?: string; isComposite?: boolean }) {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', String(options.limit));
    if (options?.mode) params.append('mode', options.mode);
    if (options?.isComposite !== undefined) params.append('isComposite', String(options.isComposite));
    const query = params.toString() ? `?${params.toString()}` : '';
    const path = `/sessions/user/${userId}${query}`;
    return this.coalesceInflight<any[]>(`GET ${path}`, () => this.request<any[]>(path));
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
  
  // Task #146 → Task #148 — 사용자 리포트 목록 조회도 같은 in-flight 가드.
  // 키는 (userId + limit) 가 들어간 endpoint 단위라 limit 가 다르면 분리된다.
  async getUserReports(userId: string, limit?: number) {
    const params = limit ? `?limit=${limit}` : '';
    const path = `/reports/user/${userId}${params}`;
    return this.coalesceInflight<any[]>(`GET ${path}`, () => this.request<any[]>(path));
  }

  // Task #146 → Task #148 — 기관 인사이트 리포트 조회도 같은 in-flight 가드.
  // 키는 organizationId 가 들어간 endpoint 단위라 다른 기관 조회는 분리된다.
  async getOrganizationInsightReport(organizationId: string) {
    const path = `/reports/organization/${organizationId}`;
    return this.coalesceInflight<any>(`GET ${path}`, () => this.request<any>(path));
  }

  async generateOrganizationInsightReport(organizationId: string) {
    return this.request<any>('/reports/organization/generate', {
      method: 'POST',
      body: JSON.stringify({ organizationId }),
    });
  }

  // Task #146 → Task #148 — 기관 세션 트렌드 조회도 같은 in-flight 가드.
  async getOrganizationSessionsForTrend(organizationId: string) {
    const path = `/sessions/organization/${organizationId}/trend`;
    return this.coalesceInflight<any[]>(`GET ${path}`, () => this.request<any[]>(path));
  }
  
  // Rankings API
  // Task #146 → Task #148 — 랭킹 조회도 같은 in-flight 가드.
  // 키는 (type + limit + organizationId) 가 query 로 직렬화된 endpoint 단위라
  // 옵션 조합이 다르면 분리된다.
  async getRankings(type?: string, limit?: number, organizationId?: string) {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    if (limit) params.append('limit', String(limit));
    if (organizationId) params.append('organizationId', organizationId);
    const query = params.toString() ? `?${params.toString()}` : '';
    const path = `/rankings${query}`;
    return this.coalesceInflight<Record<string, RankingEntry[]>>(`GET ${path}`, () =>
      this.request<Record<string, RankingEntry[]>>(path),
    );
  }

  /**
   * "나의 랭킹" 카드 4개 stat (종합·합계 시간·연속·출석률) + 본인 등수.
   * 서버가 14일 창 단일 진실원으로 묶어 돌려준다 — 카드와 랭킹표 표시값이
   * 분기되지 않도록 하는 단일 출처. (server/routes/rankings.ts → /user/:userId/card)
   */
  async getMyRankingCard(userId: string) {
    const path = `/rankings/user/${userId}/card`;
    return this.coalesceInflight<{
      windowDays: number;
      compositeScore: number | null;
      totalTimeHours: number;
      streakDays: number;
      attendanceRate: number;
      myRanks: { composite?: number; time?: number; streak?: number };
    }>(`GET ${path}`, () => this.request(path));
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
  // Task #146 → Task #149 — 약관 조회도 같은 in-flight 가드.
  // 키는 (type query 포함) endpoint 단위라 type 이 다르면 분리된다.
  async getTerms(type?: TermsType): Promise<ApiResponse<Terms[]>> {
    const query = type ? `?type=${type}` : '';
    const path = `/terms${query}`;
    return this.coalesceInflight<Terms[]>(`GET ${path}`, () =>
      this.request<Terms[]>(path),
    );
  }

  // Task #146 → Task #149 — 단일 type 약관 조회도 같은 in-flight 가드.
  async getTermByType(type: TermsType): Promise<ApiResponse<Terms>> {
    const path = `/terms/${type.toLowerCase()}`;
    return this.coalesceInflight<Terms>(`GET ${path}`, () =>
      this.request<Terms>(path),
    );
  }

  // Admin Terms API
  // Task #146 → Task #149 — 관리자 약관 목록 조회도 같은 in-flight 가드.
  async getAdminTerms(): Promise<ApiResponse<Terms[]>> {
    const path = '/admin/terms';
    return this.coalesceInflight<Terms[]>(`GET ${path}`, () =>
      this.request<Terms[]>(path),
    );
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

  // Task #143 → Task #146 — in-flight Promise 공유 가드(coalescing) 헬퍼.
  // 같은 키로 진행 중인 호출이 이미 있으면 그 Promise 를 그대로 돌려줘
  // 동시 호출이 한 번의 네트워크 요청으로 합쳐진다(부트 useEffect,
  // `noilink-native-session` 이벤트, 라우팅 전환, 포커스 복귀 트리거,
  // Strict Mode 이중 마운트 등 여러 트리거가 거의 동시에 같은 조회를
  // 부르는 경합 보호).
  //
  // 정책:
  //  - settle 후엔 슬롯을 비워 다음 호출이 새 fetch 를 발사할 수 있게 한다
  //    (가드가 stale 응답을 영구히 돌려주면 안 된다).
  //  - 이미 다른 새 호출이 슬롯을 차지하고 있다면 그쪽을 그대로 둔다
  //    (정확히 자기 자신일 때만 비운다).
  //  - 실패해도 슬롯이 비워진다(error caching 회귀 방지) — `request()` 가
  //    실패 응답을 resolve 로 돌려주는 정상 경로뿐 아니라 reject 경로도
  //    `finally` 가 처리한다.
  //  - 키는 호출자가 직접 설계 — 보통 `'GET ' + endpoint` 처럼 의미 있는
  //    파라미터까지 포함한 형태로, 같은 의미의 호출만 합쳐지고 다른
  //    파라미터(예: 다른 userId)는 영향이 없도록 한다.
  private inflightRequests = new Map<string, Promise<ApiResponse<unknown>>>();

  private coalesceInflight<T>(
    key: string,
    factory: () => Promise<ApiResponse<T>>,
  ): Promise<ApiResponse<T>> {
    const existing = this.inflightRequests.get(key);
    if (existing) {
      return existing as Promise<ApiResponse<T>>;
    }
    const p = factory().finally(() => {
      if (this.inflightRequests.get(key) === p) {
        this.inflightRequests.delete(key);
      }
    }) as Promise<ApiResponse<unknown>>;
    this.inflightRequests.set(key, p);
    return p as Promise<ApiResponse<T>>;
  }

  // Auth API
  // Task #143 → Task #146 — `getMe` 도 위 `coalesceInflight` 헬퍼를 통해
  // 표현(중복 코드 제거).
  async getMe(): Promise<ApiResponse<User>> {
    return this.coalesceInflight<User>('GET /users/me', () =>
      this.request<User>('/users/me'),
    );
  }

  // Task #146 → Task #147 — 기관 회원 목록도 같은 in-flight 가드를 통과시켜
  // 동시 호출(예: Home.tsx 가 조직 정보를 부르는 동안 사용자가
  // MemberSelectModal 을 여는 경우)을 1회 fetch 로 합친다. 키는 endpoint
  // (메서드 + 경로) 단위라 settle 후엔 새 호출이 다시 발사되고, 다른
  // 컨텍스트로 갈리는 파라미터가 URL 에 없으므로(서버가 Authorization 토큰
  // 으로 조직을 결정) 같은 endpoint 의 동시 호출만 묶인다.
  async getOrganizationMembers(): Promise<ApiResponse<User[]>> {
    const path = '/users/organization-members';
    return this.coalesceInflight<User[]>(`GET ${path}`, () =>
      this.request<User[]>(path),
    );
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
  // Task #146 → Task #148 — 가입 화면 부트에서 같은 endpoint 가 거의 동시에
  // 두 번 트리거될 수 있으므로(라우팅 전환 + Strict Mode 이중 마운트 등)
  // 같은 in-flight 가드를 통과시킨다.
  async listOrganizations(): Promise<
    ApiResponse<Array<{ id: string; name: string; memberCount: number }>>
  > {
    const path = '/users/organizations';
    return this.coalesceInflight<Array<{ id: string; name: string; memberCount: number }>>(
      `GET ${path}`,
      () => this.request<Array<{ id: string; name: string; memberCount: number }>>(path),
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
  // Task #147 — `OrganizationMembers.tsx` 에서 멤버 목록과 함께
  // `Promise.all` 로 거의 동시에 트리거되는 페어. 같은 endpoint 의 동시
  // 호출은 1회 fetch 로 합쳐 두면 서버/기기 트래픽이 줄어든다.
  async getPendingOrganizationMembers(): Promise<ApiResponse<User[]>> {
    const path = '/users/me/pending-organization-members';
    return this.coalesceInflight<User[]>(`GET ${path}`, () =>
      this.request<User[]>(path),
    );
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
  // Task #146 → Task #149 — 관리자 회원/세션/문의/배너/리커버리 통계 조회도
  // 같은 in-flight 가드. 키는 (params 가 query 로 직렬화된) endpoint 단위라
  // 다른 페이지/필터 조합은 분리된다.
  async getAdminUsers(params?: { page?: number; limit?: number; userType?: string }): Promise<ApiResponse<User[]>> {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', String(params.page));
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.userType) query.append('userType', params.userType);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    const path = `/admin/users${queryString}`;
    return this.coalesceInflight<User[]>(`GET ${path}`, () =>
      this.request<User[]>(path),
    );
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
    const path = `/admin/recovery-stats${queryString}`;
    return this.coalesceInflight(`GET ${path}`, () => this.request(path));
  }

  async getAdminBanners(): Promise<ApiResponse<any[]>> {
    const path = '/admin/banners';
    return this.coalesceInflight<any[]>(`GET ${path}`, () => this.request<any[]>(path));
  }

  // Public Banners API (for home page)
  async getBanners(): Promise<ApiResponse<any[]>> {
    const path = '/home/banners';
    return this.coalesceInflight<any[]>(`GET ${path}`, () => this.request<any[]>(path));
  }

  async getAdminSessions(params?: { page?: number; limit?: number; userId?: string }): Promise<ApiResponse<any[]>> {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', String(params.page));
    if (params?.limit) query.append('limit', String(params.limit));
    if (params?.userId) query.append('userId', params.userId);
    const queryStr = query.toString() ? `?${query.toString()}` : '';
    const path = `/admin/sessions${queryStr}`;
    return this.coalesceInflight<any[]>(`GET ${path}`, () => this.request<any[]>(path));
  }

  async getAdminInquiries(): Promise<ApiResponse<any[]>> {
    const path = '/admin/inquiries';
    return this.coalesceInflight<any[]>(`GET ${path}`, () => this.request<any[]>(path));
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

  // Task #146 → Task #149 — 사용자 본인 문의 목록 조회도 같은 in-flight
  // 가드. 키는 endpoint(userId 포함) 단위라 다른 사용자(예: 로그아웃 후
  // 재로그인) 호출은 분리된다.
  async getUserInquiries(): Promise<ApiResponse<any[]>> {
    const userId = localStorage.getItem(STORAGE_KEYS.USER_ID);
    if (!userId) {
      return Promise.resolve({ success: false, error: 'User not logged in', data: [] });
    }
    const path = `/users/inquiries/${userId}`;
    return this.coalesceInflight<any[]>(`GET ${path}`, () => this.request<any[]>(path));
  }
}

export const api = new ApiClient();
export default api;
