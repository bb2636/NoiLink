# NoiLink (뇌지컬 트레이닝)

인지 능력을 테스트하고 훈련하는 모바일 웹 앱입니다. 6대 인지 지표(기억력, 이해력, 집중력, 판단력, 순발력, 지구력)를 측정하고, 사용자의 브레이니멀 타입을 분석하여 맞춤형 트레이닝을 제공합니다.

## 🛠 Tech Stack

- **Frontend**: React.js (Vite), Tailwind CSS, Framer Motion
- **Backend**: Node.js (Express), TypeScript
- **Database**: PostgreSQL (Supabase) / Replit Database / Local JSON
- **Authentication**: JWT (JSON Web Token)
- **Language**: TypeScript

## 📂 Project Structure

```
NoiLink/
├── client/                 # React 프론트엔드 (Vite)
│   ├── src/
│   │   ├── components/     # 공통 UI 컴포넌트
│   │   │   ├── Button/      # 버튼 컴포넌트
│   │   │   ├── Card/        # 카드 컴포넌트
│   │   │   ├── Layout/      # 레이아웃 컴포넌트 (MobileLayout)
│   │   │   ├── ConfirmModal/# 확인 모달 컴포넌트
│   │   │   ├── TermsModal/  # 약관 모달 컴포넌트
│   │   │   ├── RadarChart/  # 레이더 차트
│   │   │   └── LineChart/   # 라인 차트
│   │   ├── pages/          # 페이지 컴포넌트
│   │   │   ├── Home.tsx     # 홈 페이지
│   │   │   ├── Login.tsx    # 로그인 페이지
│   │   │   ├── SignUp.tsx   # 회원가입 페이지
│   │   │   ├── Profile.tsx  # 마이페이지
│   │   │   ├── EditProfile.tsx # 프로필 수정
│   │   │   ├── FindPassword.tsx # 비밀번호 찾기
│   │   │   ├── Training.tsx # 트레이닝 페이지
│   │   │   ├── Report.tsx   # 리포트 페이지
│   │   │   ├── Ranking.tsx  # 랭킹 페이지
│   │   │   ├── Record.tsx   # 기록 페이지
│   │   │   ├── Support.tsx  # 고객센터 (1:1 문의)
│   │   │   ├── InquiryDetail.tsx # 문의 상세보기
│   │   │   └── admin/       # 관리자 페이지
│   │   │       ├── AdminSupport.tsx # 관리자 고객센터
│   │   │       ├── AdminTerms.tsx   # 관리자 약관 관리
│   │   │       └── ...
│   │   ├── hooks/           # 커스텀 훅
│   │   │   ├── useAuth.ts   # 인증 훅
│   │   │   └── useHome.ts   # 홈 데이터 훅
│   │   ├── utils/           # 유틸리티 함수
│   │   │   ├── api.ts       # API 클라이언트
│   │   │   ├── constants.ts # 상수 정의
│   │   │   ├── brainAge.ts  # 뇌지컬 나이 계산
│   │   │   └── brainimalIcons.ts # 브레이니멀 아이콘
│   │   └── styles/          # 스타일 파일
│   └── package.json
├── server/                 # Express 백엔드
│   ├── routes/             # API 라우트
│   │   ├── users.ts        # 사용자 관리 API
│   │   ├── training.ts     # 트레이닝 게임 API
│   │   ├── scores.ts       # 점수 관리 API
│   │   ├── sessions.ts     # 세션 관리 API
│   │   ├── metrics.ts      # 지표 계산 API
│   │   ├── reports.ts      # 리포트 생성 API
│   │   ├── rankings.ts     # 랭킹 API
│   │   ├── home.ts         # 홈 화면 데이터 API
│   │   ├── admin.ts        # 관리자 API
│   │   └── terms.ts        # 약관 관리 API
│   ├── services/           # 비즈니스 로직
│   │   ├── score-calculator.ts    # 점수 계산 로직
│   │   ├── brainimal-detector.ts  # 브레이니멀 타입 결정
│   │   └── report-generator.ts    # 리포트 생성
│   ├── db/                 # 데이터베이스 어댑터
│   │   ├── interface.ts    # 데이터베이스 인터페이스
│   │   ├── postgres.ts     # PostgreSQL 구현
│   │   ├── replit.ts       # Replit DB 구현
│   │   └── local.ts        # 로컬 JSON 구현
│   ├── middleware/         # 미들웨어
│   │   └── auth.ts         # 인증 미들웨어
│   ├── utils/              # 유틸리티
│   │   ├── jwt.ts          # JWT 토큰 관리
│   │   ├── migration.ts    # 데이터베이스 마이그레이션
│   │   └── seed-admin.ts   # 관리자 계정 시드
│   ├── index.ts            # 서버 진입점
│   ├── db.ts               # 데이터베이스 초기화
│   ├── init-norm.ts        # Norm 설정 초기화
│   └── db-schema.md        # 데이터베이스 스키마 문서
├── shared/                 # 공통 타입 정의
│   ├── types.ts            # 공통 TypeScript 타입
│   └── package.json
└── package.json            # 루트 패키지 (monorepo)
```

