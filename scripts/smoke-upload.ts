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

// 验收 7.6 生命周期：上传新文档 → 问答命中 → 删除 → 不再命中
const doc = files[0]!;
const fd2 = new FormData();
fd2.append('file', await openAsBlob(doc), '临时新规.md');
const up = await fetch(`${BASE}/api/documents`, { method: 'POST', body: fd2 });
const upData = (await up.json()) as { doc?: { id: string; status: string } };
console.log(`\n7.6 上传新文档: ${upData.doc?.status ?? '失败'}`);

const chat = async (msg: string) => {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, conversationId: 'smoke-76' }),
  });
  const text = await res.text();
  const lastData = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .pop()!;
  return JSON.parse(lastData.slice(5)) as { citations: Array<{ docName: string }> };
};
const hit1 = (await chat('员工每年有几天年假？')).citations.some((c) => c.docName === '临时新规.md');
await fetch(`${BASE}/api/documents/${upData.doc!.id}`, { method: 'DELETE' });
const hit2 = (await chat('员工每年有几天年假？')).citations.some((c) => c.docName === '临时新规.md');
console.log(`7.6 上传后命中: ${hit1} | 删除后命中: ${hit2}（应 false）→ ${hit1 && !hit2 ? 'PASS' : 'FAIL'}`);
