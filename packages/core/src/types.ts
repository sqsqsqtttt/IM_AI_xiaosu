/** LLM 对话消息（OpenAI 兼容格式）。 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

/** 模型返回的工具调用。 */
export interface ToolCall {
  id: string;
  name: string;
  /** JSON 字符串参数（由工具执行器用 zod 校验）。 */
  args: string;
}

/** 工具定义（OpenAI function calling 格式）。 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  /** 运行时模型覆盖（管理后台切换模型）。 */
  model?: string;
}

/** 检索到的知识库分块。 */
export interface RetrievedChunk {
  chunkId: string;
  docId: string;
  docName: string;
  seq: number;
  heading: string | null;
  content: string;
  /** 混合检索综合得分（0–1）。 */
  score: number;
}

/** 答案引用（可点击定位到原文分块，并精确标记摘录原话）。 */
export interface Citation {
  docId: string;
  docName: string;
  chunkId: string;
  seq: number;
  heading: string | null;
  snippet: string;
  /** 该引用对应的逐字摘录原话（用于原文精确标记，去除了 [C#]）。 */
  quotes?: string[];
}

/** 一次工具调用的完整记录（写入对话日志）。 */
export interface ToolCallRecord {
  name: string;
  args: unknown;
  result?: unknown;
  error?: string;
}

export interface AgentResult {
  content: string;
  citations: Citation[];
  toolCalls: ToolCallRecord[];
  usage: Usage;
  /** 检索命中的分块数（0 表示知识库无相关内容）。 */
  retrievalCount: number;
  costUsd: number;
}
