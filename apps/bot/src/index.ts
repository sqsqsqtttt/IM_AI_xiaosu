import { DWClient, EventAck, type DWClientDownStream } from 'dingtalk-stream';

export interface BotLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** 从钉钉事件解析出的机器人消息（统一模型，便于将来扩展飞书/企微）。 */
export interface BotMessage {
  userId: string;
  conversationId: string;
  /** '1' 单聊 | '2' 群聊 */
  conversationType: string;
  msgId: string;
  text: string;
  sessionWebhook: string;
  sessionWebhookExpiredTime: number;
}

export interface BotReply {
  /** 回复正文（已含引用）。 */
  text: string;
}

export interface BotHandlers {
  /**
   * 处理一条消息：持久化 + 运行 Agent，返回要回复的文案。
   * 抛错时由适配层兜底回复。
   */
  onMessage(msg: BotMessage): Promise<BotReply>;
}

export interface DingtalkBotOptions {
  appKey: string;
  appSecret: string;
  handlers: BotHandlers;
  logger: BotLogger;
}

export interface DingtalkBot {
  start(): Promise<void>;
  stop(): void;
  /** Stream 长连接当前是否在线。 */
  isConnected(): boolean;
}

/** 最近已处理消息的去重缓存（防止 ACK 丢失后 60s 重投导致重复回答）。 */
const recentMsgIds = new Set<string>();
function remember(msgId: string): boolean {
  if (!msgId) return false;
  if (recentMsgIds.has(msgId)) return true;
  recentMsgIds.add(msgId);
  if (recentMsgIds.size > 500) {
    const first = recentMsgIds.values().next().value;
    if (first) recentMsgIds.delete(first);
  }
  return false;
}

export function createDingtalkBot(opts: DingtalkBotOptions): DingtalkBot {
  const client = new DWClient({ clientId: opts.appKey, clientSecret: opts.appSecret });

  client.registerAllEventListener((event: DWClientDownStream) => {
    // 事件先 ACK 再异步处理，避免钉钉 60s 重投
    void handleEvent(event).catch((e) =>
      opts.logger.error({ err: String(e) }, '钉钉事件处理失败'),
    );
    return { status: EventAck.SUCCESS };
  });

  async function handleEvent(event: DWClientDownStream): Promise<void> {
    const topic = event.headers.topic ?? '';
    const eventType = event.headers.eventType ?? '';
    if (!topic.includes('im/bot/messages') && eventType !== 'im.message.receive_v1') return;

    let raw: unknown;
    try {
      raw = JSON.parse(event.data);
    } catch {
      opts.logger.warn({ data: String(event.data).slice(0, 200) }, '钉钉消息不是合法 JSON');
      return;
    }
    const parsed = (raw as { data?: unknown }).data ?? raw;
    const m = parsed as Partial<{
      conversationId: string;
      conversationType: string;
      msgId: string;
      msgtype: string;
      senderStaffId: string;
      senderId: string;
      text: { content: string };
      sessionWebhook: string;
      sessionWebhookExpiredTime: number;
    }>;

    if (m.msgtype !== 'text' || !m.text?.content) return;
    const msg: BotMessage = {
      userId: m.senderStaffId ?? m.senderId ?? 'unknown',
      conversationId: m.conversationId ?? '',
      conversationType: m.conversationType ?? '2',
      msgId: m.msgId ?? '',
      text: m.text.content,
      sessionWebhook: m.sessionWebhook ?? '',
      sessionWebhookExpiredTime: m.sessionWebhookExpiredTime ?? 0,
    };
    if (!msg.conversationId) {
      opts.logger.warn({}, '钉钉消息缺少 conversationId，忽略');
      return;
    }
    if (remember(msg.msgId)) return;
    await handleMessage(msg);
  }

  async function handleMessage(msg: BotMessage): Promise<void> {
    const started = Date.now();
    try {
      const reply = await opts.handlers.onMessage(msg);
      const text = reply.text || '（小苏没有想好怎么回答）';
      await sendSessionReply(msg, text);
      opts.logger.info(
        { conversationId: msg.conversationId, latencyMs: Date.now() - started },
        '钉钉消息已回复',
      );
    } catch (e) {
      opts.logger.error({ err: String(e) }, '处理钉钉消息失败，发送兜底回复');
      try {
        await sendSessionReply(msg, '小苏开小差了，请稍后再试 😅');
      } catch (e2) {
        opts.logger.error({ err: String(e2) }, '兜底回复也发送失败');
      }
    }
  }

  async function sendSessionReply(msg: BotMessage, text: string): Promise<void> {
    const payload =
      text.length > 400
        ? { msgtype: 'markdown', markdown: { title: '小苏', text } }
        : { msgtype: 'text', text: { content: text } };
    if (msg.sessionWebhook && Date.now() <= msg.sessionWebhookExpiredTime + 60_000) {
      const res = await fetch(msg.sessionWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return;
      throw new Error(`sessionWebhook 回复失败: HTTP ${res.status}`);
    }
    throw new Error('sessionWebhook 缺失或已过期');
  }

  return {
    async start(): Promise<void> {
      await client.connect();
    },
    stop(): void {
      client.disconnect();
    },
    isConnected(): boolean {
      return client.connected && client.registered;
    },
  };
}
