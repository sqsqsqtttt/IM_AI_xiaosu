import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '@xiaosu/core';
import type { StatusRepo } from '@xiaosu/db';
import type { Services } from '../services.ts';

export function registerStatusRoutes(
  app: FastifyInstance,
  services: Services,
  statusRepo: StatusRepo,
  config: AppConfig,
): void {
  app.get('/api/status', async () => ({
    bot:
      statusRepo.getBotStatus() ?? {
        status: config.dingtalk.enabled ? 'disconnected' : 'disabled',
        last_seen: '',
      },
    llmModel: services.settingsRepo.get('llm_model') ?? config.llm.model,
    embedProvider: config.embed.provider,
    uptimeSec: Math.round(process.uptime()),
  }));
}
