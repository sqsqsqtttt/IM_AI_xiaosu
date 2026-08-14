import { DWClient, EventAck, TOPIC_ROBOT, type DWClientDownStream } from 'dingtalk-stream';

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

/**
 * 去 Markdown 化：钉钉 text 消息不渲染 Markdown，星号/井号会原样露出。
 * 把加粗/斜体/标题/列表/行内代码转成自然纯文本，IM 展示更干净。
 */
export function stripMarkdownForIM(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // 加粗
    .replace(/\*([^*\n]+)\*/g, '$1') // 斜体
    .replace(/^#{1,6}\s+/gm, '') // 标题
    .replace(/^[-*]\s+/gm, '· ') // 无序列表
    .replace(/`([^`\n]+)`/g, '$1') // 行内代码
    .trim();
}

export interface DingtalkBot {
  start(): Promise<void>;
  stop(): void;
  /** Stream 长连接当前是否在线。 */
  isConnected(): boolean;
  /** 连接诊断信息（管理后台状态排障用）。 */
  getDebug(): { connected: boolean; registered: boolean };
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
  // 同时订阅 EVENT（通配 + 机器人主题）与 CALLBACK（机器人消息可能以回调类型推送）
  const client = new DWClient({
    clientId: opts.appKey,
    clientSecret: opts.appSecret,
    subscriptions: [
      { type: 'EVENT', topic: '*' },
      { type: 'EVENT', topic: TOPIC_ROBOT },
      { type: 'CALLBACK', topic: TOPIC_ROBOT },
    ],
  } as unknown as ConstructorParameters<typeof DWClient>[0]);

  // 全量下行消息观测（连接与消息排障；心跳 ping/KEEPALIVE 除外）
  const origOnDownStream = client.onDownStream.bind(client);
  client.onDownStream = (data: string): void => {
    try {
      const msg = JSON.parse(data) as { type?: string; headers?: { topic?: string } };
      const topic = msg.headers?.topic ?? '';
      if (msg.type !== 'SYSTEM' || (topic !== 'KEEPALIVE' && topic !== 'ping')) {
        opts.logger.info(
          { type: msg.type, topic, data: String(data).slice(0, 200) },
          '钉钉下行消息',
        );
      }
    } catch {
      // 非 JSON 忽略
    }
    origOnDownStream(data);
  };

  // EVENT 通道（部分网关以事件形式推送机器人消息）
  client.registerAllEventListener((event: DWClientDownStream) => {
    const topic = event.headers.topic ?? '';
    const eventType = event.headers.eventType ?? '';
    if (!topic.includes('im/bot/messages') && eventType !== 'im.message.receive_v1') {
      opts.logger.info({ topic, eventType }, '钉钉事件（非机器人消息，忽略）');
      return { status: EventAck.SUCCESS };
    }
    // 先 ACK 再异步处理，避免钉钉 60s 重投
    void processRobotData(event.data).catch((e) =>
      opts.logger.error({ err: String(e) }, '钉钉机器人消息处理失败'),
    );
    return { status: EventAck.SUCCESS };
  });

  // CALLBACK 通道（官方机器人消息的推送方式）
  client.registerCallbackListener(TOPIC_ROBOT, (event: DWClientDownStream) => {
    void processRobotData(event.data).catch((e) =>
      opts.logger.error({ err: String(e) }, '钉钉机器人回调处理失败'),
    );
  });

  /** 解析并处理一条机器人消息（EVENT 与 CALLBACK 两种通道共用）。 */
  async function processRobotData(data: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      opts.logger.warn({ data: String(data).slice(0, 200) }, '钉钉消息不是合法 JSON');
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

    if (m.msgtype !== 'text' || !m.text?.content) {
      opts.logger.info({ msgtype: m.msgtype }, '非文本机器人消息，忽略');
      return;
    }
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
    if (remember(msg.msgId)) {
      opts.logger.info({ msgId: msg.msgId }, '重复消息，跳过');
      return;
    }
    await handleMessage(msg);
  }

  async function handleMessage(msg: BotMessage): Promise<void> {
    const started = Date.now();
    // 立即回执，避免用户干等（流式感知体验；失败不影响主流程）
    try {
      await sendSessionReply(msg, '🤔 小苏正在思考…');
    } catch {
      // 回执失败忽略，最终回答仍会发送
    }
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

  /**
   * 去 Markdown 化：钉钉 text 消息不渲染 Markdown，星号/井号会原样露出。
   */
  function stripMarkdown(text: string): string {
    return stripMarkdownForIM(text);
  }

  async function sendSessionReply(msg: BotMessage, text: string): Promise<void> {
    const clean = stripMarkdown(text);
    const payload =
      clean.length > 400
        ? { msgtype: 'markdown', markdown: { title: '小苏', text: clean } }
        : { msgtype: 'text', text: { content: clean } };
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
      // 网关可能不下发 REGISTERED 系统消息（registered 常为 false），以 WebSocket 是否在线为准
      return client.connected;
    },
    getDebug(): { connected: boolean; registered: boolean } {
      return { connected: client.connected, registered: client.registered };
    },
  };
}
