import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { db } from './db.js';
import { initializeNormConfig } from './init-norm.js';
import { runMigrations } from './utils/migration.js';
import { seedAdminAccount } from './utils/seed-admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const app: Express = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

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

const isBuilt = __dirname.endsWith('dist');
const serverRoot = isBuilt ? join(__dirname, '..') : __dirname;
const clientDist = join(serverRoot, '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req: Request, res: Response, next: Function) => {
    if (req.path.startsWith('/api/') || req.path === '/health') {
      return next();
    }
    res.sendFile(join(clientDist, 'index.html'));
  });
}

app.use((err: Error, req: Request, res: Response, next: Function) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// 서버 시작 — DB 초기화/시드 완료 후 listen 으로 트래픽 수용
// (이렇게 하지 않으면 시드와 동시에 들어온 회원가입 요청이 mustChange/RMW race 발생)
async function bootstrap(): Promise<void> {
  console.log(`📊 Database: ${process.env.DB_TYPE || 'auto-detect'}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  try {
    await runMigrations();
    await initializeNormConfig();
    await seedAdminAccount();
  } catch (error) {
    console.error('⚠️  Failed to initialize database:', error);
    // init 실패 시 listen 하지 않음 (잘못된 상태로 트래픽 받지 않도록)
    process.exit(1);
  }
  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
  });
}
bootstrap();
