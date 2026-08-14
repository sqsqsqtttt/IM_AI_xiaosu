import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../services.ts';

const BodySchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().max(100).optional(),
});

/** 聊天 SSE：流式输出 + 工具/引用/用量事件。 */
export function registerChatRoutes(app: FastifyInstance, services: Services): void {
  // 恢复 Web 端历史对话（页面刷新/切换菜单后聊天记录不丢）
  app.get('/api/chat/history', async (req, reply) => {
    const { conversationId } = req.query as { conversationId?: string };
    if (!conversationId) return reply.code(400).send({ error: '缺少 conversationId' });
    const conv = services.convRepo.findByKey('web', 'web-user', conversationId);
    if (!conv) return { messages: [] };
    const messages = services.convRepo.listMessages(conv.id).map((m) => ({
      ...m,
      tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
      citations: m.citations ? JSON.parse(m.citations) : null,
    }));
    return { messages };
  });

  app.post('/api/chat', async (req, reply) => {
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    const { message, conversationId } = parsed.data;

    const controller = new AbortController();
    // 客户端中断时才取消（IncomingMessage 的 close 在请求体读完即触发，不可用于此）
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (obj: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    const cid = conversationId ?? randomUUID();
    try {
      const result = await services.chat.runWebChat({
        conversationId: cid,
        question: message,
        onDelta: (t) => send({ type: 'delta', content: t }),
        signal: controller.signal,
      });
      send({
        type: 'done',
        conversationId: cid,
        content: result.content,
        citations: result.citations,
        toolCalls: result.toolCalls,
        usage: result.usage,
        costUsd: result.costUsd,
        retrievalCount: result.retrievalCount,
      });
    } catch (e) {
      send({ type: 'error', message: e instanceof Error ? e.message : '服务器错误' });
    } finally {
      reply.raw.end();
    }
  });
}
