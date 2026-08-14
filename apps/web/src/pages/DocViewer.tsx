import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { apiGet } from '../api.ts';
import type { ChunkView, DocumentRow } from '../types.ts';
import StatusBadge from '../components/StatusBadge.tsx';

export default function DocViewer() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const chunkParam = params.get('chunk');
  const chunksParam = params.get('chunks');
  const [data, setData] = useState<{ doc: DocumentRow; chunks: ChunkView[] } | null>(null);
  const [error, setError] = useState('');

  // 支持单个 chunk= 与多个 chunks=id1,id2 两种跳转，全部高亮
  const highlightIds = useMemo(() => {
    const raw = chunksParam ?? chunkParam ?? '';
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [chunksParam, chunkParam]);

  useEffect(() => {
    setData(null);
    void apiGet<{ doc: DocumentRow; chunks: ChunkView[] }>(`/documents/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(() => {
    // 滚动到第一处高亮分块
    if (!data || highlightIds.size === 0) return;
    const firstId = data.chunks.find((c) => highlightIds.has(c.id))?.id;
    if (firstId) {
      const el = document.getElementById(`chunk-${firstId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [data, highlightIds]);

  if (error) return <div className="p-8 text-rose-600">{error}</div>;
  if (!data) return <div className="p-8 text-slate-400">加载中...</div>;

  const { doc, chunks } = data;
  const highlightCount = chunks.filter((c) => highlightIds.has(c.id)).length;

  return (
    <div className="p-8 max-w-4xl">
      <Link to="/documents" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> 返回文档库
      </Link>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold">{doc.name}</h1>
        <StatusBadge status={doc.status} />
      </div>
      {highlightCount > 0 && (
        <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-block">
          ✨ 已定位 {highlightCount} 处引用片段（黄色高亮）
        </div>
      )}
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {chunks.map((c) => {
          const highlighted = highlightIds.has(c.id);
          return (
            <div
              key={c.id}
              id={`chunk-${c.id}`}
              className={`p-5 ${highlighted ? 'bg-amber-50 ring-2 ring-amber-300 ring-inset' : ''}`}
            >
              {c.heading && (
                <div className="text-xs text-slate-400 mb-2 font-medium">§ {c.heading}</div>
              )}
              <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-slate-700">
                {c.content}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
