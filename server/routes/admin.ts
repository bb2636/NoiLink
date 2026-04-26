/**
 * Admin API 라우트
 * 백오피스 관리자 전용 API
 */
import { Router, Response } from 'express';
import { db } from '../db.js';
import { requireAdmin, AuthRequest } from '../middleware/auth.js';
import type { User, Session, Organization, Terms, TermsType, RawMetrics, RecoveryRawMetrics } from '@noilink/shared';
import {
  aggregateRecoveryStats,
  RECOVERY_COACHING_THRESHOLD_MS,
  RECOVERY_COACHING_MIN_SESSIONS,
} from '@noilink/shared';

const router = Router();

// 모든 라우트에 관리자 권한 체크 적용
router.use(requireAdmin);

/**
 * GET /api/admin/dashboard
 * 관리자 대시보드 데이터
 */
router.get('/dashboard', async (req: AuthRequest, res: Response) => {
  try {
    const users = await db.get('users') || [];
    const sessions = await db.get('sessions') || [];
    const organizations = await db.get('organizations') || [];
    
    const stats = {
      totalUsers: users.length,
      personalUsers: users.filter((u: User) => u.userType === 'PERSONAL').length,
      organizationUsers: users.filter((u: User) => u.userType === 'ORGANIZATION').length,
      totalSessions: sessions.length,
      totalOrganizations: organizations.length,
      activeUsers: users.filter((u: User) => {
        if (!u.lastLoginAt) return false;
        const lastLogin = new Date(u.lastLoginAt);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return lastLogin >= sevenDaysAgo;
      }).length,
    };
    
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/admin/users
 * 전체 사용자 목록 조회
 */
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 50, userType } = req.query;
    const users = await db.get('users') || [];
    
    let filteredUsers = users;
    if (userType) {
      filteredUsers = users.filter((u: User) => u.userType === userType);
    }
    
    const startIndex = (Number(page) - 1) * Number(limit);
    const endIndex = startIndex + Number(limit);
    const paginatedUsers = filteredUsers.slice(startIndex, endIndex);
    
    res.json({
      success: true,
      data: paginatedUsers,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: filteredUsers.length,
        totalPages: Math.ceil(filteredUsers.length / Number(limit))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/admin/organizations
 * 전체 조직 목록 조회
 */
router.get('/organizations', async (req: AuthRequest, res: Response) => {
  try {
    const organizations = await db.get('organizations') || [];
    res.json({ success: true, data: organizations });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/admin/sessions
 * 전체 세션 목록 조회
 */
router.get('/sessions', async (req: AuthRequest, res: Response) => {
  try {
    const { page = 1, limit = 50, userId } = req.query;
    const sessions = await db.get('sessions') || [];
    
    let filteredSessions = sessions;
    if (userId) {
      filteredSessions = sessions.filter((s: Session) => s.userId === userId);
    }
    
    const startIndex = (Number(page) - 1) * Number(limit);
    const endIndex = startIndex + Number(limit);
    const paginatedSessions = filteredSessions.slice(startIndex, endIndex);
    
    res.json({
      success: true,
      data: paginatedSessions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: filteredSessions.length,
        totalPages: Math.ceil(filteredSessions.length / Number(limit))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/admin/terms
 * 전체 약관 목록 조회 (관리자용)
 */
router.get('/terms', async (req: AuthRequest, res: Response) => {
  try {
    const terms = await db.get('terms') || [];
    res.json({ success: true, data: terms });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/terms
 * 새 약관 생성
 */
router.post('/terms', async (req: AuthRequest, res: Response) => {
  try {
    const { type, title, content, isRequired } = req.body;
    
    if (!type || !title || !content) {
      return res.status(400).json({
        success: false,
        error: 'Type, title, and content are required'
      });
    }
    
    const terms = await db.get('terms') || [];
    
    // 해당 타입의 최신 버전 찾기
    const typeTerms = terms.filter((t: Terms) => t.type === type);
    const latestVersion = typeTerms.length > 0
      ? Math.max(...typeTerms.map((t: Terms) => t.version || 1))
      : 0;
    
    const newTerm: Terms = {
      id: `terms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: type as TermsType,
      title,
      content,
      version: latestVersion + 1,
      isRequired: isRequired !== undefined ? Boolean(isRequired) : true,
      isActive: true,
      createdAt: new Date().toISOString(),
      createdBy: req.user?.id,
    };
    
    terms.push(newTerm);
    await db.set('terms', terms);
    
    res.status(201).json({ success: true, data: newTerm });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/admin/terms/:id
 * 약관 수정
 */
router.put('/terms/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, isRequired, isActive } = req.body;
    
    const terms = await db.get('terms') || [];
    const termIndex = terms.findIndex((t: Terms) => t.id === id);
    
    if (termIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Terms not found'
      });
    }
    
    terms[termIndex] = {
      ...terms[termIndex],
      ...(title && { title }),
      ...(content && { content }),
      ...(isRequired !== undefined && { isRequired: Boolean(isRequired) }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      updatedAt: new Date().toISOString(),
    };
    
    await db.set('terms', terms);
    
    res.json({ success: true, data: terms[termIndex] });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/admin/terms/:id
 * 약관 삭제 (비활성화)
 */
router.delete('/terms/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    
    const terms = await db.get('terms') || [];
    const termIndex = terms.findIndex((t: Terms) => t.id === id);
    
    if (termIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Terms not found'
      });
    }
    
    // 실제 삭제 대신 비활성화
    terms[termIndex].isActive = false;
    terms[termIndex].updatedAt = new Date().toISOString();
    
    await db.set('terms', terms);
    
    res.json({ success: true, message: 'Terms deactivated' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/admin/banners
 * 배너 목록 조회
 */
router.get('/banners', async (req: AuthRequest, res: Response) => {
  try {
    const banners = await db.get('banners') || [];
    res.json({ success: true, data: banners });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/banners
 * 배너 등록
 */
router.post('/banners', async (req: AuthRequest, res: Response) => {
  try {
    // FormData 처리
    const contentType = req.headers['content-type'] || '';
    
    if (contentType.includes('multipart/form-data')) {
      // FormData로 전송된 경우
      // 실제로는 multer 같은 미들웨어가 필요하지만, 
      // 일단 간단하게 처리하기 위해 body-parser의 raw 옵션 사용 불가
      // 클라이언트에서 base64로 변환해서 보내거나, 
      // multer를 설치해서 사용해야 함
      
      // 임시로: 클라이언트에서 base64로 변환해서 보내도록 변경
      return res.status(400).json({
        success: false,
        error: 'Please use base64 image format or install multer for file uploads'
      });
    }
    
    const { title, imageUrl, imageBase64 } = req.body;
    
    if (!title) {
      return res.status(400).json({
        success: false,
        error: 'Title is required'
      });
    }
    
    // imageUrl 또는 imageBase64 중 하나는 있어야 함
    let finalImageUrl = imageUrl;
    
    if (imageBase64 && !imageUrl) {
      // base64 이미지를 data URL로 사용
      finalImageUrl = imageBase64;
    }
    
    if (!finalImageUrl) {
      return res.status(400).json({
        success: false,
        error: 'Image is required'
      });
    }
    
    const banners = await db.get('banners') || [];
    
    const newBanner = {
      id: `banner_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title,
      imageUrl: finalImageUrl,
      createdAt: new Date().toISOString(),
      order: banners.length,
    };
    
    banners.push(newBanner);
    await db.set('banners', banners);
    
    res.status(201).json({ success: true, data: newBanner });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/admin/banners/:id
 * 배너 수정 (order 등)
 */
router.put('/banners/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { order, title, imageUrl } = req.body;
    
    const banners = await db.get('banners') || [];
    const bannerIndex = banners.findIndex((b: any) => b.id === id);
    
    if (bannerIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Banner not found'
      });
    }
    
    if (order !== undefined) banners[bannerIndex].order = order;
    if (title !== undefined) banners[bannerIndex].title = title;
    if (imageUrl !== undefined) banners[bannerIndex].imageUrl = imageUrl;
    
    await db.set('banners', banners);
    
    res.json({ success: true, data: banners[bannerIndex] });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/admin/banners/:id
 * 배너 삭제
 */
router.delete('/banners/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const banners = await db.get('banners') || [];
    const filteredBanners = banners.filter((b: any) => b.id !== id);
    
    await db.set('banners', filteredBanners);
    
    res.json({ success: true, message: 'Banner deleted' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/admin/inquiries
 * 문의 목록 조회
 */
router.get('/inquiries', async (req: AuthRequest, res: Response) => {
  try {
    const inquiries = await db.get('inquiries') || [];
    res.json({ success: true, data: inquiries });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/inquiries/:id/answer
 * 문의 답변
 */
router.post('/inquiries/:id/answer', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { answer } = req.body;
    
    if (!answer) {
      return res.status(400).json({
        success: false,
        error: 'Answer is required'
      });
    }
    
    const inquiries = await db.get('inquiries') || [];
    const inquiryIndex = inquiries.findIndex((i: any) => i.id === id);
    
    if (inquiryIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Inquiry not found'
      });
    }
    
    inquiries[inquiryIndex] = {
      ...inquiries[inquiryIndex],
      answer,
      status: 'ANSWERED',
      answerDate: new Date().toISOString(),
    };
    
    await db.set('inquiries', inquiries);
    
    res.json({ success: true, data: inquiries[inquiryIndex] });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/admin/recovery-stats
 * 사용자별 BLE 회복 통계 (최근 7일/30일 윈도)
 *
 * 회복 시간이 잦은 사용자/기기를 식별해 운영자가 환경 점검을 안내할 수 있게 한다.
 * - period=7d|30d (기본 7d) 의 createdAt 윈도로 rawMetrics 를 자른 뒤 userId 별로 그룹화
 * - shared/recovery-stats 의 aggregateRecoveryStats 에 "세션당 1엔트리" (recovery 없으면 null)
 *   를 그대로 넘겨서 분모(sessionsCount)를 올바르게 유지
 * - exceedsThreshold: shouldShowRecoveryCoaching 과 동일 기준
 *   (sessionsCount >= 3 AND avgMsPerSession >= 30s)
 */
router.get('/recovery-stats', async (req: AuthRequest, res: Response) => {
  try {
    const periodParam = String(req.query.period || '7d');
    const periodDays = periodParam === '30d' ? 30 : 7;
    const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;

    const [rawMetricsList, users] = await Promise.all([
      db.get('rawMetrics') as Promise<RawMetrics[] | undefined>,
      db.get('users') as Promise<User[] | undefined>,
    ]);

    const rawList = rawMetricsList || [];
    const userList = users || [];

    // userId -> recovery 엔트리 배열 (세션 1개당 1엔트리, recovery 없으면 null)
    const buckets = new Map<string, Array<RecoveryRawMetrics | null>>();
    for (const m of rawList) {
      if (!m.userId) continue;
      const ts = m.createdAt ? Date.parse(m.createdAt) : NaN;
      if (!Number.isFinite(ts) || ts < cutoff) continue;
      const arr = buckets.get(m.userId) || [];
      arr.push(m.recovery ?? null);
      buckets.set(m.userId, arr);
    }

    const userById = new Map<string, User>();
    for (const u of userList) userById.set(u.id, u);

    const rows = Array.from(buckets.entries()).map(([userId, recoveries]) => {
      const stats = aggregateRecoveryStats(recoveries);
      const u = userById.get(userId);
      const exceedsThreshold =
        stats.sessionsCount >= RECOVERY_COACHING_MIN_SESSIONS &&
        stats.avgMsPerSession >= RECOVERY_COACHING_THRESHOLD_MS;
      return {
        userId,
        name: u?.name ?? null,
        email: u?.email ?? null,
        userType: u?.userType ?? null,
        sessionsCount: stats.sessionsCount,
        sessionsWithRecovery: stats.sessionsWithRecovery,
        totalMs: stats.totalMs,
        windowsTotal: stats.windowsTotal,
        avgMsPerSession: stats.avgMsPerSession,
        exceedsThreshold,
      };
    });

    res.json({
      success: true,
      data: {
        period: periodDays === 30 ? '30d' : '7d',
        threshold: {
          avgMsPerSession: RECOVERY_COACHING_THRESHOLD_MS,
          minSessions: RECOVERY_COACHING_MIN_SESSIONS,
        },
        rows,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
