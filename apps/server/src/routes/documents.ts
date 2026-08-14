import type { FastifyInstance } from 'fastify';
import type { Services } from '../services.ts';

/** 浏览器 multipart 上传中文文件名常按 latin1 解码，这里修复为 UTF-8。 */
export function fixFilename(name: string): string {
  if (/[\u00c0-\u00ff]/.test(name) && !/[\u4e00-\u9fa5]/.test(name)) {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (/[\u4e00-\u9fa5]/.test(fixed)) return fixed;
  }
  return name;
}

export function registerDocumentRoutes(app: FastifyInstance, services: Services): void {
  app.get('/api/documents', async () => ({ documents: services.documents.list() }));

  app.post('/api/documents', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: '请上传文件' });
    const name = fixFilename(file.filename);
    const buffer = await file.toBuffer();
    try {
      const { doc, skipped } = await services.documents.upload(name, buffer, file.mimetype);
      return reply.code(201).send({ doc, skipped });
    } catch (e) {
      return reply.code(422).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/documents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = services.documents.getWithChunks(id);
    if (!data) return reply.code(404).send({ error: '文档不存在' });
    return data;
  });

  app.delete('/api/documents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!services.docsRepo.get(id)) return reply.code(404).send({ error: '文档不存在' });
    services.documents.remove(id);
    return { ok: true };
  });

  app.post('/api/documents/:id/reindex', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { doc: await services.documents.reindex(id) };
    } catch (e) {
      return reply.code(422).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
