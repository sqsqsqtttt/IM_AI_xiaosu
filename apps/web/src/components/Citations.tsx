import { Link } from 'react-router';
import type { Citation } from '../types.ts';

/**
 * 引用来源展示：按文档分组，点击跳转文档查看页，
 * 并把该文档所有被引用的分块一并高亮（?chunks=id1,id2）。
 */
export default function Citations({ items }: { items: Citation[] }) {
  if (!items.length) return null;
  const byDoc = new Map<string, Citation[]>();
  for (const c of items) {
    const arr = byDoc.get(c.docId) ?? [];
    arr.push(c);
    byDoc.set(c.docId, arr);
  }
  return (
    <div className="mt-2 pt-2 border-t border-slate-100">
      <div className="text-[11px] text-slate-400 mb-1">📚 来源</div>
      <div className="flex flex-wrap gap-1.5">
        {[...byDoc.entries()].map(([docId, cs]) => {
          const first = cs[0]!;
          return (
            <Link
              key={docId}
              to={`/documents/${docId}?chunks=${cs.map((c) => c.chunkId).join(',')}`}
              className="text-[11px] bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded px-2 py-0.5 transition-colors"
              title={cs.map((c) => c.snippet).join('\n\n')}
            >
              {first.docName}
              {first.heading ? ` · ${first.heading}` : ''}
              {`（第 ${first.seq} 块`}
              {cs.length > 1 ? `等 ${cs.length} 处` : ''}）
            </Link>
          );
        })}
      </div>
    </div>
  );
}
