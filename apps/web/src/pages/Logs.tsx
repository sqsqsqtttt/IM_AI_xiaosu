import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiGet } from '../api.ts';
import type { ConversationView, MessageView } from '../types.ts';
import StatusBadge from '../components/StatusBadge.tsx';
import Markdown from '../components/Markdown.tsx';

export default function Logs() {
  const [convs, setConvs] = useState<ConversationView[]>([]);
  const [selected, setSelected] = useState<ConversationView | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<{ conversations: ConversationView[] }>('/logs');
      setConvs(data.conversations);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = async (conv: ConversationView) => {
    setSelected(conv);
    try {
      const data = await apiGet<{ messages: MessageView[] }>(`/logs/${conv.id}`);
      setMessages(data.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

  return (
    <div className="p-8 flex gap-6 h-[calc(100vh-0px)]">
      <div className="w-80 shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold">对话日志</h1>
          <button
            onClick={() => void refresh()}
            className="p-1.5 border border-slate-300 rounded-lg hover:bg-slate-100"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
        {error && <div className="mb-2 text-xs text-rose-600">{error}</div>}
        <div className="flex-1 overflow-y-auto bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {convs.length === 0 && (
            <div className="p-6 text-sm text-slate-400 text-center">暂无对话记录</div>
          )}
          {convs.map((c) => (
            <button
              key={c.id}
              onClick={() => void open(c)}
              className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${
                selected?.id === c.id ? 'bg-blue-50/60' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    c.platform === 'dingtalk' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {c.platform === 'dingtalk' ? '钉钉' : 'Web'}
                </span>
                <span className="text-sm font-medium truncate">{c.last_message ?? '(无消息)'}</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1 flex justify-between">
                <span>用户 {c.user_id} · {c.message_count} 条</span>
                <span>{fmt(c.updated_at)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl overflow-y-auto">
        {!selected && (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">
            选择左侧会话查看完整消息
          </div>
        )}
        {selected && (
          <div className="divide-y divide-slate-100">
            {messages.map((m) => (
              <div key={m.id} className={`px-5 py-4 ${m.role === 'user' ? 'bg-slate-50/50' : ''}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-slate-500">
                    {m.role === 'user' ? '🙋 用户' : '🤖 小苏'}
                  </span>
                  <StatusBadge status={m.status} />
                  <span className="text-[11px] text-slate-400">{fmt(m.created_at)}</span>
                  {m.tokens_in != null && (
                    <span className="text-[11px] text-slate-400">
                      in {m.tokens_in} / out {m.tokens_out} tokens
                    </span>
                  )}
                  {m.cost != null && m.cost > 0 && (
                    <span className="text-[11px] text-slate-400">${m.cost.toFixed(6)}</span>
                  )}
                  {m.latency_ms != null && (
                    <span className="text-[11px] text-slate-400">{(m.latency_ms / 1000).toFixed(1)}s</span>
                  )}
                </div>
                {m.role === 'user' ? (
                  <div className="whitespace-pre-wrap text-sm">{m.content}</div>
                ) : (
                  <Markdown content={m.content} />
                )}
                {m.tool_calls && m.tool_calls.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[11px] text-slate-400 mb-1">🔧 工具调用</div>
                    {m.tool_calls.map((t, i) => (
                      <details key={i} className="text-[12px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-1.5">
                        <summary className="cursor-pointer font-medium text-slate-600">
                          {t.name}
                          {t.error ? <span className="text-rose-500">（失败: {t.error}）</span> : ''}
                        </summary>
                        <pre className="mt-1.5 text-[11px] overflow-x-auto text-slate-500">
                          {JSON.stringify({ args: t.args, result: t.result }, null, 2)}
                        </pre>
                      </details>
                    ))}
                  </div>
                )}
                {m.citations && m.citations.length > 0 && (
                  <div className="mt-2 text-[11px] text-slate-500">
                    📚 引用：
                    {m.citations.map((c) => `${c.docName}${c.heading ? ` · ${c.heading}` : ''}`).join('；')}
                  </div>
                )}
                {m.error && <div className="mt-1 text-[11px] text-rose-500">错误详情: {m.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
