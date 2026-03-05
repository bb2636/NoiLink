# NoiLink Database Schema Design

Replit Database를 사용한 데이터 구조 설계안입니다.  
**기능 명세서 v1.0** 기반으로 작성되었습니다.

## 데이터 구조 개요

Replit Database는 Key-Value 스토어이므로, 배열 형태로 데이터를 저장합니다.

### 주요 데이터 컬렉션

1. **users**: 사용자 정보 및 프로필
2. **organizations**: 조직 정보 (기업 회원용)
3. **sessions**: 트레이닝 세션 기록
4. **rawMetrics**: 원시 메트릭 데이터
5. **metricsScores**: 6대 지표 점수
6. **normConfig**: 규준 설정 (Z-Score 변환용)
7. **dailyConditions**: 일일 컨디션 데이터
8. **dailyMissions**: 오늘의 미션
9. **reports**: 개인 리포트
10. **orgReports**: 기관 리포트
11. **riskMembers**: 리스크 멤버 정보
12. **rankings**: 랭킹 데이터 (3종)

---

## 1. users (사용자 정보)

**저장 키**: `users`  
**타입**: `User[]`

```typescript
interface User {
  id: string;                          // 고유 ID (예: "user_1234567890_abc123")
  username: string;                    // 사용자명 (로그인 ID)
  email?: string;                      // 이메일
  name: string;                        // 표시 이름
  userType: 'PERSONAL' | 'ORGANIZATION'; // 회원 타입
  organizationId?: string;            // 기업 회원인 경우 조직 ID
  deviceId?: string;                   // 기기 ID
  brainimalType?: BrainimalType;       // 브레이니멀 타입 (12가지)
  brainimalConfidence?: number;        // 신뢰도 (0~100)
  streak: number;                      // 연속 트레이닝 일수
  lastTrainingDate?: string;           // 마지막 트레이닝 일시
  createdAt: string;                   // 생성일시 (ISO 8601)
  lastLoginAt: string;                 // 마지막 로그인 일시
  updatedAt?: string;                  // 수정일시
}
```

**인덱싱 전략**:
- `id`로 직접 조회
- `username`으로 로그인 조회
- `organizationId`로 조직 멤버 조회
- `brainimalType`으로 타입별 통계

---

## 2. organizations (조직 정보)

**저장 키**: `organizations`  
**타입**: `Organization[]`

```typescript
interface Organization {
  id: string;                          // 고유 ID
  name: string;                        // 조직명
  adminUserId: string;                 // 관리자 사용자 ID
  memberUserIds: string[];             // 멤버 사용자 ID 목록
  createdAt: string;                   // 생성일시
  updatedAt?: string;                  // 수정일시
}
```

**인덱싱 전략**:
- `id`로 직접 조회
- `adminUserId`로 관리자 조회

---

## 3. sessions (트레이닝 세션)

**저장 키**: `sessions`  
**타입**: `Session[]`

```typescript
interface Session {
  id: string;                          // 고유 ID
  userId: string;                      // 사용자 ID
  mode: TrainingMode;                  // 트레이닝 모드
  bpm: number;                         // BPM
  level: Level;                        // 난이도 레벨 (1~5)
  duration: number;                    // 총 지속 시간 (ms)
  score?: number;                     // 종합 점수 (0~100, FREE 모드는 null)
  isComposite: boolean;                // 종합 트레이닝 여부
  isValid: boolean;                    // 유효한 세션 여부 (300초 완주 등)
  phases: PhaseMeta[];                 // Phase 메타데이터 배열
  createdAt: string;                   // 생성일시 (ISO 8601)
}

interface PhaseMeta {
  type: 'RHYTHM' | 'COGNITIVE';       // Phase 타입
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
```

**인덱싱 전략**:
- `userId`로 사용자별 세션 조회
- `mode`로 모드별 통계
- `isComposite`로 종합 트레이닝 필터링
- `isValid`로 유효 세션만 조회
- `createdAt`로 날짜 범위 조회