## 🚀 Getting Started

### 사전 요구사항

- Node.js >= 18.0.0
- npm 또는 yarn

### 설치

```bash
# 모든 패키지 설치
npm run install:all
```

### 환경 변수 설정

`.env` 파일을 루트 디렉토리에 생성하고 다음 변수를 설정하세요:

```env
# 데이터베이스 설정
DB_TYPE=postgres
DATABASE_URL=postgresql://user:password@host:port/database

# JWT 설정
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# 서버 포트 (선택사항)
PORT=5000
```

**Supabase 사용 시:**
- Supabase 대시보드에서 Connection Pooling URL을 복사하여 `DATABASE_URL`에 설정
- 형식: `postgresql://postgres.xxx:password@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres`

### 개발 서버 실행

```bash
# 클라이언트와 서버 동시 실행
npm run dev
```

이 명령어는 클라이언트(포트 3000)와 서버(포트 5000)를 동시에 실행합니다.

### 개별 실행

```bash
# 서버만 실행
npm run dev:server

# 클라이언트만 실행
npm run dev:client
```

### 빌드

```bash
# 전체 빌드
npm run build

# 개별 빌드
npm run build:client  # 클라이언트만
npm run build:server  # 서버만
```

### 프로덕션 실행

```bash
npm run build
npm start
```

## 📡 주요 API 엔드포인트

### 인증 (Authentication)
- `POST /api/users` - 회원가입
- `POST /api/users/login` - 로그인 (JWT 토큰 발급)
- `GET /api/users/me` - 현재 사용자 정보 조회 (JWT 인증)
- `PUT /api/users/me` - 프로필 수정 (JWT 인증)
- `GET /api/users/find-by-phone/:phone` - 휴대폰 번호로 사용자 찾기
- `POST /api/users/reset-password` - 비밀번호 재설정

### 사용자 (Users)
- `GET /api/users/:userId` - 사용자 정보 조회
- `GET /api/users/:userId/stats` - 사용자 통계 조회
- `GET /api/users/check-username/:username` - 닉네임 중복 확인
- `GET /api/users/check-name/:name` - 이름 중복 확인
- `POST /api/users/inquiries` - 문의 생성
- `GET /api/users/inquiries/:userId` - 사용자 문의 목록 조회

### 세션 (Sessions)
- `POST /api/sessions` - 세션 생성
- `GET /api/sessions/user/:userId` - 사용자 세션 목록 조회

### 지표 (Metrics)
- `POST /api/metrics/raw` - 원시 지표 저장
- `POST /api/metrics/calculate` - 지표 점수 계산

### 리포트 (Reports)
- `POST /api/reports/generate` - 리포트 생성
- `GET /api/reports/user/:userId` - 사용자 리포트 목록

### 랭킹 (Rankings)
- `GET /api/rankings` - 랭킹 조회 (타입별)

### 홈 (Home)
- `GET /api/home/condition/:userId` - 오늘의 컨디션
- `GET /api/home/mission/:userId` - 오늘의 미션
- `GET /api/home/quickstart/:userId` - 빠른 시작 추천

### 관리자 (Admin)
- `GET /api/admin/dashboard` - 관리자 대시보드
- `GET /api/admin/users` - 사용자 목록
- `GET /api/admin/organizations` - 기관 목록
- `GET /api/admin/sessions` - 세션 목록
- `GET /api/admin/inquiries` - 문의 목록 조회
- `POST /api/admin/inquiries/:id/answer` - 문의 답변 등록
- `GET /api/admin/terms` - 약관 목록
- `POST /api/admin/terms` - 약관 생성
- `PUT /api/admin/terms/:id` - 약관 수정
- `DELETE /api/admin/terms/:id` - 약관 삭제

### 약관 (Terms)
- `GET /api/terms` - 활성 약관 목록
- `GET /api/terms/:type` - 특정 타입 약관 조회

## 🗄 Database

여러 데이터베이스 백엔드를 지원합니다:

- **PostgreSQL (Supabase)** - 개발 환경 권장 ✅ 현재 사용 중
- **Replit Database** - Replit 배포 환경
- **로컬 JSON 파일** - 간단한 테스트 (fallback)

데이터베이스는 환경 변수에 따라 자동으로 선택됩니다:
1. `DB_TYPE=postgres` 또는 `DATABASE_URL`이 설정되면 PostgreSQL 사용
2. Replit 환경이면 Replit Database 사용
3. 그 외에는 로컬 JSON 파일 사용

스키마 설계는 `server/db-schema.md`를 참고하세요.

## 🔐 인증 시스템

### JWT 토큰 기반 인증

