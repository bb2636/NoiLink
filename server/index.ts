import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './db.js';
import { initializeNormConfig } from './init-norm.js';
import { runMigrations } from './utils/migration.js';
import { seedAdminAccount } from './utils/seed-admin.js';

// 환경 변수 로드 (루트 .env 파일도 확인)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const app: Express = express();
const PORT = process.env.PORT || 5000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 기본 라우트
app.get('/', (req: Request, res: Response) => {
  res.json({ 
    message: 'NoiLink API Server',
    version: '1.0.0',
    status: 'running'
  });
});

// Health check 엔드포인트
app.get('/health', async (req: Request, res: Response) => {
  try {
    // DB 연결 테스트
    await db.get('health_check');
    res.json({ 
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy',
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API 라우트
import trainingRoutes from './routes/training.js';
import scoreRoutes from './routes/scores.js';
import userRoutes from './routes/users.js';
import sessionRoutes from './routes/sessions.js';
import metricsRoutes from './routes/metrics.js';
import reportRoutes from './routes/reports.js';
import rankingRoutes from './routes/rankings.js';
import homeRoutes from './routes/home.js';
import adminRoutes from './routes/admin.js';
import termsRoutes from './routes/terms.js';

app.use('/api/training', trainingRoutes);
app.use('/api/scores', scoreRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/rankings', rankingRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/terms', termsRoutes);

// 에러 핸들링 미들웨어
app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// 404 핸들러
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// 서버 시작
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`📊 Database: Replit Database`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // 데이터베이스 초기화
  try {
    // 마이그레이션 실행
    await runMigrations();
    
    // NormConfig 초기화
    await initializeNormConfig();
    
    // 관리자 시드 계정 생성
    await seedAdminAccount();
  } catch (error) {
    console.error('⚠️  Failed to initialize database:', error);
  }
});
