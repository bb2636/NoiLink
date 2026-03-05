/**
 * Replit Database 어댑터
 */

import { Database } from '@replit/database';
import type { IDatabase } from './interface.js';

export class ReplitDB implements IDatabase {
  private db: Database;
  private connected = false;
  
  constructor() {
    this.db = new Database();
  }
  
  async connect(): Promise<void> {
    // Replit DB는 자동으로 연결됨
    this.connected = true;
    console.log('✅ Connected to Replit Database');
  }
  
  async disconnect(): Promise<void> {
    // Replit DB는 명시적 disconnect 불필요
    this.connected = false;
  }
  
  isConnected(): boolean {
    return this.connected;
  }
  
  async get(key: string): Promise<any> {
    return await this.db.get(key);
  }
  
  async set(key: string, value: any): Promise<void> {
    await this.db.set(key, value);
  }
  
  async delete(key: string): Promise<void> {
    await this.db.delete(key);
  }
  
  async list(prefix?: string): Promise<string[]> {
    const keys = await this.db.list(prefix);
    return keys as string[];
  }
  
  async query(sql: string, params?: any[]): Promise<any> {
    throw new Error('Replit Database does not support SQL queries');
  }
  
  async transaction<T>(callback: (tx: IDatabase) => Promise<T>): Promise<T> {
    // Replit DB는 트랜잭션을 지원하지 않으므로 단순 실행
    return await callback(this);
  }
}
