import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { ConversationRow, MessageRow } from '../types.ts';

function now(): string {
  return new Date().toISOString();
}

export interface NewMessage {
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: unknown;
  citations?: unknown;
  tokens_in?: number;
  tokens_out?: number;
  cost?: number;
  latency_ms?: number;
  status?: string;
  error?: string;
}

export function createConversationsRepo(db: DatabaseSync) {
  return {
    /**
     * 按 (platform, userId, conversationId) 找会话，不存在则创建。
     * 这是 IM 上下文隔离的关键：不同用户、不同群的会话互不可见。
     */
    upsert(platform: string, userId: string, conversationId: string): ConversationRow {
      const existing = db
        .prepare(
          'SELECT * FROM conversations WHERE platform = ? AND user_id = ? AND conversation_id = ?',
        )
        .get(platform, userId, conversationId);
      if (existing) {
        const conv = existing as unknown as ConversationRow;
        db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), conv.id);
        return conv;
      }
      const id = randomUUID();
      const t = now();
      db.prepare(
        'INSERT INTO conversations (id, platform, user_id, conversation_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, platform, userId, conversationId, null, t, t);
      return this.get(id)!;
    },

    get(id: string): ConversationRow | null {
      const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
      return (row as unknown as ConversationRow | undefined) ?? null;
    },

    touch(id: string): void {
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), id);
    },

    addMessage(m: NewMessage): MessageRow {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO messages (id, conversation_id, role, content, tool_calls, citations, tokens_in, tokens_out, cost, latency_ms, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        m.conversation_id,
        m.role,
        m.content,
        m.tool_calls ? JSON.stringify(m.tool_calls) : null,
        m.citations ? JSON.stringify(m.citations) : null,
        m.tokens_in ?? null,
        m.tokens_out ?? null,
        m.cost ?? null,
        m.latency_ms ?? null,
        m.status ?? null,
        m.error ?? null,
        now(),
      );
      return this.getMessage(id)!;
    },

    getMessage(id: string): MessageRow | null {
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
      return (row as unknown as MessageRow | undefined) ?? null;
    },

    /** 会话最近 N 条 user/assistant 消息（多轮上下文，按时间正序；rowid 兜底同毫秒排序）。 */
    history(conversationId: string, limit = 12): MessageRow[] {
      const rows = db
        .prepare(
          `SELECT * FROM (
             SELECT rowid AS rid, * FROM messages
             WHERE conversation_id = ? AND role IN ('user','assistant') AND status = 'ok'
             ORDER BY created_at DESC, rowid DESC LIMIT ?
           ) ORDER BY created_at ASC, rid ASC`,
        )
        .all(conversationId, limit);
      return rows as unknown as MessageRow[];
    },

    listConversations(limit = 50): Array<ConversationRow & { message_count: number; last_message: string | null }> {
      const rows = db
        .prepare(
          `SELECT c.*,
                  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                  (SELECT content FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message
           FROM conversations c ORDER BY c.updated_at DESC LIMIT ?`,
        )
        .all(limit);
      return rows as unknown as Array<ConversationRow & { message_count: number; last_message: string | null }>;
    },

    listMessages(conversationId: string): MessageRow[] {
      const rows = db
        .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
        .all(conversationId);
      return rows as unknown as MessageRow[];
    },

    stats(): { conversations: number; messages: number; tokens_in: number; tokens_out: number; cost: number } {
      const row = db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM conversations) AS conversations,
                  (SELECT COUNT(*) FROM messages) AS messages,
                  (SELECT COALESCE(SUM(tokens_in),0) FROM messages) AS tokens_in,
                  (SELECT COALESCE(SUM(tokens_out),0) FROM messages) AS tokens_out,
                  (SELECT COALESCE(SUM(cost),0) FROM messages) AS cost`,
        )
        .get();
      return row as unknown as ReturnType<typeof this.stats>;
    },
  };
}

export type ConversationsRepo = ReturnType<typeof createConversationsRepo>;
