import { Link } from 'react-router';
import type { Citation } from '../types.ts';

/** 引用来源展示：点击跳转文档查看页并高亮对应分块。 */
export default function Citations({ items }: { items: Citation[] }) {
  if (!items.length) return null;
  const seen = new Set<string>();
  const unique = items.filter((c) => {
    const key = `${c.docId}|${c.chunkId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <div className="mt-2 pt-2 border-t border-slate-100">
      <div className="text-[11px] text-slate-400 mb-1">📚 来源</div>
      <div className="flex flex-wrap gap-1.5">
        {unique.map((c) => (
          <Link
            key={c.chunkId}
            to={`/documents/${c.docId}?chunk=${c.chunkId}`}
            className="text-[11px] bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded px-2 py-0.5 transition-colors"
            title={c.snippet}
          >
            {c.docName}
            {c.heading ? ` · ${c.heading}` : ''}
          </Link>
        ))}
      </div>
    </div>
  );
}
