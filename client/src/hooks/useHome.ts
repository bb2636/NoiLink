import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import type { DailyCondition, DailyMission } from '@noilink/shared';

interface HomeCache {
  condition: DailyCondition | null;
  mission: DailyMission | null;
  quickStart: any;
  banners: any[];
  fetchedAt: number;
}

// 사용자별 모듈 단위 캐시 — 탭 이동 후 재진입 시 즉시 이전 데이터 노출.
const cache = new Map<string, HomeCache>();
// 사용자별 in-flight 가드 — StrictMode 이중 호출 및 동시 요청 방지
const inFlightMap = new Map<string, boolean>();

export function useHome(userId: string | null) {
  const cached = userId ? cache.get(userId) : undefined;
  const [condition, setCondition] = useState<DailyCondition | null>(cached?.condition ?? null);
  const [mission, setMission] = useState<DailyMission | null>(cached?.mission ?? null);
  const [quickStart, setQuickStart] = useState<any>(cached?.quickStart ?? null);
  const [banners, setBanners] = useState<any[]>(cached?.banners ?? []);
  const [loading, setLoading] = useState<boolean>(!cached);

  const loadHomeData = useCallback(async (showLoader: boolean) => {
    if (!userId) return;
    if (inFlightMap.get(userId)) return;
    inFlightMap.set(userId, true);
    try {
      if (showLoader) setLoading(true);

      // Task #146 — 같은 endpoint 의 동시 호출은 ApiClient 의
      // `coalesceInflight` 가드(`getCondition`/`getMission`/`getQuickStart`
      // 안쪽)로 1회 fetch 로 합쳐진다. 위 `inFlightMap` 가 같은 hook 안의
      // 중복 트리거를 막고, 이쪽은 hook 바깥 다른 트리거 경로(라우팅 전환,
      // 포커스 복귀, Strict Mode 이중 마운트 등)와의 경합까지 잠근다.
      const [conditionRes, missionRes, quickStartRes, bannersRes] = await Promise.allSettled([
        api.getCondition(userId).catch(() => ({ success: false, data: null })),
        api.getMission(userId).catch(() => ({ success: false, data: null })),
        api.getQuickStart(userId).catch(() => ({ success: false, data: null })),
        api.getBanners().catch(() => ({ success: false, data: [] })),
      ]);

      // 이전 캐시를 시작점으로 두고 성공한 필드만 덮어쓴다 (부분 실패 시 데이터 손실 방지)
      const prev = cache.get(userId);
      const next: HomeCache = {
        condition: prev?.condition ?? null,
        mission: prev?.mission ?? null,
        quickStart: prev?.quickStart ?? null,
        banners: prev?.banners ?? [],
        fetchedAt: Date.now(),
      };

      if (conditionRes.status === 'fulfilled' && conditionRes.value.success && conditionRes.value.data) {
        next.condition = conditionRes.value.data as DailyCondition;
        setCondition(next.condition);
      }
      if (missionRes.status === 'fulfilled' && missionRes.value.success && missionRes.value.data) {
        next.mission = missionRes.value.data as DailyMission;
        setMission(next.mission);
      }
      if (quickStartRes.status === 'fulfilled' && quickStartRes.value.success && quickStartRes.value.data) {
        next.quickStart = quickStartRes.value.data;
        setQuickStart(next.quickStart);
      }
      if (bannersRes.status === 'fulfilled' && bannersRes.value.success && bannersRes.value.data) {
        next.banners = bannersRes.value.data as any[];
        setBanners(next.banners);
      }

      cache.set(userId, next);
    } catch (error) {
      console.error('Failed to load home data:', error);
    } finally {
      inFlightMap.set(userId, false);
      setLoading(false);
    }
  }, [userId]);

  // userId 변경 시 새 키의 캐시로 즉시 상태 재수화
  const lastUserIdRef = useRef<string | null>(userId);
  if (lastUserIdRef.current !== userId) {
    lastUserIdRef.current = userId;
    const c = userId ? cache.get(userId) : undefined;
    setCondition(c?.condition ?? null);
    setMission(c?.mission ?? null);
    setQuickStart(c?.quickStart ?? null);
    setBanners(c?.banners ?? []);
    setLoading(!c && !!userId);
  }

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    const c = cache.get(userId);
    void loadHomeData(!c);
  }, [userId, loadHomeData]);

  return {
    condition,
    mission,
    quickStart,
    banners,
    loading,
    refetch: () => loadHomeData(false),
  };
}
