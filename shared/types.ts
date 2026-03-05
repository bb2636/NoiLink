/**
 * NoiLink 공통 타입 정의
 * 기능 명세서 v1.0 기반
 */

// ============================================================================
// 0. 핵심 용어 및 기본 타입
// ============================================================================

/** Pod 논리 ID (P0, P1, P2, P3...) */
export type LogicalPodId = `P${number}`;

/** 의미 색상 (Logic) */
export type LogicColor = 'GREEN' | 'RED' | 'BLUE' | 'YELLOW' | 'WHITE';

/** 물리 색상 (HW) */
export type HardwareColor = 'G' | 'R' | 'B' | 'RG' | 'RGB';

/** 색상 매핑 */
export interface ColorMapping {
  logic: LogicColor;
  hardware: HardwareColor;
}

/** 트레이닝 모드 */
export type TrainingMode = 
  | 'MEMORY'           // 기억력
  | 'COMPREHENSION'    // 이해력
  | 'FOCUS'            // 집중력
  | 'JUDGMENT'         // 판단력
  | 'AGILITY'          // 순발력 (기존 MULTITASKING)
  | 'ENDURANCE'        // 지구력
  | 'COMPOSITE'        // 종합 트레이닝
  | 'FREE';            // 자유 트레이닝

/** Phase 타입 */
export type PhaseType = 'RHYTHM' | 'COGNITIVE';

/** 난이도 레벨 (1~5) */
export type Level = 1 | 2 | 3 | 4 | 5;

/** Brainimal 타입 (12가지) */
export type BrainimalType =
  | 'OWL_FOCUS'           // 집중하는 부엉이
  | 'CHEETAH_JUDGMENT'    // 판단력의 치타
  | 'BEAR_ENDURANCE'      // 끈기있는 곰
  | 'DOLPHIN_BRILLIANT'   // 명석한 돌고래
  | 'TIGER_STRATEGIC'     // 전략적인 호랑이
  | 'FOX_BALANCED'        // 균형적인 여우
  | 'CAT_DELICATE'        // 섬세한 고양이
  | 'EAGLE_INSIGHT'       // 통찰력의 독수리
  | 'LION_BOLD'           // 대담한 사자
  | 'DOG_SOCIAL'          // 사회적인 강아지
  | 'KOALA_CALM'          // 침착한 코알라
  | 'WOLF_CREATIVE';       // 창의적인 늑대

/** 회원 타입 */
export type UserType = 'PERSONAL' | 'ORGANIZATION' | 'ADMIN';

/** 컨디션 배지 */
export type ConditionBadge = 'EXCELLENT' | 'GOOD' | 'NORMAL' | 'POOR';

/** 리듬 판정 등급 */
export type RhythmGrade = 'PERFECT' | 'GOOD' | 'BAD' | 'MISS';

// ============================================================================
// 1. 사용자 및 조직 관리
// ============================================================================

/** 사용자 정보 */
export interface User {
  id: string;                          // 고유 ID
  username: string;                    // 사용자명 (로그인 ID)
  email?: string;                      // 이메일
  name: string;                        // 표시 이름
  age?: number;                        // 나이
  userType: UserType;                  // 회원 타입
  organizationId?: string;            // 기업 회원인 경우 조직 ID
  deviceId?: string;                   // 기기 ID
  brainimalType?: BrainimalType;       // 브레이니멀 타입
  brainimalConfidence?: number;        // 신뢰도 (0~100)
  brainAge?: number;                   // 뇌지컬 나이
  previousBrainAge?: number;           // 이전 뇌지컬 나이 (변화 추이용)
  streak: number;                      // 연속 트레이닝 일수
  lastTrainingDate?: string;           // 마지막 트레이닝 일시
  createdAt: string;                  // 생성일시 (ISO 8601)
  lastLoginAt: string;                 // 마지막 로그인 일시
  updatedAt?: string;                  // 수정일시
}

/** 조직 정보 (기업 회원용) */
export interface Organization {
  id: string;                          // 고유 ID
  name: string;                        // 조직명
  adminUserId: string;                 // 관리자 사용자 ID
  memberUserIds: string[];             // 멤버 사용자 ID 목록
  createdAt: string;                  // 생성일시
  updatedAt?: string;                  // 수정일시
}

/** 약관 타입 */
export type TermsType = 'SERVICE' | 'PRIVACY';

