# NoiLink (뇌지컬 트레이닝)

인지 능력을 테스트하고 훈련하는 모바일 웹 앱입니다.

## 🛠 Tech Stack

- **Frontend**: React.js (Vite), Tailwind CSS, Framer Motion
- **Backend**: Node.js (Express)
- **Database**: Replit Database
- **Language**: TypeScript

## 📂 Project Structure

```
NoiLink/
├── client/                 # React 프론트엔드 (Vite)
│   ├── src/
│   │   ├── components/     # 공통 UI 컴포넌트
│   │   ├── pages/          # 페이지 컴포넌트
│   │   ├── hooks/          # 커스텀 훅
│   │   └── ...
│   └── package.json
├── server/                 # Express 백엔드
│   ├── routes/             # API 라우트
│   │   ├── training.ts     # 트레이닝 게임 API
│   │   ├── scores.ts       # 점수 관리 API
│   │   └── users.ts        # 사용자 관리 API
│   ├── index.ts            # 서버 진입점
│   └── package.json
├── shared/                 # 공통 타입 정의
│   └── package.json
└── package.json            # 루트 패키지 (monorepo)
```

## 🚀 Getting Started

### 설치

```bash
npm run install:all
```

### 개발 서버 실행

```bash
npm run dev
```

이 명령어는 클라이언트와 서버를 동시에 실행합니다.

### 개별 실행

```bash
# 서버만 실행
npm run dev:server

# 클라이언트만 실행
npm run dev:client
```

### 빌드

```bash
npm run build
```

## 📡 API 엔드포인트

### 사용자 (Users)
- `POST /api/users` - 회원가입
- `GET /api/users/:userId` - 사용자 정보 조회
- `PUT /api/users/:userId` - 사용자 정보 업데이트
- `GET /api/users/:userId/stats` - 사용자 통계 조회

### 점수 (Scores)
- `POST /api/scores` - 점수 저장
- `GET /api/scores/user/:userId` - 사용자 점수 조회
- `GET /api/scores/game/:gameId` - 게임별 랭킹
- `GET /api/scores/leaderboard` - 전체 랭킹

### 트레이닝 (Training)
- `GET /api/training/games` - 게임 목록 조회
- `GET /api/training/games/:gameId` - 게임 정보 조회
- `POST /api/training/games` - 게임 생성 (관리자)

## 🗄 Database

여러 데이터베이스 백엔드를 지원합니다:
- **PostgreSQL** (Neon/Supabase) - 개발 환경 권장
- **Replit Database** - Replit 배포 환경
- **로컬 JSON 파일** - 간단한 테스트

자세한 설정 방법은 `DATABASE_SETUP.md`를 참고하세요.
스키마 설계는 `server/db-schema.md`를 참고하세요.

## 📝 License

MIT