**쿼리 예시**:
```typescript
// 최근 14일 종합 트레이닝 조회
const sessions = await db.get('sessions') || [];
const compositeSessions = sessions
  .filter(s => s.userId === userId && s.isComposite && s.isValid)
  .filter(s => {
    const date = new Date(s.createdAt);
    const daysAgo = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 14;
  })
  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
```

---

## 4. rawMetrics (원시 메트릭 데이터)

**저장 키**: `rawMetrics`  
**타입**: `RawMetrics[]`

```typescript
interface RawMetrics {
  sessionId: string;                   // 세션 ID
  userId: string;                      // 사용자 ID
  touchCount: number;                  // 총 터치 횟수
  hitCount: number;                    // 정답 횟수
  rtMean: number;                      // 평균 반응 시간 (ms)
  rtSD: number;                        // 반응 시간 표준편차 (ms)
  rhythm?: RhythmRawMetrics;           // 리듬 메트릭
  memory?: MemoryRawMetrics;           // 기억력 메트릭
  comprehension?: ComprehensionRawMetrics; // 이해력 메트릭
  focus?: FocusRawMetrics;             // 집중력 메트릭
  judgment?: JudgmentRawMetrics;       // 판단력 메트릭
  multitasking?: MultitaskingRawMetrics; // 멀티태스킹 메트릭
  endurance?: EnduranceRawMetrics;     // 지구력 메트릭
  createdAt: string;                   // 생성일시
}
```

**인덱싱 전략**:
- `sessionId`로 세션별 메트릭 조회
- `userId`로 사용자별 메트릭 조회

**상세 메트릭 구조**는 `shared/types.ts` 참조.

---

## 5. metricsScores (6대 지표 점수)

**저장 키**: `metricsScores`  
**타입**: `MetricsScore[]`

```typescript
interface MetricsScore {
  sessionId: string;                  // 세션 ID
  userId: string;                     // 사용자 ID
  memory?: number;                     // 기억력 점수 (0~100)
  comprehension?: number;              // 이해력 점수 (0~100)
  focus?: number;                      // 집중력 점수 (0~100)
  judgment?: number;                   // 판단력 점수 (0~100)
  multitasking?: number;              // 멀티태스킹 점수 (0~100)
  endurance?: number;                  // 지구력 점수 (0~100)
  rhythm?: number;                     // 리듬 점수 (0~100, 공통)
  createdAt: string;                   // 생성일시
}
```

**인덱싱 전략**:
- `sessionId`로 세션별 점수 조회
- `userId`로 사용자별 점수 조회
- 지표별 평균/최고점 계산

---

## 6. normConfig (규준 설정)

**저장 키**: `normConfig`  
**타입**: `NormConfig` (단일 객체)

```typescript
interface NormConfig {
  version: string;                     // 규준 버전 (예: "v1.0")
  updatedAt: string;                   // 업데이트 일시
  
  // 기억력 규준
  memory: {
    maxSpan: { mu: 5.5, sigma: 1.2 };
    sequenceAccuracy: { mu: 0.8, sigma: 0.15 };
  };
  
  // 이해력 규준
  comprehension: {
    reactionTime: { mu: 600, sigma: 150 };
    learningSlope: { mu: -50, sigma: 30 };
  };
  
  // 집중력 규준
  focus: {
    reactionTimeSD: { mu: 120, sigma: 40 };
    lapseCount: { mu: 2.0, sigma: 1.5 };
  };
  
  // 판단력 규준
  judgment: {
    noGoAccuracy: { mu: 0.9, sigma: 0.1 };
    goReactionTime: { mu: 500, sigma: 100 };
  };
  
  // 멀티태스킹 규준
  multitasking: {
    switchCost: { mu: 250, sigma: 100 };
    switchAccuracy: { mu: 0.85, sigma: 0.12 };
  };
  
  // 지구력 규준
  endurance: {
    maintainRatio: { mu: 1.10, sigma: 0.15 };
  };
}
```

**저장 방식**: `db.set('normConfig', normConfig)` (단일 객체)

**초기화**: 서버 시작 시 `server/init-norm.ts` 실행하여 초기 데이터 설정.

---

## 7. dailyConditions (일일 컨디션)

**저장 키**: `dailyConditions`  
**타입**: `DailyCondition[]`

