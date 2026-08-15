import { randomUUID } from 'node:crypto';
import { getDingtalkAccessToken } from './token.ts';

/**
 * 钉钉 AI Markdown 卡片（流式打字机）。
 * API 配方来自官方 dingtalk-stream-sdk-python 0.24.3 源码（card_replier.py / card_instance.py）：
 *   1. POST /v1.0/card/instances          创建卡片实例（内置模板 + flowStatus=1 处理中 + STREAM 回调）
 *   2. POST /v1.0/card/instances/deliver  投放（群聊 IM_GROUP / 单聊 IM_ROBOT 两种空间）
 *   3. PUT  /v1.0/card/streaming          打字机更新（key=msgContent，全量替换，节流调用）
 *   4. PUT  /v1.0/card/instances          收尾（flowStatus=3 完成 / 5 失败）
 * 全部为出站 REST 调用，无需公网回调地址。
 */

/** 官方内置 AI Markdown 卡片模板（免自建模板）。 */
export const AI_CARD_TEMPLATE_ID = '382e4302-551d-4880-bf29-a30acfab2e71.schema';

export const FLOW_STATUS = {
  PROCESSING: 1,
  INPUTING: 2,
  FINISHED: 3,
  EXECUTING: 4,
  FAILED: 5,
} as const;

export interface CardTarget {
  appKey: string;
  conversationId: string;
  /** '1' 单聊 | '2' 群聊 */
  conversationType: string;
  senderStaffId: string;
}

function cardParamMap(title: string, content: string, flowStatus: number): Record<string, unknown> {
  return {
    msgTitle: title,
    msgContent: content,
    staticMsgContent: '',
    flowStatus,
    sys_full_json_obj: JSON.stringify({
      order: ['msgTitle', 'msgContent', 'staticMsgContent'],
    }),
  };
}

/** 创建卡片实例请求体。 */
export function buildCreateBody(outTrackId: string, title: string): Record<string, unknown> {
  return {
    cardTemplateId: AI_CARD_TEMPLATE_ID,
    outTrackId,
    cardData: { cardParamMap: cardParamMap(title, '', FLOW_STATUS.PROCESSING) },
    callbackType: 'STREAM',
    imGroupOpenSpaceModel: { supportForward: true },
    imRobotOpenSpaceModel: { supportForward: true },
  };
}

/** 投放卡片请求体（群聊/单聊分支，按官方 SDK 原样）。 */
export function buildDeliverBody(outTrackId: string, target: CardTarget): Record<string, unknown> {
  const base: Record<string, unknown> = { outTrackId, userIdType: 1 };
  if (target.conversationType === '2') {
    base.openSpaceId = `dtv1.card//IM_GROUP.${target.conversationId}`;
    base.imGroupOpenDeliverModel = { robotCode: target.appKey };
  } else {
    base.openSpaceId = `dtv1.card//IM_ROBOT.${target.senderStaffId}`;
    base.imRobotOpenDeliverModel = { spaceType: 'IM_ROBOT' };
  }
  return base;
}

/** 流式打字机更新请求体。 */
export function buildStreamingBody(
  outTrackId: string,
  content: string,
  opts: { isFinalize?: boolean; isError?: boolean } = {},
): Record<string, unknown> {
  return {
    outTrackId,
    guid: randomUUID(),
    key: 'msgContent',
    content,
    isFull: true,
    isFinalize: opts.isFinalize ?? false,
    isError: opts.isError ?? false,
  };
}

/** 完成/失败态整体更新请求体。 */
export function buildFinishBody(
  outTrackId: string,
  title: string,
  content: string,
  flowStatus: number,
): Record<string, unknown> {
  return {
    outTrackId,
    cardData: { cardParamMap: cardParamMap(title, content, flowStatus) },
  };
}

export interface AiCardSession {
  outTrackId: string;
  /** 打字机更新（content 为累计全文）。失败仅记录，不抛出。 */
  streaming(content: string): Promise<void>;
  /** 完成态。 */
  finish(content: string): Promise<void>;
  /** 失败态（友好话术）。 */
  fail(content: string): Promise<void>;
}

export interface AiCardClientOptions {
  appKey: string;
  appSecret: string;
  log: { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
}

export class AiCardClient {
  constructor(private opts: AiCardClientOptions) {}

  private async request(method: 'GET' | 'POST' | 'PUT', path: string, body: unknown): Promise<void> {
    const token = await getDingtalkAccessToken(this.opts.appKey, this.opts.appSecret);
    const res = await fetch(`https://api.dingtalk.com${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        'x-acs-dingtalk-access-token': token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`钉钉卡片接口 ${method} ${path} 失败: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  }

  /** 创建并投放 AI 卡片，返回会话句柄；失败抛错（调用方降级为文本回复）。 */
  async start(target: CardTarget, title: string): Promise<AiCardSession> {
    const outTrackId = randomUUID();
    await this.request('POST', '/v1.0/card/instances', buildCreateBody(outTrackId, title));
    await this.request('POST', '/v1.0/card/instances/deliver', buildDeliverBody(outTrackId, target));
    this.opts.log.info({ outTrackId, conversationId: target.conversationId }, 'AI 卡片已创建并投放');

    return {
      outTrackId,
      streaming: async (content: string) => {
        try {
          await this.request('PUT', '/v1.0/card/streaming', buildStreamingBody(outTrackId, content));
        } catch (e) {
          this.opts.log.warn({ err: String(e) }, '卡片流式更新失败（忽略，后续继续尝试）');
        }
      },
      finish: async (content: string) => {
        await this.request(
          'PUT',
          '/v1.0/card/instances',
          buildFinishBody(outTrackId, title, content, FLOW_STATUS.FINISHED),
        );
        this.opts.log.info({ outTrackId }, 'AI 卡片已完成');
      },
      fail: async (content: string) => {
        try {
          await this.request(
            'PUT',
            '/v1.0/card/instances',
            buildFinishBody(outTrackId, title, content, FLOW_STATUS.FAILED),
          );
        } catch (e) {
          this.opts.log.warn({ err: String(e) }, '卡片失败态更新也失败');
        }
      },
    };
  }
}
