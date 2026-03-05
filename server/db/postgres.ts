/**
 * PostgreSQL 데이터베이스 어댑터 (Neon/Supabase)
 * Key-Value 스토어 인터페이스를 PostgreSQL 테이블로 변환
 */

import { Pool, PoolClient } from 'pg';
import type { IDatabase } from './interface.js';

export class PostgresDB implements IDatabase {
  private pool: Pool | null = null;
  private client: PoolClient | null = null;
  private connected = false;
  
  constructor(connectionString?: string) {
    const connString = connectionString || process.env.DATABASE_URL;
    
    if (!connString) {
      throw new Error('DATABASE_URL environment variable is required for PostgreSQL');
    }
    
    this.pool = new Pool({
      connectionString: connString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  
  async connect(): Promise<void> {
    if (this.connected) return;
    
    try {
      this.client = await this.pool!.connect();
      await this.initTables();
      this.connected = true;
      console.log('✅ Connected to PostgreSQL (Neon/Supabase)');
    } catch (error) {
      console.error('❌ Failed to connect to PostgreSQL:', error);
      throw error;
    }
  }
  
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.release();
      this.client = null;
    }
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.connected = false;
  }
  
  isConnected(): boolean {
    return this.connected;
  }
  
  /**
   * 테이블 초기화
   * Key-Value 스토어를 시뮬레이션하기 위한 단일 테이블 사용
   */
  private async initTables(): Promise<void> {
    if (!this.client) throw new Error('Not connected');
    
    // Key-Value 스토어 테이블
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // 인덱스 생성
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS idx_kv_key ON kv_store(key)
    `);
  }
  
  /**
   * Key-Value 스토어 메서드
   */
  async get(key: string): Promise<any> {
    await this.ensureConnected();
    
    const result = await this.client!.query(
      'SELECT value FROM kv_store WHERE key = $1',
      [key]
    );
    
    if (result.rows.length === 0) {
      return undefined;
    }
    
    // JSONB는 자동으로 파싱되지만, 안전을 위해 확인
    const value = result.rows[0].value;
    return typeof value === 'string' ? JSON.parse(value) : value;
  }
  
  async set(key: string, value: any): Promise<void> {
    await this.ensureConnected();
    
    // JSONB 타입이므로 JSON 문자열로 변환
    const jsonValue = JSON.stringify(value);
    
    await this.client!.query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
       ON CONFLICT (key) 
       DO UPDATE SET value = $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
      [key, jsonValue]
    );
  }
  
  async delete(key: string): Promise<void> {
    await this.ensureConnected();
    
    await this.client!.query(
      'DELETE FROM kv_store WHERE key = $1',
      [key]
    );
  }
  
  async list(prefix?: string): Promise<string[]> {
    await this.ensureConnected();
    
    let query = 'SELECT key FROM kv_store';
    const params: any[] = [];
    
    if (prefix) {
      query += ' WHERE key LIKE $1';
      params.push(`${prefix}%`);
    }
    
    const result = await this.client!.query(query, params);
    return result.rows.map(row => row.key);
  }
  
  /**
   * PostgreSQL 네이티브 쿼리
   */
  async query(sql: string, params?: any[]): Promise<any> {
    await this.ensureConnected();
    
    const result = await this.client!.query(sql, params || []);
    return result.rows;
  }
  
  /**
   * 트랜잭션
   */
  async transaction<T>(callback: (tx: IDatabase) => Promise<T>): Promise<T> {
    await this.ensureConnected();
    
    const txClient = await this.pool!.connect();
    
    try {
      await txClient.query('BEGIN');
      
      // 트랜잭션용 래퍼 생성
      const txDB: IDatabase = {
        get: async (key: string) => {
          const result = await txClient.query(
            'SELECT value FROM kv_store WHERE key = $1',
            [key]
          );
          return result.rows[0]?.value;
        },
        set: async (key: string, value: any) => {
          const jsonValue = JSON.stringify(value);
          await txClient.query(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (key) 
             DO UPDATE SET value = $2::jsonb, updated_at = CURRENT_TIMESTAMP`,
            [key, jsonValue]
          );
        },
        delete: async (key: string) => {
          await txClient.query('DELETE FROM kv_store WHERE key = $1', [key]);
        },
        list: async (prefix?: string) => {
          let query = 'SELECT key FROM kv_store';
          const params: any[] = [];
          if (prefix) {
            query += ' WHERE key LIKE $1';
            params.push(`${prefix}%`);
          }
          const result = await txClient.query(query, params);
          return result.rows.map(row => row.key);
        },
        query: async (sql: string, params?: any[]) => {
          const result = await txClient.query(sql, params || []);
          return result.rows;
        },
        transaction: async () => {
          throw new Error('Nested transactions not supported');
        },
        connect: async () => {},
        disconnect: async () => {},
        isConnected: () => true,
      };
      
      const result = await callback(txDB);
      await txClient.query('COMMIT');
      
      return result;
    } catch (error) {
      await txClient.query('ROLLBACK');
      throw error;
    } finally {
      txClient.release();
    }
  }
  
  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }
}
