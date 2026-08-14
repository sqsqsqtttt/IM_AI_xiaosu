import { useEffect, useRef, useState } from 'react';
import { SendHorizonal } from 'lucide-react';
import { chatStream } from '../api.ts';
import type { Citation, ToolCallRecord } from '../types.ts';
import Markdown from '../components/Markdown.tsx';
import Citations from '../components/Citations.tsx';

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

function getConversationId(): string {
  const KEY = 'xiaosu-web-conv';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export default function Chat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

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

    // 打字机节奏：模型分片到达速度快，这里按固定节奏逐字吐出
    let pending = '';
    let acc = '';
    let timer: number | null = null;
    const flush = (count: number): void => {
      const chunk = pending.slice(0, count);
      pending = pending.slice(count);
      if (chunk) {
        acc += chunk;
        appendDelta(chunk);
      }
      if (!pending && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    await chatStream(text, getConversationId(), {
      onDelta: (t) => {
        pending += t;
        if (timer === null) {
          timer = window.setInterval(() => flush(2), 55);
        }
      },
      onDone: (data) => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
        flush(pending.length); // 吐出剩余内容
        update({
          streaming: false,
          content: acc || String(data.content ?? ''),
          citations: data.citations as Citation[] | undefined,
          toolCalls: data.toolCalls as ToolCallRecord[] | undefined,
          usage: data.usage as UiMessage['usage'],
          costUsd: data.costUsd as number | undefined,
        });
      },
      onError: (msg) => {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
        flush(pending.length);
        update({ streaming: false, error: msg });
      },
    });
    setMessages((m) =>
      m.map((x) => (x.id === aiMsg.id && x.streaming ? { ...x, streaming: false } : x)),
    );
    setBusy(false);
  };

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto">
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
