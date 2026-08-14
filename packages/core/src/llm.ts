import type { ChatMessage, ChatRequest, ChatResult, ToolCall, ToolDefinition, Usage } from './types.ts';

export interface LlmProvider {
  /** 单次非流式调用（工具调用阶段用）。 */
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult>;
  /** 流式调用（最终回答用），边生成边回调 onDelta。 */
  chatStream(req: ChatRequest, onDelta: (t: string) => void, signal?: AbortSignal): Promise<ChatResult>;
}

// ---------------------------------------------------------------------------
// DeepSeek / OpenAI 兼容实现
// ---------------------------------------------------------------------------

interface OpenAiMessage {
  role: string;
  content: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface DeepSeekOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 额外请求体字段（如 DeepSeek 关闭思考模式: {thinking:{type:'disabled'}}）。 */
  extraBody?: Record<string, unknown>;
}

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private opts: DeepSeekOptions) {}

  private toOpenAiMessages(messages: ChatMessage[]): OpenAiMessage[] {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolCalls?.length
        ? {
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: c.args },
            })),
          }
        : {}),
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    }));
  }

  private body(req: ChatRequest, stream: boolean): Record<string, unknown> {
    return {
      model: req.model ?? this.opts.model,
      messages: this.toOpenAiMessages(req.messages),
      temperature: req.temperature ?? 0.1,
      stream,
      ...(this.opts.extraBody ?? {}),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: 'auto',
          }
        : {}),
    };
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(this.body(req, false)),
      signal,
    });
    if (!res.ok) {
      throw new Error(`LLM API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
        };
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const msg = json.choices[0]?.message;
    if (!msg) throw new Error('LLM API 返回为空');
    return {
      content: msg.content ?? '',
      toolCalls: (msg.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        args: c.function.arguments,
      })),
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }

  async chatStream(
    req: ChatRequest,
    onDelta: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(this.body(req, true)),
      signal,
    });
    if (!res.ok) {
      throw new Error(`LLM API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    if (!res.body) throw new Error('LLM API 无响应体');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    // 流式分片中的工具调用（OpenAI 格式按 index 聚合 id/name/arguments）
    const toolCalls: ToolCall[] = [];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            onDelta(delta.content);
          }
          for (const tc of delta?.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            let call = toolCalls[idx];
            if (!call) {
              call = { id: '', name: '', args: '' };
              toolCalls[idx] = call;
            }
            if (tc.id) call.id = tc.id;
            if (tc.function?.name) call.name += tc.function.name;
            if (tc.function?.arguments) call.args += tc.function.arguments;
          }
          if (chunk.usage) {
            usage = {
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
            };
          }
        } catch {
          // 忽略无法解析的行（如心跳）
        }
      }
    }
    return {
      content,
      toolCalls: toolCalls.filter((c) => c && c.name),
      usage,
    };
  }
}

// ---------------------------------------------------------------------------
// 容错包装：超时 + 429/5xx 指数退避重试 + 失败降级
// ---------------------------------------------------------------------------

export interface ResilientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createResilientLlm(inner: LlmProvider, opts: ResilientOptions = {}): LlmProvider {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRetries = opts.maxRetries ?? 2;

  async function withRetry<T>(
    fn: (timeoutSignal: AbortSignal) => Promise<T>,
    clientSignal?: AbortSignal,
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (clientSignal?.aborted) throw new Error('客户端已中断');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('LLM 请求超时')), timeoutMs);
      try {
        const signal = clientSignal ? AbortSignal.any([clientSignal, controller.signal]) : controller.signal;
        return await fn(signal);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (clientSignal?.aborted) throw lastError; // 客户端主动中断不重试
        const retriable =
          lastError.message.includes('429') ||
          /5\d\d/.test(lastError.message) ||
          lastError.name === 'AbortError' ||
          /fetch failed|ECONNRESET|ETIMEDOUT/i.test(lastError.message);
        if (!retriable || attempt === maxRetries) throw lastError;
        opts.onRetry?.(attempt + 1, lastError);
        await sleep(1000 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error('LLM 调用失败');
  }

  return {
    chat: (req, signal) => withRetry((t) => inner.chat(req, t), signal),
    chatStream: (req, onDelta, signal) => withRetry((t) => inner.chatStream(req, onDelta, t), signal),
  };
}

// ---------------------------------------------------------------------------
// Mock LLM（自动化测试用，完全不依赖真实 API）
// ---------------------------------------------------------------------------

export interface FakeRule {
  /** 用户最后一条消息匹配该正则则命中。 */
  match: RegExp;
  /** 命中时返回的工具调用（工具阶段）。 */
  toolCalls?: ToolCall[];
  /** 命中时返回的内容（回答阶段；与 toolCalls 二选一）。 */
  content?: string;
}

export class FakeProvider implements LlmProvider {
  constructor(private rules: FakeRule[], private defaultContent = '文档里没找到相关内容。') {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const last = [...req.messages].reverse().find((m) => m.role === 'user');
    const userText = last?.content ?? '';
    const answerPhase = req.messages[req.messages.length - 1]?.role === 'tool';

    let rule: FakeRule | undefined;
    if (answerPhase) {
      // 工具结果已注入：返回同问题的"回答阶段"规则
      rule = this.rules.find((r) => r.match.test(userText) && !r.toolCalls?.length);
    } else {
      // 工具决策阶段：优先返回带 toolCalls 的规则
      rule = this.rules.find((r) => r.match.test(userText) && r.toolCalls?.length);
      if (!rule) rule = this.rules.find((r) => r.match.test(userText));
    }

    if (rule?.toolCalls?.length) {
      return { content: '', toolCalls: rule.toolCalls, usage: { inputTokens: 10, outputTokens: 0 } };
    }
    return {
      content: rule?.content ?? this.defaultContent,
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  }

  async chatStream(
    req: ChatRequest,
    onDelta: (t: string) => void,
  ): Promise<ChatResult> {
    const result = await this.chat(req);
    onDelta(result.content);
    return result;
  }
}

// ---------------------------------------------------------------------------
// 成本估算（USD / 1M tokens，DeepSeek 官方定价，可按模型扩展）
// ---------------------------------------------------------------------------

const PRICES: Record<string, { input: number; output: number }> = {
  'deepseek-v4-flash': { input: 0.14, output: 0.28 },
  'deepseek-v4-pro': { input: 0.435, output: 0.87 },
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

export function estimateCostUsd(model: string, usage: Usage): number {
  const p = PRICES[model] ?? { input: 0.3, output: 1 };
  return (usage.inputTokens / 1_000_000) * p.input + (usage.outputTokens / 1_000_000) * p.output;
}

/** 粗略 token 估算（流式接口无 usage 时兜底）：中文 ≈ 1.3 字/token。 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 1.3));
}
