import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FileText, RefreshCw, Trash2, Upload } from 'lucide-react';
import { apiGet, uploadDocument } from '../api.ts';
import type { DocumentRow } from '../types.ts';
import StatusBadge from '../components/StatusBadge.tsx';

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function Documents() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<{ documents: DocumentRow[] }>('/documents');
      setDocs(data.documents);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpload = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const { skipped } = await uploadDocument(file);
      if (skipped) setError(`「${file.name}」内容未变化，已跳过索引`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (doc: DocumentRow) => {
    if (!window.confirm(`确定删除「${doc.name}」？删除后不再参与问答。`)) return;
    try {
      await apiGet(`/documents/${doc.id}`).then(() => {});
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`删除失败: ${res.status}`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onReindex = async (doc: DocumentRow) => {
    try {
      const res = await fetch(`/api/documents/${doc.id}/reindex`, { method: 'POST' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? '重建索引失败');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const indexed = docs.filter((d) => d.status === 'indexed').length;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">知识库文档</h1>
          <p className="text-sm text-slate-500 mt-1">
            共 {docs.length} 篇（已索引 {indexed} 篇）· 支持 Markdown / PDF / Word / TXT
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 text-sm border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-100"
          >
            <RefreshCw className="w-4 h-4" /> 刷新
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1.5 text-sm bg-blue-600 text-white rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" /> {busy ? '上传中...' : '上传文档'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".md,.markdown,.txt,.pdf,.docx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUpload(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2.5 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">文档</th>
              <th className="px-4 py-3 font-medium w-24">状态</th>
              <th className="px-4 py-3 font-medium w-20">分块</th>
              <th className="px-4 py-3 font-medium w-24">大小</th>
              <th className="px-4 py-3 font-medium w-40">更新时间</th>
              <th className="px-4 py-3 font-medium w-40">操作</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  还没有文档，点击右上角「上传文档」开始（可先用 data/seed 下的示例文档）
                </td>
              </tr>
            )}
            {docs.map((d) => (
              <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <Link to={`/documents/${d.id}`} className="font-medium text-blue-700 hover:underline">
                      {d.name}
                    </Link>
                  </div>
                  {d.error && <div className="text-[11px] text-rose-500 mt-0.5">{d.error}</div>}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={d.status} />
                </td>
                <td className="px-4 py-3 text-slate-500">{d.chunk_count}</td>
                <td className="px-4 py-3 text-slate-500">{fmtSize(d.size)}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(d.updated_at).toLocaleString('zh-CN', { hour12: false })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {d.status === 'failed' && (
                      <button
                        onClick={() => void onReindex(d)}
                        className="text-xs text-amber-600 hover:underline"
                      >
                        重试
                      </button>
                    )}
                    <button
                      onClick={() => void onDelete(d)}
                      className="flex items-center gap-1 text-xs text-rose-600 hover:underline"
                    >
                      <Trash2 className="w-3 h-3" /> 删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
