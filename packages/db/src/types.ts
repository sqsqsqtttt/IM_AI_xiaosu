/** 文档索引状态。 */
export type DocStatus = 'pending' | 'indexed' | 'failed';

export interface DocumentRow {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  status: DocStatus;
  error: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChunkRow {
  id: string;
  doc_id: string;
  seq: number;
  heading: string | null;
  content: string;
  embedding: Uint8Array | null;
}

export interface ConversationRow {
  id: string;
  platform: string;
  user_id: string;
  conversation_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: string | null;
  citations: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  latency_ms: number | null;
  status: string | null;
  error: string | null;
  created_at: string;
}
