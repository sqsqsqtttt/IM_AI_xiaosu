import { useEffect, useRef, useState } from 'react';
import { Plus, SendHorizonal } from 'lucide-react';
import { apiGet, chatStream } from '../api.ts';
import type { Citation, ConversationView, MessageView, ToolCallRecord } from '../types.ts';
import Markdown from '../components/Markdown.tsx';
import Citations from '../components/Citations.tsx';

/** 打字机节奏：每个 tick 吐出 CHARS_PER_TICK 个字（可调）。 */
const CHARS_PER_TICK = 2;
const TICK_MS = 60;

interface UiMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  toolCalls?: ToolCallRecord[];
  streaming?: boolean;
  error?: string;
  usage?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
}

const CONV_KEY = 'xiaosu-web-conv';

function getConversationId(): string {
  let id = localStorage.getItem(CONV_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CONV_KEY, id);
  }
  return id;
}

function resetConversationId(): string {
  const id = crypto.randomUUID();
  localStorage.setItem(CONV_KEY, id);
  return id;
}

export default function Chat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [convList, setConvList] = useState<ConversationView[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string>(() => getConversationId());
  const bottomRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  /** 从服务端加载指定会话的消息历史。 */
  const loadHistory = (convId: string): void => {
    void apiGet<{ messages: MessageView[] }>(
      `/chat/history?conversationId=${encodeURIComponent(convId)}`,
    )
      .then((data) => {
        const restored: UiMessage[] = data.messages.map((m) => ({
          id: nextId.current++,
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
          citations: m.citations ?? undefined,
          toolCalls: m.tool_calls ?? undefined,
          usage:
            m.tokens_in != null ? { inputTokens: m.tokens_in, outputTokens: m.tokens_out ?? 0 } : undefined,
          costUsd: m.cost ?? undefined,
        }));
        setMessages(restored);
      })
      .catch(() => {
        // 恢复失败不影响新对话
      });
  };

  /** 刷新 Web 会话列表（历史会话切换器用）。 */
  const refreshConvList = (): void => {
    void apiGet<{ conversations: ConversationView[] }>('/logs?limit=100')
      .then((d) => setConvList(d.conversations.filter((c) => c.platform === 'web')))
      .catch(() => {});
  };

  // 进入页面：恢复当前会话 + 拉取历史会话列表
  useEffect(() => {
    const convId = getConversationId();
    setCurrentConvId(convId);
    loadHistory(convId);
    refreshConvList();
  }, []);

  const switchConversation = (convId: string): void => {
    localStorage.setItem(CONV_KEY, convId);
    setCurrentConvId(convId);
    setMessages([]);
    loadHistory(convId);
  };

  const startNewChat = (): void => {
    const id = resetConversationId();
    setCurrentConvId(id);
    setMessages([]);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    const userMsg: UiMessage = { id: nextId.current++, role: 'user', content: text };
    const aiMsg: UiMessage = { id: nextId.current++, role: 'assistant', content: '', streaming: true };
    setMessages((m) => [...m, userMsg, aiMsg]);

    const update = (patch: Partial<UiMessage>) =>
      setMessages((m) => m.map((x) => (x.id === aiMsg.id ? { ...x, ...patch } : x)));
    const appendDelta = (t: string) =>
      setMessages((m) =>
        m.map((x) => (x.id === aiMsg.id ? { ...x, content: x.content + t } : x)),
      );

    // 打字机节奏：模型分片到达速度快，这里按固定节奏逐字吐出。
    // 关键：流结束后不一次性倒空缓冲，而是继续匀速吐完再收尾。
    let pending = '';
    let acc = '';
    let timer: number | null = null;
    let doneData: Record<string, unknown> | null = null;
    let errorMsg: string | null = null;
    let streamEnded = false;
    let finalized = false;

    const finalize = (): void => {
      if (finalized) return;
      finalized = true;
      if (doneData) {
        update({
          streaming: false,
          content: acc || String(doneData.content ?? ''),
          citations: doneData.citations as Citation[] | undefined,
          toolCalls: doneData.toolCalls as ToolCallRecord[] | undefined,
          usage: doneData.usage as UiMessage['usage'],
          costUsd: doneData.costUsd as number | undefined,
        });
      } else if (errorMsg) {
        update({ streaming: false, error: errorMsg });
      } else {
        update({ streaming: false });
      }
      setBusy(false);
      refreshConvList(); // 会话列表跟随最新消息刷新
    };

    const flush = (count: number): void => {
      const chunk = pending.slice(0, count);
      pending = pending.slice(count);
      if (chunk) {
        acc += chunk;
        appendDelta(chunk);
      }
      if (!pending) {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
        if (streamEnded) finalize();
      }
    };

    try {
      await chatStream(text, getConversationId(), {
        onDelta: (t) => {
          pending += t;
          if (timer === null) {
            timer = window.setInterval(() => flush(CHARS_PER_TICK), TICK_MS);
          }
        },
        onDone: (data) => {
          doneData = data;
          streamEnded = true;
          // 缓冲未吐完时交给定时器继续，吐完自动收尾
          if (!pending) finalize();
        },
        onError: (msg) => {
          errorMsg = msg;
          streamEnded = true;
          if (!pending) finalize();
        },
      });
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }
    streamEnded = true;
    if (!pending) finalize();
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-slate-100 bg-white/70 backdrop-blur">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-slate-600 shrink-0">与小苏聊天</span>
          {convList.length > 0 && (
            <select
              value={currentConvId}
              onChange={(e) => {
                if (e.target.value && e.target.value !== currentConvId) {
                  switchConversation(e.target.value);
                }
              }}
              className="text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white text-slate-600 max-w-[260px] truncate"
              title="切换历史会话"
            >
              {!convList.some((c) => c.conversation_id === currentConvId) && (
                <option value={currentConvId}>（当前对话）</option>
              )}
              {convList.map((c) => (
                <option key={c.id} value={c.conversation_id}>
                  {new Date(c.updated_at).toLocaleString('zh-CN', { hour12: false })} ·{' '}
                  {(c.last_message ?? '').slice(0, 18) || '（空会话）'}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={startNewChat}
          className="flex items-center gap-1 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 hover:bg-slate-100 text-slate-500 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> 新对话
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {messages.length === 0 && (
          <div className="text-center text-slate-400 mt-24">
            <div className="text-3xl mb-3">💬</div>
            <div>这是备用聊天页（管理端调试 / 面试演示）。</div>
            <div className="text-sm mt-1">试试问：员工每年有几天年假？ / 员工 001 是哪个部门的？ / 上周一共多少订单？</div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-white border border-slate-200 rounded-bl-sm shadow-sm'
              }`}
            >
              {m.role === 'user' ? (
                <div className="whitespace-pre-wrap">{m.content}</div>
              ) : (
                <>
                  <Markdown content={m.content || (m.streaming ? '思考中...' : '')} />
                  {m.error && <div className="text-rose-500 mt-1">{m.error}</div>}
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="mt-1.5 text-[11px] text-slate-400">
                      🔧 {m.toolCalls.map((t) => t.name).join('、')}
                    </div>
                  )}
                  <Citations items={m.citations ?? []} />
                  {!m.streaming && m.usage && (
                    <div className="mt-1.5 text-[10px] text-slate-300">
                      {m.usage.inputTokens + m.usage.outputTokens} tokens
                      {m.costUsd != null ? ` · $${m.costUsd.toFixed(6)}` : ''}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-6 pb-6">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send();
            }}
            placeholder="向小苏提问（Enter 发送）"
            disabled={busy}
            className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="bg-blue-600 text-white rounded-xl px-4 hover:bg-blue-700 disabled:opacity-40"
          >
            <SendHorizonal className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
