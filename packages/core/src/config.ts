import { z } from 'zod';

const EnvSchema = z.object({
  LLM_BASE_URL: z.string().default('https://api.deepseek.com'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('deepseek-v4-flash'),
  EMBED_PROVIDER: z.enum(['local', 'remote', 'fake']).default('local'),
  EMBED_MODEL: z.string().default('Xenova/bge-small-zh-v1.5'),
  EMBED_BASE_URL: z.string().default(''),
  EMBED_API_KEY: z.string().default(''),
  HF_ENDPOINT: z.string().default('https://hf-mirror.com'),
  DINGTALK_ENABLED: z.string().default('false'),
  DINGTALK_APP_KEY: z.string().default(''),
  DINGTALK_APP_SECRET: z.string().default(''),
  PORT: z.coerce.number().default(3000),
  PUBLIC_BASE_URL: z.string().default(''),
  DB_PATH: z.string().default('./data/xiaosu.db'),
  LOG_DIR: z.string().default('./logs'),
  DATA_DIR: z.string().default('./data'),
});

export type EmbedProviderKind = 'local' | 'remote' | 'fake';

export interface AppConfig {
  llm: { baseUrl: string; apiKey: string; model: string };
  embed: {
    provider: EmbedProviderKind;
    model: string;
    baseUrl: string;
    apiKey: string;
    hfEndpoint: string;
  };
  dingtalk: { enabled: boolean; appKey: string; appSecret: string };
  server: { port: number; publicBaseUrl: string };
  paths: { dbPath: string; logDir: string; dataDir: string };
}

/** 从环境变量加载全部配置（.env 由入口进程通过 dotenv 注入）。 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = EnvSchema.parse(env);
  return {
    llm: { baseUrl: e.LLM_BASE_URL, apiKey: e.LLM_API_KEY, model: e.LLM_MODEL },
    embed: {
      provider: e.EMBED_PROVIDER,
      model: e.EMBED_MODEL,
      baseUrl: e.EMBED_BASE_URL,
      apiKey: e.EMBED_API_KEY,
      hfEndpoint: e.HF_ENDPOINT,
    },
    dingtalk: {
      enabled: e.DINGTALK_ENABLED === 'true',
      appKey: e.DINGTALK_APP_KEY,
      appSecret: e.DINGTALK_APP_SECRET,
    },
    server: { port: e.PORT, publicBaseUrl: e.PUBLIC_BASE_URL },
    paths: { dbPath: e.DB_PATH, logDir: e.LOG_DIR, dataDir: e.DATA_DIR },
  };
}
