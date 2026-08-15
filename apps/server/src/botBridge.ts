import type { AppConfig } from '@xiaosu/core';
import { createDingtalkBot, type DingtalkBot } from '@xiaosu/bot';
import type { Logger } from './logger.ts';
import type { Services } from './services.ts';

/** 按配置启动钉钉 Stream 长连接；未配置密钥时跳过（不阻塞 Web 功能）。 */
export function startBotIfEnabled(
  config: AppConfig,
  services: Services,
  logger: Logger,
): { bot: DingtalkBot | null } {
  if (!config.dingtalk.enabled) {
    logger.warn('钉钉机器人未启用（DINGTALK_ENABLED=false），仅运行 Web 服务');
    return { bot: null };
  }
  if (!config.dingtalk.appKey || !config.dingtalk.appSecret) {
    logger.error('DINGTALK_ENABLED=true 但缺少 AppKey/AppSecret，机器人无法启动');
    return { bot: null };
  }
  const bot = createDingtalkBot({
    appKey: config.dingtalk.appKey,
    appSecret: config.dingtalk.appSecret,
    aiCard: config.dingtalk.aiCard,
    logger,
    handlers: {
      onMessage: (msg, onDelta) => services.chat.runIM(msg, onDelta),
    },
  });
  return { bot };
}
