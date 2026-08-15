import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from '@xiaosu/db';
import { createConversationsRepo, createDocumentsRepo, createSettingsRepo } from '@xiaosu/db';
import type { AppConfig, AgentResult, Citation, Embedder, LlmProvider, SearchChunk } from '@xiaosu/core';
import { chunkText, floatsToBytes, formatCitationsText, parseFile, runAgent } from '@xiaosu/core';
import { buildToolRegistry, loadMockData, type MockData } from '@xiaosu/core';
import type { BotMessage, BotReply } from '@xiaosu/bot';
import type { Logger } from './logger.ts';

export interface ServiceDeps {
  db: DatabaseSync;
  config: AppConfig;
  embedder: Embedder;
  llm: LlmProvider;
  logger: Logger;
}

export function createServices(deps: ServiceDeps) {
  const docsRepo = createDocumentsRepo(deps.db);
  const convRepo = createConversationsRepo(deps.db);
  const settingsRepo = createSettingsRepo(deps.db);
  const uploadsDir = join(deps.config.paths.dataDir, 'uploads');
  mkdirSync(uploadsDir, { recursive: true });

  const mockData: MockData = loadMockData(join(deps.config.paths.dataDir, 'mock'));
  const toolRegistry = buildToolRegistry(mockData);

  // ---------------------------------------------------------------- 文档服务
  const documents = {
    list: () => docsRepo.list(),

    getWithChunks: (id: string) => {
      const doc = docsRepo.get(id);
      if (!doc) return null;
      return { doc, chunks: docsRepo.listChunks(id) };
    },

    /** 上传（或增量替换）文档：解析 → 分块 → 嵌入 → 入库。 */
    async upload(name: string, buffer: Buffer, mime: string) {
      const sha256 = createHash('sha256').update(buffer).digest('hex');

      // 同名同内容：跳过（增量更新要求——不重复处理）
      const same = docsRepo.findByHash(name, sha256);
      if (same) {
        deps.logger.info({ docId: same.id, name }, '文档内容未变化，跳过索引');
        return { doc: same, skipped: true };
      }

      // 同名不同内容：替换旧文档
      const old = docsRepo.findByName(name);
      const doc = old
        ? (docsRepo.updateMeta(old.id, { mime, size: buffer.length, sha256 }), docsRepo.get(old.id)!)
        : docsRepo.insert({ name, mime, size: buffer.length, sha256 });

      await indexBuffer(doc.id, name, buffer);
      return { doc: docsRepo.get(doc.id)!, skipped: false };
    },

    async reindex(id: string) {
      const doc = docsRepo.get(id);
      if (!doc) throw new Error('文档不存在');
      const ext = doc.name.split('.').pop() ?? 'txt';
      const raw = readFileSync(join(uploadsDir, `${id}.${ext}`));
      await indexBuffer(id, doc.name, raw);
      return docsRepo.get(id)!;
    },

    remove(id: string) {
      docsRepo.remove(id);
    },
  };

  /** 解析并索引一个文档；失败标记 failed 并抛出。 */
  async function indexBuffer(docId: string, name: string, buffer: Buffer): Promise<void> {
    docsRepo.updateStatus(docId, 'pending', null);
    try {
      const ext = name.split('.').pop()?.toLowerCase() ?? 'txt';
      writeFileSync(join(uploadsDir, `${docId}.${ext}`), buffer);
      const text = await parseFile(name, buffer);
      const drafts = chunkText(name, text);
      const vectors = await deps.embedder.embed(drafts.map((d) => d.content));
      docsRepo.replaceChunks(
        docId,
        drafts.map((d, i) => ({
          seq: i + 1,
          heading: d.heading,
          content: d.content,
          embedding: floatsToBytes(vectors[i] ?? []),
        })),
      );
      docsRepo.updateStatus(docId, 'indexed', null);
      deps.logger.info({ docId, name, chunks: drafts.length }, '文档索引完成');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      docsRepo.updateStatus(docId, 'failed', msg);
      deps.logger.error({ docId, err: msg }, '文档索引失败');
      throw e;
    }
  }

  // ---------------------------------------------------------------- 对话服务
  const chat = {
    /** Web 聊天页入口（流式）。 */
    runWebChat(input: {
      conversationId: string;
      question: string;
      onDelta?: (t: string) => void;
      signal?: AbortSignal;
    }): Promise<AgentResult> {
      return core('web', 'web-user', input.conversationId, input.question, input.onDelta, input.signal);
    },

    /** 钉钉入口（支持 onDelta 流式回调，供 AI 卡片打字机使用）。 */
    async runIM(msg: BotMessage, onDelta?: (t: string) => void): Promise<BotReply> {
      const result = await core('dingtalk', msg.userId, msg.conversationId, msg.text, onDelta);
      const citationText: Array<{ docName: string; heading: string | null }> = result.citations.map(
        (c: Citation) => ({ docName: c.docName, heading: c.heading }),
      );
      return { text: result.content + formatCitationsText(citationText) };
    },
  };

  /** 公共执行路径：会话隔离 + 历史 + Agent + 日志落库。 */
  async function core(
    platform: string,
    userId: string,
    conversationId: string,
    question: string,
    onDelta?: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
    const conv = convRepo.upsert(platform, userId, conversationId);
    const userMsg = convRepo.addMessage({
      conversation_id: conv.id,
      role: 'user',
      content: question,
      status: 'ok',
    });

    const history = convRepo
      .history(conv.id, 12)
      .filter((m) => m.id !== userMsg.id)
      .map((m) => ({ role: m.role, content: m.content }));

    const model = settingsRepo.get('llm_model') ?? deps.config.llm.model;
    try {
      const started = Date.now();
      const result = await runAgent(
        question,
        {
          llm: deps.llm,
          llmModel: model,
          embedder: deps.embedder,
          toolDefs: toolRegistry.defs,
          executeTool: toolRegistry.execute,
          listChunks: (): SearchChunk[] =>
            docsRepo.listAllChunks().map((c) => ({
              chunkId: c.id,
              docId: c.doc_id,
              docName: c.doc_name,
              seq: c.seq,
              heading: c.heading,
              content: c.content,
              embedding: c.embedding,
            })),
          history,
        },
        { onDelta, signal },
      );
      convRepo.addMessage({
        conversation_id: conv.id,
        role: 'assistant',
        content: result.content,
        tool_calls: result.toolCalls,
        citations: result.citations,
        tokens_in: result.usage.inputTokens,
        tokens_out: result.usage.outputTokens,
        cost: Math.round(result.costUsd * 1e6) / 1e6,
        latency_ms: Date.now() - started,
        status: 'ok',
      });
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly =
        e instanceof Error && e.name === 'AbortError'
          ? '小苏思考超时了，请稍后再试 😅'
          : '小苏开小差了，请稍后再试 😅';
      convRepo.addMessage({
        conversation_id: conv.id,
        role: 'assistant',
        content: friendly,
        status: 'error',
        error: msg,
      });
      deps.logger.error({ err: msg, conversationId }, 'Agent 运行失败');
      throw new Error(friendly);
    }
  }

  return {
    documents,
    chat,
    mockData,
    toolRegistry,
    docsRepo,
    convRepo,
    settingsRepo,
  };
}

export type Services = ReturnType<typeof createServices>;
