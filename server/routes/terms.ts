/**
 * Terms API 라우트
 * 약관 조회 (일반 사용자용)
 */
import { Router, Request, Response } from 'express';
import { listAllTerms, listTermsByType } from '../db/repositories/index.js';
import type { Terms, TermsType } from '@noilink/shared';

const router = Router();

/**
 * GET /api/terms
 * 활성화된 약관 목록 조회 (타입별 최신 버전만)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { type } = req.query;

    const filteredTerms = type
      ? (await listTermsByType(type as TermsType, { activeOnly: true }))
      : (await listAllTerms()).filter((t: Terms) => t.isActive);

    const termsByType = new Map<TermsType, Terms>();
    filteredTerms.forEach((term: Terms) => {
      const existing = termsByType.get(term.type);
      if (!existing || term.version > existing.version) {
        termsByType.set(term.type, term);
      }
    });

    const latestTerms: Terms[] = [];
    termsByType.forEach((term) => latestTerms.push(term));

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
    const typeTerms = await listTermsByType(type.toUpperCase() as TermsType, { activeOnly: true });

    if (typeTerms.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Terms not found'
      });
    }

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
