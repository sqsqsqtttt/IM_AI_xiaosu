import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  createEmbedder,
  createResilientLlm,
  loadConfig,
  OpenAiCompatibleProvider,
} from '@xiaosu/core';
import { createStatusRepo, openDb } from '@xiaosu/db';
import { createLogger, type Logger } from './logger.ts';
import { createServices } from './services.ts';
import { buildApp } from './app.ts';
import { startBotIfEnabled } from './botBridge.ts';

// 仓库根目录（apps/server/src → 上溯三级），所有相对路径以根目录为基准
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });

const config = loadConfig();
config.paths.dbPath = resolve(ROOT, config.paths.dbPath);
config.paths.logDir = resolve(ROOT, config.paths.logDir);
config.paths.dataDir = resolve(ROOT, config.paths.dataDir);

async function main(): Promise<void> {
  const logger = await createLogger(config.paths.logDir);
  await boot(logger);
}

async function boot(logger: Logger): Promise<void> {
  const db = openDb(config.paths.dbPath);
  const statusRepo = createStatusRepo(db);
  statusRepo.setBotStatus(config.dingtalk.enabled ? 'disconnected' : 'disabled');

  const embedder = createEmbedder(config.embed.provider, {
    model: config.embed.model,
    baseUrl: config.embed.baseUrl,
    apiKey: config.embed.apiKey,
    hfEndpoint: config.embed.hfEndpoint,
  });

  const llm = createResilientLlm(
    new OpenAiCompatibleProvider({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
    }),
    {
      onRetry: (attempt, err) => logger.warn({ attempt, err: err.message }, 'LLM 调用失败，重试中'),
    },
  );

  const services = createServices({ db, config, embedder, llm, logger });
  const { bot } = startBotIfEnabled(config, services, logger);

  const app = buildApp({
    services,
    config,
    logger,
    statusRepo,
    webDist: resolve(ROOT, 'apps/web/dist'),
  });

  await app.listen({ port: config.server.port, host: '0.0.0.0' });
  logger.info(`小苏服务已启动: http://localhost:${config.server.port}`);

  if (bot) {
    try {
      await bot.start();
      logger.info('钉钉机器人 Stream 长连接已建立');
    } catch (e) {
      logger.error({ err: String(e) }, '钉钉机器人连接失败（检查 AppKey/AppSecret 与网络）');
    }
  }

  // 心跳：管理后台「设置」页展示 IM 连接状态
  setInterval(() => {
    if (bot) statusRepo.setBotStatus(bot.isConnected() ? 'connected' : 'disconnected');
  }, 30_000);

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('正在关闭服务...');
    bot?.stop();
    await app.close();
    db.close();
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((e) => {
  console.error('服务启动失败:', e);
  process.exit(1);
});
