import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import pinoRoll from 'pino-roll';

export type Logger = pino.Logger;

/**
 * 结构化日志：控制台（可读格式）+ 文件（logs/xiaosu.log，按天/5MB 滚动）。
 */
export async function createLogger(logDir: string): Promise<Logger> {
  mkdirSync(logDir, { recursive: true });
  const roll = await pinoRoll({
    file: join(logDir, 'xiaosu.log'),
    size: '5m',
    frequency: 'daily',
    mkdir: true,
  });
  const pretty = pino.transport({
    target: 'pino-pretty',
    options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
  });
  return pino({ level: 'info' }, pino.multistream([{ stream: roll }, { stream: pretty }]));
}
