import { Link } from 'react-router';
import type { Citation } from '../types.ts';

/** 面向员工的人类可读位置：章节链或内容首行。 */
function locatorOf(c: Citation): string {
  if (c.heading) {
    const parts = c.heading
      .split(' > ')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 1) return parts.slice(1).join(' › ');
  }
  const firstLine = c.snippet
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 40) : '';
}

/**
 * 引用来源展示：按文档分组，标签显示人类可读位置（章节/条款/首行），
 * 点击跳转文档查看页并把该文档所有被引用分块与摘录原话一并精确标记。
 */
export default function Citations({ items }: { items: Citation[] }) {
  if (!items.length) return null;
  const byDoc = new Map<string, Citation[]>();
  for (const c of items) {
    const arr = byDoc.get(c.docId) ?? [];
    arr.push(c);
    byDoc.set(c.docId, arr);
  }

  const openDoc = (docId: string, cs: Citation[]): void => {
    // 通过 sessionStorage 传递"分块 → 摘录原话"映射，文档页据此精确标记
    const quoteMap: Record<string, string[]> = {};
    for (const c of cs) {
      if (c.quotes?.length) quoteMap[c.chunkId] = c.quotes;
    }
    try {
      sessionStorage.setItem(`xiaosu-quotes:${docId}`, JSON.stringify(quoteMap));
    } catch {
      // 存储失败不影响跳转
    }
  };

  return (
    <div className="mt-2 pt-2 border-t border-slate-100">
      <div className="text-[11px] text-slate-400 mb-1">📚 来源</div>
      <div className="flex flex-wrap gap-1.5">
        {[...byDoc.entries()].map(([docId, cs]) => {
          const first = cs[0]!;
          const locator = locatorOf(first);
          return (
            <Link
              key={docId}
              to={`/documents/${docId}?chunks=${cs.map((c) => c.chunkId).join(',')}`}
              onClick={() => openDoc(docId, cs)}
              className="text-[11px] bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded px-2 py-0.5 transition-colors"
              title={cs.map((c) => c.snippet).join('\n\n')}
            >
              {first.docName}
              {locator ? ` · ${locator}` : ''}
              {cs.length > 1 ? `（${cs.length} 处）` : ''}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
