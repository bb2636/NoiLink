/**
 * Terms API 라우트
 * 약관 조회 (일반 사용자용)
 */
import { Router, Request, Response } from 'express';
import { db } from '../db.js';
import type { Terms, TermsType } from '@noilink/shared';

const router = Router();

/**
 * GET /api/terms
 * 활성화된 약관 목록 조회
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { type } = req.query;
    const terms = await db.get('terms') || [];
    
    let filteredTerms = terms.filter((t: Terms) => t.isActive);
    
    if (type) {
      filteredTerms = filteredTerms.filter((t: Terms) => t.type === type);
    }
    
    // 최신 버전만 반환
    const latestTerms: Terms[] = [];
    const termsByType = new Map<TermsType, Terms>();
    
    filteredTerms.forEach((term: Terms) => {
      const existing = termsByType.get(term.type);
      if (!existing || term.version > existing.version) {
        termsByType.set(term.type, term);
      }
    });
    
    termsByType.forEach((term) => {
      latestTerms.push(term);
    });
    
    res.json({ success: true, data: latestTerms });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/terms/:type
 * 특정 타입의 최신 약관 조회
 */
router.get('/:type', async (req: Request, res: Response) => {
  try {
    const { type } = req.params;
    const terms = await db.get('terms') || [];
    
    const typeTerms = terms.filter((t: Terms) => 
      t.type === type.toUpperCase() && t.isActive
    );
    
    if (typeTerms.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Terms not found'
      });
    }
    
    // 최신 버전 찾기
    const latestTerm = typeTerms.reduce((latest: Terms, current: Terms) => {
      return current.version > latest.version ? current : latest;
    }, typeTerms[0]);
    
    res.json({ success: true, data: latestTerm });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
