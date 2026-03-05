import { useState, useEffect } from 'react';
import api from '../utils/api';
import type { DailyCondition, DailyMission } from '@noilink/shared';

export function useHome(userId: string | null) {
  const [condition, setCondition] = useState<DailyCondition | null>(null);
  const [mission, setMission] = useState<DailyMission | null>(null);
  const [quickStart, setQuickStart] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    if (userId) {
      loadHomeData();
    } else {
      setLoading(false);
    }
  }, [userId]);
  
  const loadHomeData = async () => {
    if (!userId) return;
    
    try {
      setLoading(true);
      
      // 병렬로 데이터 로드
      const [conditionRes, missionRes, quickStartRes] = await Promise.all([
        api.get(`/home/condition/${userId}`),
        api.get(`/home/mission/${userId}`),
        api.get(`/home/quickstart/${userId}`),
      ]);
      
      if (conditionRes.success && conditionRes.data) {
        setCondition(conditionRes.data as DailyCondition);
      }
      if (missionRes.success && missionRes.data) {
        setMission(missionRes.data as DailyMission);
      }
      if (quickStartRes.success) setQuickStart(quickStartRes.data);
    } catch (error) {
      console.error('Failed to load home data:', error);
    } finally {
      setLoading(false);
    }
  };
  
  return {
    condition,
    mission,
    quickStart,
    loading,
    refetch: loadHomeData,
  };
}