```typescript
interface DailyCondition {
  userId: string;                      // 사용자 ID
  date: string;                        // 날짜 (YYYY-MM-DD)
  score: number;                       // 컨디션 점수 (0~100)
  badge: 'EXCELLENT' | 'GOOD' | 'NORMAL' | 'POOR'; // 배지
  avgReactionTime: number;             // 평균 반응 시간 (ms)
  avgAccuracy: number;                 // 평균 정확도 (0~1)
  errorCount: number;                  // 오류 횟수
  duration: number;                    // 수행 지속 시간 (ms)
  calculatedAt: string;                // 계산 일시
}
```

**인덱싱 전략**:
- `userId` + `date`로 일일 컨디션 조회
- 최근 3일 평균 계산

---

## 8. dailyMissions (오늘의 미션)

**저장 키**: `dailyMissions`  
**타입**: `DailyMission[]`

```typescript
interface DailyMission {
  userId: string;                      // 사용자 ID
  date: string;                        // 날짜 (YYYY-MM-DD)
  targetBPM: number;                   // 목표 BPM
  targetAccuracy: number;              // 목표 정확도 (0~100)
  description: string;                 // 미션 설명
  createdAt: string;                   // 생성 일시
}
```

**인덱싱 전략**:
- `userId` + `date`로 오늘의 미션 조회

---

## 9. reports (개인 리포트)

**저장 키**: `reports`  
**타입**: `Report[]`

```typescript
interface Report {
  id: string;                          // 리포트 ID
  userId: string;                      // 사용자 ID
  reportVersion: number;               // 리포트 버전 (종합 훈련 횟수)
  brainimalType: BrainimalType;        // 브레이니멀 타입
  confidence: number;                  // 신뢰도 (0~100)
  metricsScore: MetricsScore;          // 6대 지표 점수
  factText: string;                    // Fact 문구
  lifeText: string;                    // Life 문구
  hintText: string;                    // Hint 문구
  recommendedMode?: TrainingMode;      // 추천 트레이닝 모드
  recommendedBPM?: number;            // 추천 BPM
  recommendedLevel?: Level;            // 추천 레벨
  createdAt: string;                   // 생성일시
}
```

**인덱싱 전략**:
- `userId`로 사용자별 리포트 조회
- `reportVersion`으로 최신 리포트 조회

---

## 10. orgReports (기관 리포트)

**저장 키**: `orgReports`  
**타입**: `OrgReport[]`

```typescript
interface OrgReport {
  id: string;                          // 리포트 ID
  organizationId: string;              // 조직 ID
  activeMembers: number;               // 활성 인원
  participationRate: number;           // 참여율 (7일, 0~1)
  compositeCompletionRate: number;    // 종합 트레이닝 수행률 (0~1)
  teamAvgScore: number;                // 팀 평균 점수 (0~100)
  teamAvgConfidence: number;           // 팀 평균 신뢰도 (0~100)
  riskMemberCount: number;             // 위험 인원 수
  trendScore: number;                  // 트렌드 점수 (변화량)
  trendStatus: 'UP' | 'DOWN' | 'FLAT'; // 트렌드 상태
  coachAction: string;                 // 코치 액션 추천 문구
  createdAt: string;                   // 생성일시
}
```

**인덱싱 전략**:
- `organizationId`로 조직별 리포트 조회

---

## 11. riskMembers (리스크 멤버)

**저장 키**: `riskMembers`  
**타입**: `RiskMember[]`

```typescript
interface RiskMember {
  userId: string;                      // 사용자 ID
  organizationId: string;             // 조직 ID
  riskLevel: 'WARN' | 'WATCH';       // 리스크 레벨
  reasons: string[];                   // 리스크 사유
  lastTrainingDate?: string;          // 마지막 트레이닝 일시
  lowMetricsCount: number;            // 55점 미만 지표 개수
  scoreDrop: number;                  // 점수 급락량
  confidence: number;                 // 신뢰도
  detectedAt: string;                 // 탐지 일시
}
```

**인덱싱 전략**:
- `organizationId`로 조직별 리스크 멤버 조회
- `riskLevel`로 레벨별 필터링

