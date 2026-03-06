import { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import type { DailyCondition, DailyMission } from '@noilink/shared';

export function useHome(userId: string | null) {
  const [condition, setCondition] = useState<DailyCondition | null>(null);
  const [mission, setMission] = useState<DailyMission | null>(null);
  const [quickStart, setQuickStart] = useState<any>(null);
  const [banners, setBanners] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const loadHomeData = useCallback(async () => {
    if (!userId) return;
    
    try {
      setLoading(true);
      
      // 병렬로 데이터 로드 (404 에러는 무시)
      const [conditionRes, missionRes, quickStartRes, bannersRes] = await Promise.allSettled([
        api.get(`/home/condition/${userId}`).catch(() => ({ success: false, data: null })),
        api.get(`/home/mission/${userId}`).catch(() => ({ success: false, data: null })),
        api.get(`/home/quickstart/${userId}`).catch(() => ({ success: false, data: null })),
        api.getBanners().catch(() => ({ success: false, data: [] })),
      ]);
      
      if (conditionRes.status === 'fulfilled' && conditionRes.value.success && conditionRes.value.data) {
        setCondition(conditionRes.value.data as DailyCondition);
      }
      if (missionRes.status === 'fulfilled' && missionRes.value.success && missionRes.value.data) {
        setMission(missionRes.value.data as DailyMission);
      }
      if (quickStartRes.status === 'fulfilled' && quickStartRes.value.success && quickStartRes.value.data) {
        setQuickStart(quickStartRes.value.data);
      }
      if (bannersRes.status === 'fulfilled' && bannersRes.value.success && bannersRes.value.data) {
        setBanners(bannersRes.value.data);
      }
    } catch (error) {
      // 에러는 조용히 처리 (404는 정상적인 경우일 수 있음)
      console.error('Failed to load home data:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);
  
  useEffect(() => {
    if (userId) {
      loadHomeData();
    } else {
      setLoading(false);
    }
  }, [userId, loadHomeData]);
  
  return {
    condition,
    mission,
    quickStart,
    banners,
    loading,
    refetch: loadHomeData,
  };
}
