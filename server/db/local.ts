/**
 * 로컬 JSON 파일 기반 데이터베이스 어댑터
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IDatabase } from './interface.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, '..', '..', 'data', 'db.json');

export class LocalDB implements IDatabase {
  private data: Record<string, any> = {};
  private initialized = false;
  private connected = false;
  
  async connect(): Promise<void> {
    await this.init();
    this.connected = true;
    console.log('✅ Connected to Local JSON Database');
  }
  
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  
  isConnected(): boolean {
    return this.connected;
  }
  
  private async init(): Promise<void> {
    if (this.initialized) return;
    
    try {
      const content = await fs.readFile(DB_FILE, 'utf-8');
      this.data = JSON.parse(content);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.data = {};
        await this.save();
      } else {
        throw error;
      }
    }
    
    this.initialized = true;
  }
  
  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
      await fs.writeFile(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      console.error('❌ Failed to save local DB:', error);
      throw error;
    }
  }
  
  async get(key: string): Promise<any> {
    await this.init();
    return this.data[key];
  }
  
  async set(key: string, value: any): Promise<void> {
    await this.init();
    this.data[key] = value;
    await this.save();
  }
  
  async delete(key: string): Promise<void> {
    await this.init();
    delete this.data[key];
    await this.save();
  }
  
  async list(prefix?: string): Promise<string[]> {
    await this.init();
    const keys = Object.keys(this.data);
    if (prefix) {
      return keys.filter(key => key.startsWith(prefix));
    }
    return keys;
  }
  
  async query(sql: string, params?: any[]): Promise<any> {
    throw new Error('Local JSON DB does not support SQL queries');
  }
  
  async transaction<T>(callback: (tx: IDatabase) => Promise<T>): Promise<T> {
    // 로컬 DB는 단순 실행
    return await callback(this);
  }
}
