# 📂 NoiLink 프로젝트 폴더 구조

```
NoiLink/
├── .gitignore                    # Git 무시 파일
├── README.md                      # 프로젝트 설명서
├── PROJECT_STRUCTURE.md           # 이 파일 (폴더 구조 설명)
├── package.json                   # 루트 패키지 (monorepo 설정)
│
├── client/                        # React 프론트엔드 (Vite)
│   ├── package.json              # 클라이언트 패키지 설정
│   ├── vite.config.ts            # Vite 설정
│   ├── tsconfig.json             # TypeScript 설정
│   ├── tsconfig.node.json        # Node TypeScript 설정
│   ├── tailwind.config.js        # Tailwind CSS 설정
│   ├── postcss.config.js         # PostCSS 설정
│   ├── index.html                # HTML 진입점
│   │
│   └── src/
│       ├── components/            # 공통 UI 컴포넌트
│       │   ├── Button/           # 버튼 컴포넌트
│       │   ├── Card/             # 카드 컴포넌트
│       │   ├── Layout/           # 레이아웃 컴포넌트
│       │   └── ...
│       │
│       ├── pages/                # 페이지 컴포넌트
│       │   ├── Home.tsx          # 홈 페이지
│       │   ├── Training.tsx      # 트레이닝 페이지
│       │   ├── Result.tsx        # 결과 페이지
│       │   ├── Profile.tsx       # 프로필 페이지
│       │   ├── Login.tsx         # 로그인 페이지
│       │   ├── SignUp.tsx        # 회원가입 페이지
│       │   ├── Ranking.tsx       # 랭킹 페이지
│       │   └── ...
│       │
│       ├── hooks/                # 커스텀 훅
│       │   ├── useGame.ts        # 게임 로직 훅
│       │   ├── useScore.ts       # 점수 관리 훅
│       │   ├── useUser.ts        # 사용자 관리 훅
│       │   └── ...
│       │
│       ├── utils/                # 유틸리티 함수
│       │   ├── api.ts            # API 클라이언트
│       │   ├── constants.ts      # 상수 정의
│       │   └── ...
│       │
│       ├── styles/               # 스타일 파일
│       │   ├── index.css         # 전역 스타일
│       │   └── ...
│       │
│       ├── App.tsx               # 메인 App 컴포넌트
│       ├── main.tsx              # React 진입점
│       └── ...
│
├── server/                        # Express 백엔드
│   ├── package.json              # 서버 패키지 설정
│   ├── tsconfig.json             # TypeScript 설정
│   ├── index.ts                  # 서버 진입점 (Express + Replit DB)
│   ├── db-schema.md              # 데이터베이스 스키마 설계 문서
│   │
│   └── routes/                    # API 라우트
│       ├── training.ts           # 트레이닝 게임 API
│       │   ├── GET /api/training/games
│       │   ├── GET /api/training/games/:gameId
│       │   └── POST /api/training/games
│       │
│       ├── scores.ts             # 점수 관리 API
│       │   ├── POST /api/scores
│       │   ├── GET /api/scores/user/:userId
│       │   ├── GET /api/scores/game/:gameId
│       │   └── GET /api/scores/leaderboard
│       │
│       └── users.ts              # 사용자 관리 API
│           ├── POST /api/users
│           ├── GET /api/users/:userId
│           ├── PUT /api/users/:userId
│           └── GET /api/users/:userId/stats
│
└── shared/                        # 공통 타입 정의
    ├── package.json              # 공유 패키지 설정
    ├── tsconfig.json             # TypeScript 설정
    ├── types.ts                  # 공통 타입 정의
    │   ├── User
    │   ├── Score
    │   ├── Game
    │   ├── ApiResponse
    │   └── ...
    └── index.ts                  # 타입 export
```

## 📋 주요 파일 설명

### 루트 레벨
- `package.json`: Monorepo 설정, 클라이언트/서버 동시 실행 스크립트
- `.gitignore`: Git 무시 파일 목록

### Client (프론트엔드)
- `vite.config.ts`: Vite 빌드 도구 설정, API 프록시 설정
- `tailwind.config.js`: Tailwind CSS 커스텀 설정
- `src/main.tsx`: React 애플리케이션 진입점
- `src/App.tsx`: 메인 App 컴포넌트 (라우팅 포함)

### Server (백엔드)
- `index.ts`: Express 서버 설정, Replit DB 연결, 라우트 등록
- `routes/*.ts`: 각 도메인별 API 엔드포인트 정의
- `db-schema.md`: 데이터베이스 스키마 설계 문서

### Shared (공통)
- `types.ts`: 클라이언트와 서버에서 공유하는 TypeScript 타입 정의

## 🚀 다음 단계

1. **클라이언트 기본 구조 생성**
   - `client/src/main.tsx`
   - `client/src/App.tsx`
   - `client/src/styles/index.css`

2. **공통 컴포넌트 생성**
   - Button, Card, Layout 컴포넌트

3. **페이지 컴포넌트 생성**
   - Figma 디자인 기반 페이지 구현

4. **커스텀 훅 생성**
   - 게임 로직, API 호출 훅
