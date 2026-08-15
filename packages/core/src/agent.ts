import type { AgentResult, ChatMessage, ChatResult, RetrievedChunk, ToolCallRecord, Usage } from './types.ts';
import type { LlmProvider } from './llm.ts';
import { estimateCostUsd, estimateTokens } from './llm.ts';
import type { Embedder } from './embed.ts';
import type { SearchChunk } from './rag.ts';
import { buildContext, extractCitationRefs, resolveCitations, retrieve, validateQuotes } from './rag.ts';
import { buildSystemPrompt, historyToMessages } from './prompts.ts';
import type { ToolDefinition } from './types.ts';

export interface AgentDeps {
  llm: LlmProvider;
  llmModel: string;
  embedder: Embedder;
  toolDefs: ToolDefinition[];
  /** 执行工具：返回结构化结果或错误信息。 */
  executeTool: (name: string, args: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  /** 全部已索引分块（每次问答实时读取，保证删除/新增即时生效）。 */
  listChunks: () => SearchChunk[];
  /** 会话历史（user/assistant，按时间正序）。 */
  history: Array<{ role: string; content: string }>;
}

export interface RunOptions {
  /** 提供则走流式输出（Web 端体验）。 */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

const MAX_TOOL_ROUNDS = 4;

/**
 * Agent 主循环：
 * 检索知识库 → LLM 自主决定（直接回答 / 调工具）→ 执行工具 → 生成带引用的最终答案。
 */
export async function runAgent(question: string, deps: AgentDeps, opts: RunOptions = {}): Promise<AgentResult> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const addUsage = (u: Usage): void => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
  };

  // 1. 检索知识库
  const allChunks = deps.listChunks();
  const retrieved: RetrievedChunk[] = await retrieve(question, allChunks, deps.embedder);
  const context = buildContext(retrieved);

  // 2. 组装消息
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt({ context }) },
    ...historyToMessages(deps.history),
    { role: 'user', content: question },
  ];

  // 3. 工具循环：模型自主决定调用哪些工具。
  //    Web 端（提供 onDelta）从第一轮就流式输出；IM 端（无 onDelta）走非流式单次调用，更快。
  const toolRecords: ToolCallRecord[] = [];
  const useStream = Boolean(opts.onDelta);
  let res: ChatResult;
  let rounds = 0;

  const callLlm = (): Promise<ChatResult> => {
    const req = { messages, tools: deps.toolDefs, model: deps.llmModel, temperature: 0.1 };
    return useStream ? deps.llm.chatStream(req, opts.onDelta!, opts.signal) : deps.llm.chat(req, opts.signal);
  };

  res = await callLlm();
  addUsage(res.usage);

  // 只要模型发起工具调用就执行：带旁白+工具调用的响应（如"我先确认一下当前时间"）
  // 中的旁白不是最终答案，不能跳过工具执行。
  while (res.toolCalls.length > 0 && rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    messages.push({ role: 'assistant', content: '', toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      let args: unknown = null;
      try {
        args = JSON.parse(call.args);
      } catch {
        args = {};
      }
      const exec = await deps.executeTool(call.name, args);
      toolRecords.push({
        name: call.name,
        args,
        result: exec.ok ? exec.data : undefined,
        error: exec.ok ? undefined : exec.error,
      });
      messages.push({
        role: 'tool',
        content: exec.ok ? JSON.stringify(exec.data) : `工具调用失败: ${exec.error ?? '未知错误'}`,
        toolCallId: call.id,
      });
    }
    res = await callLlm();
    addUsage(res.usage);
  }

  // 流式接口未返回 usage 时按文本长度估算（token 与成本统计）
  if (useStream && res.usage.outputTokens === 0) {
    addUsage({
      inputTokens: estimateTokens(messages.map((m) => m.content).join('')),
      outputTokens: estimateTokens(res.content),
    });
  }

  const resolved = resolveCitations(res.content, retrieved);
  // 原文摘录校验：逐字比对检索结果，编造的摘录整行剔除
  const quoteChecked = validateQuotes(resolved.content, retrieved);

  // 把逐字摘录挂到对应引用上（按摘录里的 [C#] 编号映射），供原文精确标记
  const validRefs = extractCitationRefs(resolved.content).filter((n) => n <= retrieved.length);
  const refToQuotes = new Map<number, string[]>();
  for (const q of quoteChecked.quotes) {
    const clean = q.replace(/\[C\d+\]/g, '').trim();
    if (!clean) continue;
    const refs = extractCitationRefs(q).filter((n) => n <= retrieved.length);
    for (const r of refs.length ? refs : [0]) {
      if (r === 0) continue;
      const arr = refToQuotes.get(r) ?? [];
      if (!arr.includes(clean)) arr.push(clean);
      refToQuotes.set(r, arr);
    }
  }
  const citations = resolved.citations.map((c, i) => {
    const ref = validRefs[i];
    const quotes = ref ? refToQuotes.get(ref) : undefined;
    return quotes?.length ? { ...c, quotes } : c;
  });

  return {
    content: quoteChecked.content,
    citations,
    toolCalls: toolRecords,
    usage,
    retrievalCount: retrieved.length,
    costUsd: estimateCostUsd(deps.llmModel, usage),
  };
}
