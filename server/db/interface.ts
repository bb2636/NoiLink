/**
 * 데이터베이스 추상화 인터페이스
 * 여러 데이터베이스 백엔드를 지원하기 위한 공통 인터페이스
 */

export interface IDatabase {
  // Key-Value 스토어 메서드 (Replit DB 호환)
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  
  // PostgreSQL 메서드 (Neon/Supabase용)
  query(sql: string, params?: any[]): Promise<any>;
  transaction<T>(callback: (tx: IDatabase) => Promise<T>): Promise<T>;
  
  // 연결 관리
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
