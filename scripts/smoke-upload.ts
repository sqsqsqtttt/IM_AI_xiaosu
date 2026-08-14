import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';

/** 冒烟脚本：走 HTTP multipart 上传全部种子文档，验证解析/嵌入/索引链路。 */
const files = [
  'data/seed/员工手册.md',
  'data/seed/新人入职指南.md',
  'data/seed/FAQ.md',
  'data/seed/假期政策.txt',
  'data/seed/报销细则.pdf',
  'data/seed/考勤制度.docx',
];

const BASE = 'http://localhost:3000';

for (const f of files) {
  const fd = new FormData();
  fd.append('file', await openAsBlob(f), basename(f));
  const res = await fetch(`${BASE}/api/documents`, { method: 'POST', body: fd });
  const data = (await res.json()) as { doc?: { name: string; status: string; chunk_count: number }; skipped?: boolean; error?: string };
  if (!res.ok) {
    console.log(`✗ ${basename(f)} → ${data.error ?? res.status}`);
  } else {
    console.log(`✓ ${data.doc!.name} → ${data.doc!.status}（${data.doc!.chunk_count} 块）skipped=${data.skipped}`);
  }
}

// 增量更新验证：同名同内容再传一次应跳过
const again = new FormData();
again.append('file', await openAsBlob(files[0]!), basename(files[0]!));
const r2 = await fetch(`${BASE}/api/documents`, { method: 'POST', body: again });
const d2 = (await r2.json()) as { skipped?: boolean; doc?: { chunk_count: number } };
console.log(`\n增量更新：同名同内容重传 → skipped=${d2.skipped}`);

const list = (await (await fetch(`${BASE}/api/documents`)).json()) as { documents: unknown[] };
console.log(`文档总数: ${list.documents.length}`);
