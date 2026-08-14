export interface DocumentRow {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  status: 'pending' | 'indexed' | 'failed';
  error: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChunkView {
  id: string;
  doc_id: string;
  seq: number;
  heading: string | null;
  content: string;
}

export interface Citation {
  docId: string;
  docName: string;
  chunkId: string;
  seq: number;
  heading: string | null;
  snippet: string;
}

export interface ToolCallRecord {
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

export interface MessageView {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls: ToolCallRecord[] | null;
  citations: Citation[] | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost: number | null;
  latency_ms: number | null;
  status: string | null;
  error: string | null;
  created_at: string;
}

export interface ConversationView {
  id: string;
  platform: string;
  user_id: string;
  conversation_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message: string | null;
}

export interface StatsView {
  conversations: number;
  messages: number;
  tokens_in: number;
  tokens_out: number;
  cost: number;
  documents: number;
  indexed: number;
}

export interface StatusView {
  bot: { status: 'connected' | 'disconnected' | 'disabled'; last_seen: string } | null;
  llmModel: string;
  embedProvider: string;
  uptimeSec: number;
}

export interface SettingsView {
  settings: Record<string, string>;
  currentModel: string;
  availableModels: string[];
  llmBaseUrl: string;
  embedProvider: string;
  embedModel: string;
  dingtalkEnabled: boolean;
  publicBaseUrl: string;
}
