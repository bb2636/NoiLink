/**
 * 관리자 메인 페이지 (리다이렉트)
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AdminIndex() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/admin/users', { replace: true });
  }, [navigate]);

  return null;
}
