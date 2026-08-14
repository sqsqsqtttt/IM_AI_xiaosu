import type { FastifyInstance } from 'fastify';
import type { Services } from '../services.ts';

export function registerLogRoutes(app: FastifyInstance, services: Services): void {
  app.get('/api/logs', async (req) => {
    const { limit } = req.query as { limit?: string };
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return { conversations: services.convRepo.listConversations(n) };
  });

  app.get('/api/logs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conv = services.convRepo.get(id);
    if (!conv) return reply.code(404).send({ error: '会话不存在' });
    const messages = services.convRepo.listMessages(id).map((m) => ({
      ...m,
      tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : null,
      citations: m.citations ? JSON.parse(m.citations) : null,
    }));
    return { conversation: conv, messages };
  });

  app.get('/api/stats', async () => {
    const s = services.convRepo.stats();
    const docs = services.documents.list();
    return {
      ...s,
      documents: docs.length,
      indexed: docs.filter((d) => d.status === 'indexed').length,
    };
  });
}
