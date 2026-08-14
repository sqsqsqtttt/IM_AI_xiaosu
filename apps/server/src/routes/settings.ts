import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '@xiaosu/core';
import type { Services } from '../services.ts';

const PutSchema = z.object({ llm_model: z.string().min(1).max(100) });

export function registerSettingsRoutes(
  app: FastifyInstance,
  services: Services,
  config: AppConfig,
): void {
  app.get('/api/settings', async () => {
    const models = [...new Set([config.llm.model, 'deepseek-v4-flash', 'deepseek-v4-pro'])];
    return {
      settings: services.settingsRepo.all(),
      currentModel: services.settingsRepo.get('llm_model') ?? config.llm.model,
      availableModels: models,
      llmBaseUrl: config.llm.baseUrl,
      embedProvider: config.embed.provider,
      embedModel: config.embed.model,
      dingtalkEnabled: config.dingtalk.enabled,
      publicBaseUrl: config.server.publicBaseUrl,
    };
  });

  app.put('/api/settings', async (req, reply) => {
    const parsed = PutSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: '参数错误' });
    services.settingsRepo.set('llm_model', parsed.data.llm_model);
    return { ok: true };
  });
}