/** 약관 정보 */
export interface Terms {
  id: string;                          // 고유 ID
  type: TermsType;                     // 약관 타입 (서비스 이용약관, 개인정보 수집 및 이용)
  title: string;                       // 약관 제목
  content: string;                     // 약관 내용
  version: number;                     // 약관 버전
  isRequired: boolean;                 // 필수 여부
  isActive: boolean;                   // 활성화 여부
  createdAt: string;                   // 생성일시
  updatedAt?: string;                   // 수정일시
  createdBy?: string;                  // 생성자 ID (관리자)
}

// ============================================================================
// 2. 트레이닝 세션 및 Phase 데이터
// ============================================================================

/** Phase 메타데이터 */
export interface PhaseMeta {
  type: PhaseType;                     // Phase 타입
  startTime: number;                   // 시작 시간 (ms, 세션 시작 기준)
  endTime: number;                     // 종료 시간 (ms)
  duration: number;                    // 지속 시간 (ms)
  mode?: TrainingMode;                 // COGNITIVE Phase인 경우 모드
  bpm: number;                         // BPM
  level: Level;                        // 난이도 레벨
  tickCount: number;                   // Tick 횟수
  hitCount: number;                    // 정답 횟수
  missCount: number;                   // 놓침 횟수
  rhythmScore?: number;                // 리듬 점수 (0~100)
  rhythmGrades?: Record<RhythmGrade, number>; // 판정 등급별 횟수
}

/** 트레이닝 세션 */
export interface Session {
  id: string;                          // 고유 ID
  userId: string;                      // 사용자 ID
  mode: TrainingMode;                  // 트레이닝 모드
  bpm: number;                         // BPM
  level: Level;                        // 난이도 레벨
  duration: number;                    // 총 지속 시간 (ms)
  score?: number;                      // 종합 점수 (0~100, FREE 모드는 null)
  isComposite: boolean;                // 종합 트레이닝 여부
  isValid: boolean;                    // 유효한 세션 여부 (300초 완주 등)
  phases: PhaseMeta[];                 // Phase 메타데이터 배열
  createdAt: string;                   // 생성일시 (ISO 8601)
}

// ============================================================================
// 3. 원시 메트릭 및 지표 점수
// ============================================================================

/** 리듬 Phase 원시 데이터 */
export interface RhythmRawMetrics {
  totalTicks: number;                  // 총 Tick 수
  perfectCount: number;                 // Perfect 횟수
  goodCount: number;                   // Good 횟수
  badCount: number;                    // Bad 횟수
  missCount: number;                   // Miss 횟수
  accuracy: number;                    // 정확도 (0~1)
  avgOffset: number;                   // 평균 오차 (ms)
  offsetSD: number;                    // 오차 표준편차 (ms)
}

/** 기억력 원시 메트릭 */
export interface MemoryRawMetrics {
  maxSpan: number;                     // 최대 순서 길이
  sequenceAccuracy: number;            // 순서 정확도 (0~1)
  perfectRecallRate: number;           // 완벽 재현율 (0~1)
  avgReactionTime: number;             // 평균 반응 시간 (ms)
}

/** 이해력 원시 메트릭 */
export interface ComprehensionRawMetrics {
  avgReactionTime: number;             // 평균 반응 시간 (ms)
  switchCost: number;                   // 전환 비용 (ms)
  switchErrorRate: number;              // 전환 직후 오류율 (0~1)
  learningSlope: number;                // 학습 곡선 기울기
  ruleAccuracy: number;                 // 규칙 정확도 (0~1)
}

/** 집중력 원시 메트릭 */
export interface FocusRawMetrics {
  targetHitRate: number;               // 타겟 적중률 (0~1)
  commissionErrorRate: number;          // 오답률 (0~1)
  omissionErrorRate: number;           // 누락률 (0~1)
  avgReactionTime: number;             // 평균 반응 시간 (ms)
  reactionTimeSD: number;               // 반응 시간 표준편차 (ms)
  lapseCount: number;                   // 멍때림 횟수
}

/** 판단력 원시 메트릭 */
export interface JudgmentRawMetrics {
  noGoSuccessRate: number;             // 억제 성공률 (0~1)
  goSuccessRate: number;               // GO 성공률 (0~1)
  doubleTapSuccessRate: number;        // 더블탭 성공률 (0~1)
  avgGoReactionTime: number;           // GO 평균 반응 시간 (ms)
  reactionTimeSD: number;               // 반응 시간 표준편차 (ms)
  impulseCount: number;                // 충동 오류 횟수
}