---

## 12. rankings (랭킹 데이터)

**저장 키**: `rankings`  
**타입**: `RankingEntry[]`

```typescript
interface RankingEntry {
  userId: string;                      // 사용자 ID
  username: string;                    // 사용자명 (개인: 닉네임, 기관: 본명)
  userType: 'PERSONAL' | 'ORGANIZATION'; // 회원 타입
  organizationId?: string;            // 기업 회원인 경우
  rankingType: 'COMPOSITE_SCORE' | 'TOTAL_TIME' | 'STREAK'; // 랭킹 타입
  score: number;                       // 랭킹 점수
  rank: number;                        // 순위
  metadata?: Record<string, any>;     // 추가 메타데이터
  calculatedAt: string;                // 계산 일시
}
```

**랭킹 타입별 계산 방식**:

1. **COMPOSITE_SCORE** (종합 트레이닝 점수 랭킹):
   - 최근 14일 내 종합 트레이닝 상위 3회 점수 평균
   - 가중치 1.2배 적용

2. **TOTAL_TIME** (트레이닝 합계 시간 랭킹):
   - 최근 14일 모든 모드(Free 포함) 수행 시간 합계

3. **STREAK** (연속 트레이닝 랭킹):
   - 최근 14일 내 연속 수행 최대 일수

**인덱싱 전략**:
- `rankingType`으로 랭킹 타입별 조회
- `rank`로 정렬하여 상위 N명 조회
- `organizationId`로 조직별 랭킹 필터링

---

## 쿼리 패턴 예시

### 사용자별 최근 유효 세션 조회
```typescript
const sessions = await db.get('sessions') || [];
const userSessions = sessions
  .filter(s => s.userId === userId && s.isValid)
  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  .slice(0, 5);
```

### 브레이니멀 타입 결정 (최근 5회 유효 세션)
```typescript
const userSessions = sessions
  .filter(s => s.userId === userId && s.isValid && s.isComposite)
  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  .slice(0, 5);

const metricsScores = await db.get('metricsScores') || [];
const recentScores = userSessions
  .map(s => metricsScores.find(m => m.sessionId === s.id))
  .filter(Boolean);

// 6대 지표 점수 집계 및 브레이니멀 타입 결정 로직 적용
```

### 랭킹 계산 (종합 점수)
```typescript
const sessions = await db.get('sessions') || [];
const userCompositeSessions = sessions
  .filter(s => s.userId === userId && s.isComposite && s.isValid)
  .filter(s => {
    const daysAgo = (Date.now() - new Date(s.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 14;
  })
  .map(s => ({ ...s, weightedScore: (s.score || 0) * 1.2 }))
  .sort((a, b) => b.weightedScore - a.weightedScore)
  .slice(0, 3);

const rankingScore = userCompositeSessions.length > 0
  ? userCompositeSessions.reduce((sum, s) => sum + s.weightedScore, 0) / userCompositeSessions.length
  : 0;
```

---

## 주의사항

1. **성능**: Replit Database는 전체 배열을 메모리에 로드하므로, 데이터가 많아지면 성능 이슈가 발생할 수 있습니다. 필요시 페이지네이션을 구현하세요.

2. **동시성**: 여러 요청이 동시에 같은 데이터를 수정할 경우, 마지막 쓰기가 이전 쓰기를 덮어쓸 수 있습니다. 프로덕션 환경에서는 트랜잭션 로직을 추가하는 것을 권장합니다.

3. **백업**: 중요한 데이터는 주기적으로 백업하는 것을 권장합니다.

4. **마이그레이션**: 스키마 변경 시 기존 데이터 마이그레이션 로직을 추가하세요.

5. **인덱싱**: 자주 조회하는 필드 조합에 대해 인덱싱 전략을 수립하세요. (현재는 배열 필터링 방식)

---

## 데이터 초기화

서버 시작 시 다음 데이터를 초기화해야 합니다:

1. **normConfig**: 규준 설정 (초기값 v1.0)
2. **기본 게임 정보** (선택사항)

초기화 스크립트는 `server/init-norm.ts` 참조.
