import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { apiGet } from '../api.ts';
import type { ChunkView, DocumentRow } from '../types.ts';
import StatusBadge from '../components/StatusBadge.tsx';

export default function DocViewer() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const chunkParam = params.get('chunk');
  const [data, setData] = useState<{ doc: DocumentRow; chunks: ChunkView[] } | null>(null);
  const [error, setError] = useState('');
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setData(null);
    void apiGet<{ doc: DocumentRow; chunks: ChunkView[] }>(`/documents/${id}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [data, chunkParam]);

  if (error) return <div className="p-8 text-rose-600">{error}</div>;
  if (!data) return <div className="p-8 text-slate-400">加载中...</div>;

  const { doc, chunks } = data;

  return (
    <div className="p-8 max-w-4xl">
      <Link to="/documents" className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> 返回文档库
      </Link>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">{doc.name}</h1>
        <StatusBadge status={doc.status} />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {chunks.map((c) => {
          const highlighted = c.id === chunkParam;
          return (
            <div
              key={c.id}
              ref={highlighted ? highlightRef : undefined}
              className={`p-5 ${highlighted ? 'bg-amber-50 ring-2 ring-amber-300 ring-inset rounded-xl' : ''}`}
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