/** 순발력 원시 메트릭 (기존 멀티태스킹) */
export interface AgilityRawMetrics {
  footAccuracy: number;                 // 발 정확도 (0~1)
  anchorOmissionRate: number;           // 앵커 누락률 (0~1)
  simultaneousSuccessRate: number;     // 동시 성공률 (0~1)
  switchCost: number;                   // 전환 비용 (ms)
  syncError: number;                    // 동기화 오차 (ms)
  reactionTime: number;                  // 반응 시간 (ms)
}

/** 지구력 원시 메트릭 */
export interface EnduranceRawMetrics {
  earlyScore: number;                   // 초반 점수 (0~100)
  midScore: number;                    // 중반 점수 (0~100)
  lateScore: number;                   // 후반 점수 (0~100)
  maintainRatio: number;                // 유지 비율 (late/early)
  drift: number;                        // 드리프트 (지연율, 0~1)
  earlyReactionTime: number;            // 초반 평균 반응 시간 (ms)
  lateReactionTime: number;             // 후반 평균 반응 시간 (ms)
  omissionIncrease: number;             // 놓침 증가분
}

/** 원시 메트릭 통합 */
export interface RawMetrics {
  sessionId: string;                   // 세션 ID
  userId: string;                       // 사용자 ID
  touchCount: number;                   // 총 터치 횟수
  hitCount: number;                     // 정답 횟수
  rtMean: number;                       // 평균 반응 시간 (ms)
  rtSD: number;                         // 반응 시간 표준편차 (ms)
  rhythm?: RhythmRawMetrics;           // 리듬 메트릭
  memory?: MemoryRawMetrics;            // 기억력 메트릭
  comprehension?: ComprehensionRawMetrics; // 이해력 메트릭
  focus?: FocusRawMetrics;              // 집중력 메트릭
  judgment?: JudgmentRawMetrics;        // 판단력 메트릭
  agility?: AgilityRawMetrics;           // 순발력 메트릭 (기존 multitasking)
  endurance?: EnduranceRawMetrics;      // 지구력 메트릭
  createdAt: string;                    // 생성일시
}

/** 6대 지표 점수 */
export interface MetricsScore {
  sessionId: string;                   // 세션 ID
  userId: string;                       // 사용자 ID
  memory?: number;                      // 기억력 점수 (0~100)
  comprehension?: number;               // 이해력 점수 (0~100)
  focus?: number;                      // 집중력 점수 (0~100)
  judgment?: number;                    // 판단력 점수 (0~100)
  agility?: number;                     // 순발력 점수 (0~100, 기존 multitasking)
  endurance?: number;                  // 지구력 점수 (0~100)
  rhythm?: number;                     // 리듬 점수 (0~100, 공통)
  createdAt: string;                    // 생성일시
}

// ============================================================================
// 4. 규준 데이터 (NormConfig)
// ============================================================================

/** 규준 설정 (Z-Score 변환용) */
export interface NormConfig {
  version: string;                     // 규준 버전 (예: "v1.0")
  updatedAt: string;                   // 업데이트 일시
  
  // 기억력 규준
  memory: {
    maxSpan: { mu: number; sigma: number };        // μ=5.5, σ=1.2
    sequenceAccuracy: { mu: number; sigma: number }; // μ=0.8, σ=0.15
  };
  
  // 이해력 규준
  comprehension: {
    reactionTime: { mu: number; sigma: number };   // μ=600, σ=150
    learningSlope: { mu: number; sigma: number };   // μ=-50, σ=30
  };
  
  // 집중력 규준
  focus: {
    reactionTimeSD: { mu: number; sigma: number };  // μ=120, σ=40
    lapseCount: { mu: number; sigma: number };     // μ=2.0, σ=1.5
  };
  
  // 판단력 규준
  judgment: {
    noGoAccuracy: { mu: number; sigma: number };   // μ=0.9, σ=0.1
    goReactionTime: { mu: number; sigma: number }; // μ=500, σ=100
  };
  
  // 순발력 규준 (기존 멀티태스킹)
  agility: {
    switchCost: { mu: number; sigma: number };     // μ=250, σ=100
    switchAccuracy: { mu: number; sigma: number }; // μ=0.85, σ=0.12
    reactionTime: { mu: number; sigma: number };  // μ=400, σ=100
  };
  
  // 지구력 규준
  endurance: {
    maintainRatio: { mu: number; sigma: number }; // μ=1.10, σ=0.15
  };
}

// ============================================================================
// 5. 홈 화면 및 컨디션 데이터
// ============================================================================