- 로그인 시 JWT 토큰이 발급됩니다
- 토큰은 `localStorage`에 `noilink_token` 키로 저장됩니다
- API 요청 시 `Authorization: Bearer {token}` 헤더로 전송됩니다
- 토큰 만료 시간: 7일 (환경 변수로 설정 가능)
- **자동 리디렉션**: 토큰이 없거나 만료된 경우 자동으로 로그인 페이지로 리디렉션됩니다
- **보호된 라우트**: `ProtectedRoute` 컴포넌트로 인증이 필요한 페이지를 보호합니다

### 사용자 역할

- **PERSONAL**: 개인 회원
- **ORGANIZATION**: 기업 회원
- **ADMIN**: 관리자 (시드 계정: admin@admin.com / admin1234)

### 보호된 라우트

- `requireAuth`: 로그인 필요
- `requireAdmin`: 관리자 권한 필요
- `optionalAuth`: 선택적 인증 (로그인하지 않아도 접근 가능)

## 📱 주요 기능

### 사용자 기능
- ✅ 회원가입 (개인/기업 구분)
- ✅ 로그인/로그아웃 (JWT 인증, 토큰 없을 시 자동 리디렉션)
- ✅ 비밀번호 찾기 (휴대폰 인증)
- ✅ 프로필 수정 (이메일/비밀번호 확인 후 수정)
- ✅ 마이페이지 (브레이니멀 타입, 뇌지컬 나이 표시, 약관 조회)
- ✅ 홈 화면 (오늘의 컨디션, 미션, 빠른 시작, 배너 자동 슬라이드)
- ✅ 리포트 (6대 지표 시각화, 트렌드 분석)
- ✅ 랭킹 (종합 점수, 시간, 스트릭)
- ✅ 고객센터 (1:1 문의하기, 문의 내역 조회, 문의 상세보기)
- ✅ 약관 동의 (회원가입 시, 마이페이지에서 조회)

### 관리자 기능
- ✅ 대시보드 (통계, 사용자 현황)
- ✅ 사용자 관리
- ✅ 고객센터 관리 (문의 목록 조회, 답변 등록, 상태 관리)
- ✅ 배너 관리 (CRUD)
- ✅ 리포트 관리
- ✅ 약관 관리 (CRUD)

### 데이터 분석
- ✅ 6대 인지 지표 계산 (기억력, 이해력, 집중력, 판단력, 순발력, 지구력)
- ✅ 브레이니멀 타입 결정 (12가지 타입)
- ✅ 뇌지컬 나이 계산
- ✅ 리포트 자동 생성 (템플릿 기반)

## 🎨 UI/UX 특징

- 다크 테마 (#0A0A0A 배경)
- 모바일 최적화 (반응형 디자인)
- **Safe Area 지원** (iOS 노치, 하단 네비게이션 바, 시스템 UI 영역 자동 조정)
- **고정 하단 네비게이션 바** (타원형 버튼 디자인, 활성 상태 표시)
- **홈 화면 배너 자동 슬라이드** (5초 간격, 카운트 표시)
- Pretendard 폰트 사용
- Framer Motion 애니메이션
- **약관 모달 컴포넌트** (재사용 가능한 약관 표시)
- **문의 상세보기 페이지** (모달 대신 전용 페이지)

## 📝 개발 참고사항

### 데이터베이스 마이그레이션

서버 시작 시 자동으로 마이그레이션이 실행됩니다. 수동 실행이 필요한 경우:

```bash
cd server
npx tsx utils/migration.ts
```

### 관리자 계정 생성

서버 시작 시 자동으로 관리자 계정이 생성됩니다:
- 이메일: `admin@admin.com`
- 비밀번호: `admin1234`

### 환경 변수

필수 환경 변수:
- `DATABASE_URL`: PostgreSQL 연결 문자열 (Supabase 사용 시)

선택적 환경 변수:
- `DB_TYPE`: 데이터베이스 타입 (`postgres`, `replit`, `local`)
- `JWT_SECRET`: JWT 서명 키 (기본값: `noilink-secret-key`)
- `JWT_EXPIRES_IN`: JWT 만료 시간 (기본값: `7d`)
- `PORT`: 서버 포트 (기본값: `5000`)

## 📚 문서

- `PROJECT_STRUCTURE.md`: 프로젝트 폴더 구조 상세 설명
- `DATABASE_SETUP.md`: 데이터베이스 설정 가이드
- `server/db-schema.md`: 데이터베이스 스키마 설계 문서

## 🔧 스크립트

```bash
# 개발
npm run dev              # 클라이언트 + 서버 동시 실행
npm run dev:client       # 클라이언트만 실행
npm run dev:server       # 서버만 실행

# 빌드
npm run build            # 전체 빌드
npm run build:client     # 클라이언트 빌드
npm run build:server     # 서버 빌드

# 설치
npm run install:all     # 모든 패키지 설치
```

## 📝 License

MIT
