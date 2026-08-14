import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiJson } from '../api.ts';
import type { SettingsView, StatsView, StatusView } from '../types.ts';
import StatusBadge from '../components/StatusBadge.tsx';

export default function Settings() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [status, setStatus] = useState<StatusView | null>(null);
  const [stats, setStats] = useState<StatsView | null>(null);
  const [model, setModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [s, st, sta] = await Promise.all([
        apiGet<SettingsView>('/settings'),
        apiGet<StatusView>('/status'),
        apiGet<StatsView>('/stats'),
      ]);
      setSettings(s);
      setStatus(st);
      setStats(sta);
      setModel(s.currentModel);
    } catch {
      // 静默失败，页面显示占位
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    setSaving(true);
    setNotice('');
    try {
      await apiJson('/settings', 'PUT', { llm_model: model });
      setNotice('已保存，立即生效');
      void refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">设置</h1>

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-5">
        <h2 className="font-semibold mb-4">模型设置</h2>
        <label className="block text-sm text-slate-500 mb-1.5">对话模型（LLM）</label>
        <div className="flex gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {(settings?.availableModels ?? [model]).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
        {notice && <div className="mt-2 text-xs text-emerald-600">{notice}</div>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-5">
        <h2 className="font-semibold mb-4">运行状态</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">IM 机器人（钉钉）</dt>
            <dd>
              <StatusBadge status={status?.bot?.status ?? null} />
              {status?.bot?.status === 'connected' && (
                <span className="text-[11px] text-slate-400 ml-1.5">
                  {status.bot.last_seen ? new Date(status.bot.last_seen).toLocaleTimeString('zh-CN') : ''}
                </span>
              )}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">嵌入模型</dt>
            <dd className="font-medium">{settings?.embedModel ?? '-'}（{settings?.embedProvider}）</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">LLM 接口</dt>
            <dd className="font-medium">{settings?.llmBaseUrl ?? '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">公网地址</dt>
            <dd className="font-medium">{settings?.publicBaseUrl || '（未配置，IM 引用仅文本展示）'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">累计对话 / 消息</dt>
            <dd className="font-medium">
              {stats?.conversations ?? '-'} / {stats?.messages ?? '-'}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">累计 Token / 成本</dt>
            <dd className="font-medium">
              {(stats ? stats.tokens_in + stats.tokens_out : '-').toLocaleString()} / $
              {(stats?.cost ?? 0).toFixed(4)}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">服务运行时长</dt>
            <dd className="font-medium">
              {status ? `${Math.floor(status.uptimeSec / 60)} 分钟` : '-'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="text-xs text-slate-400 leading-relaxed">
        密钥与钉钉配置在项目根目录 <code className="bg-slate-100 px-1 rounded">.env</code> 中维护（不入仓库）。
        修改后重启服务生效。
      </div>
    </div>
  );
}