/** 오늘의 컨디션 */
export interface DailyCondition {
  userId: string;                      // 사용자 ID
  date: string;                        // 날짜 (YYYY-MM-DD)
  score: number;                       // 컨디션 점수 (0~100)
  badge: ConditionBadge;               // 배지
  avgReactionTime: number;             // 평균 반응 시간 (ms)
  avgAccuracy: number;                 // 평균 정확도 (0~1)
  errorCount: number;                  // 오류 횟수
  duration: number;                    // 수행 지속 시간 (ms)
  calculatedAt: string;                // 계산 일시
}

/** 오늘의 미션 */
export interface DailyMission {
  userId: string;                      // 사용자 ID
  date: string;                        // 날짜 (YYYY-MM-DD)
  targetBPM: number;                   // 목표 BPM
  targetAccuracy: number;              // 목표 정확도 (0~100)
  description: string;                 // 미션 설명
  createdAt: string;                   // 생성 일시
}

// ============================================================================
// 6. 리포트 및 분석
// ============================================================================

/** 리포트 데이터 */
export interface Report {
  id: string;                          // 리포트 ID
  userId: string;                       // 사용자 ID
  reportVersion: number;                // 리포트 버전 (종합 훈련 횟수)
  brainimalType: BrainimalType;         // 브레이니멀 타입
  confidence: number;                   // 신뢰도 (0~100)
  metricsScore: MetricsScore;           // 6대 지표 점수
  factText: string;                     // Fact 문구
  lifeText: string;                     // Life 문구
  hintText: string;                     // Hint 문구
  recommendedMode?: TrainingMode;        // 추천 트레이닝 모드
  recommendedBPM?: number;              // 추천 BPM
  recommendedLevel?: Level;             // 추천 레벨
  createdAt: string;                    // 생성일시
}

/** 기관 리포트 (ORG_REPORT) */
export interface OrgReport {
  id: string;                          // 리포트 ID
  organizationId: string;              // 조직 ID
  activeMembers: number;               // 활성 인원
  participationRate: number;           // 참여율 (7일, 0~1)
  compositeCompletionRate: number;     // 종합 트레이닝 수행률 (0~1)
  teamAvgScore: number;                // 팀 평균 점수 (0~100)
  teamAvgConfidence: number;           // 팀 평균 신뢰도 (0~100)
  riskMemberCount: number;             // 위험 인원 수
  trendScore: number;                  // 트렌드 점수 (변화량)
  trendStatus: 'UP' | 'DOWN' | 'FLAT'; // 트렌드 상태
  coachAction: string;                  // 코치 액션 추천 문구
  createdAt: string;                   // 생성일시
}

/** 리스크 멤버 정보 */
export interface RiskMember {
  userId: string;                      // 사용자 ID
  organizationId: string;             // 조직 ID
  riskLevel: 'WARN' | 'WATCH';        // 리스크 레벨
  reasons: string[];                   // 리스크 사유
  lastTrainingDate?: string;           // 마지막 트레이닝 일시
  lowMetricsCount: number;             // 55점 미만 지표 개수
  scoreDrop: number;                   // 점수 급락량
  confidence: number;                  // 신뢰도
  detectedAt: string;                  // 탐지 일시
}

// ============================================================================
// 7. 랭킹 시스템
// ============================================================================

/** 랭킹 타입 */
export type RankingType = 
  | 'COMPOSITE_SCORE'      // 종합 트레이닝 점수 랭킹
  | 'TOTAL_TIME'           // 트레이닝 합계 시간 랭킹
  | 'STREAK';              // 연속 트레이닝(스트릭) 랭킹

/** 랭킹 엔트리 */
export interface RankingEntry {
  userId: string;                      // 사용자 ID
  username: string;                    // 사용자명 (개인: 닉네임, 기관: 본명)
  userType: UserType;                  // 회원 타입
  organizationId?: string;             // 기업 회원인 경우
  rankingType: RankingType;            // 랭킹 타입
  score: number;                       // 랭킹 점수
  rank: number;                        // 순위
  metadata?: Record<string, any>;      // 추가 메타데이터
  calculatedAt: string;                // 계산 일시
}

// ============================================================================
// 8. API 응답 타입
// ============================================================================

/** API 응답 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** 페이지네이션 응답 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================================================
// 9. 기타 유틸리티 타입
// ============================================================================

/** 사용자 통계 (레거시 호환) */
export interface UserStats {
  totalGamesPlayed: number;
  totalScore: number;
  averageScore: number;
  bestScores: Record<string, number>;
  gamesByCategory: Record<string, number>;
  accuracy: number;
}

/** 게임 정보 (레거시 호환) */
export interface Game {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: string;
  icon?: string;
  instructions?: string;
  createdAt: string;
  updatedAt?: string;
}
