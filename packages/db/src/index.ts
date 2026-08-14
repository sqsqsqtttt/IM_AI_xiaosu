import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA } from './schema.ts';

/**
 * 打开（必要时创建）SQLite 数据库并完成建表迁移。
 * path 传 ':memory:' 可用于测试。
 */
export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export type { DatabaseSync } from 'node:sqlite';
export * from './repos/documents.ts';
export * from './repos/conversations.ts';
export * from './repos/settings.ts';
export * from './repos/status.ts';
export type * from './types.ts';
