import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from '@xiaosu/core';
import type { StatusRepo } from '@xiaosu/db';
import type { Logger } from './logger.ts';
import type { Services } from './services.ts';
import { registerDocumentRoutes } from './routes/documents.ts';
import { registerChatRoutes } from './routes/chat.ts';
import { registerLogRoutes } from './routes/logs.ts';
import { registerSettingsRoutes } from './routes/settings.ts';
import { registerMockRoutes } from './routes/mock.ts';
import { registerStatusRoutes } from './routes/status.ts';

export interface BuildAppDeps {
  services: Services;
  config: AppConfig;
  logger: Logger;
  statusRepo: StatusRepo;
  webDist: string;
}

export function buildApp(deps: BuildAppDeps): Fastify.FastifyInstance {
  const app = Fastify({
    // pino.Logger 在结构上兼容 FastifyBaseLogger，归一化泛型以复用 FastifyInstance 类型
    loggerInstance: deps.logger as unknown as FastifyBaseLogger,
    bodyLimit: 20 * 1024 * 1024,
  });

  app.register(cors, { origin: true });
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  registerDocumentRoutes(app, deps.services);
  registerChatRoutes(app, deps.services);
  registerLogRoutes(app, deps.services);
  registerSettingsRoutes(app, deps.services, deps.config);
  registerMockRoutes(app, deps.services);
  registerStatusRoutes(app, deps.services, deps.statusRepo, deps.config);

  // 生产模式：托管 Web 构建产物 + SPA 路由回退
  if (existsSync(deps.webDist)) {
    const indexHtml = join(deps.webDist, 'index.html');
    app.register(fastifyStatic, {
      root: deps.webDist,
      index: 'index.html',
      maxAge: 0,
      // index.html 不缓存：保证前端发版后刷新即生效（JS 资源本身带内容哈希）
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      try {
        reply.header('Cache-Control', 'no-store');
        return reply.type('text/html; charset=utf-8').send(readFileSync(indexHtml));
      } catch {
        return reply.code(404).send({ error: '前端未构建' });
      }
    });
  }

  app.setErrorHandler((err, req, reply) => {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.error({ err: msg, url: req.url }, '未捕获的请求错误');
    reply.code(500).send({ error: '服务器开小差了，请稍后再试' });
  });

  return app;
}
