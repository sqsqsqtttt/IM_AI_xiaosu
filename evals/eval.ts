import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  chunkText,
  createEmbedder,
  createResilientLlm,
  floatsToBytes,
  loadConfig,
  OpenAiCompatibleProvider,
  parseFile,
  runAgent,
} from '@xiaosu/core';
import { buildToolRegistry, loadMockData } from '@xiaosu/core';
import { createDocumentsRepo, openDb } from '@xiaosu/db';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });

interface EvalCase {
  id: number;
  question: string;
  contains: string[];
  expectTool: string | null;
  expectCite: boolean;
  source: string;
  history?: Array<{ role: string; content: string }>;
}

const SEED_FILES = [
  '员工手册.md',
  '新人入职指南.md',
  'FAQ.md',
  '假期政策.txt',
  '报销细则.pdf',
  '考勤制度.docx',
];

async function main(): Promise<void> {
  const cases = JSON.parse(readFileSync(join(ROOT, 'evals/cases.json'), 'utf-8')).cases as EvalCase[];
  const config = loadConfig();
  if (!config.llm.apiKey) {
    console.error('[eval] .env 中缺少 LLM_API_KEY，评测需要真实模型');
    process.exit(1);
  }

  const db = openDb(':memory:');
  const docs = createDocumentsRepo(db);
  const embedder = createEmbedder(config.embed.provider, {
    model: config.embed.model,
    baseUrl: config.embed.baseUrl,
    apiKey: config.embed.apiKey,
    hfEndpoint: config.embed.hfEndpoint,
  });
  const llm = createResilientLlm(
    new OpenAiCompatibleProvider({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
    }),
    { timeoutMs: 90_000, maxRetries: 1 },
  );
  const mockData = loadMockData(join(ROOT, 'data/mock'));
  const registry = buildToolRegistry(mockData);

  console.log(`[eval] 索引 ${SEED_FILES.length} 篇种子文档...`);
  for (const name of SEED_FILES) {
    const buffer = readFileSync(join(ROOT, 'data/seed', name));
    const text = await parseFile(name, buffer);
    const drafts = chunkText(name, text);
    const vectors = await embedder.embed(drafts.map((d) => d.content));
    const doc = docs.insert({ name, mime: '', size: buffer.length, sha256: name });
    docs.replaceChunks(
      doc.id,
      drafts.map((d, i) => ({
        seq: i + 1,
        heading: d.heading,
        content: d.content,
        embedding: floatsToBytes(vectors[i] ?? []),
      })),
    );
    docs.updateStatus(doc.id, 'indexed', null);
  }

  const results: Array<{
    id: number;
    question: string;
    pass: boolean;
    toolPass: boolean;
    citePass: boolean;
    contentSnippet: string;
    tools: string[];
    citations: number;
  }> = [];

  console.log(`[eval] 运行 ${cases.length} 条用例...\n`);
  for (const c of cases) {
    const t0 = Date.now();
    const result = await runAgent(
      c.question,
      {
        llm,
        llmModel: config.llm.model,
        embedder,
        toolDefs: registry.defs,
        executeTool: registry.execute,
        listChunks: () =>
          docs.listAllChunks().map((ch) => ({
            chunkId: ch.id,
            docId: ch.doc_id,
            docName: ch.doc_name,
            seq: ch.seq,
            heading: ch.heading,
            content: ch.content,
            embedding: ch.embedding,
          })),
        history: c.history ?? [],
      },
      {},
    );
    const contentPass = c.contains.some((k) => result.content.includes(k));
    const toolPass = c.expectTool ? result.toolCalls.some((t) => t.name === c.expectTool) : true;
    const citePass = c.expectCite ? result.citations.length > 0 : true;
    const pass = contentPass && toolPass && citePass;
    results.push({
      id: c.id,
      question: c.question,
      pass,
      toolPass,
      citePass,
      contentSnippet: result.content.slice(0, 60).replaceAll('\n', ' '),
      tools: result.toolCalls.map((t) => t.name),
      citations: result.citations.length,
    });
    const mark = pass ? '✓' : '✗';
    console.log(`${mark} #${String(c.id).padStart(2)} [${(Date.now() - t0) / 1000}s] ${c.question}`);
    if (!pass) {
      console.log(`    期望关键词: ${c.contains.join(' / ')} | 工具: ${c.expectTool ?? '-'} | 引用: ${c.expectCite}`);
      console.log(`    实际: "${result.content.slice(0, 120).replaceAll('\n', ' ')}"`);
      console.log(`    工具调用: ${result.toolCalls.map((t) => t.name).join(', ') || '无'} | 引用数: ${result.citations.length}`);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const accuracy = (passed / results.length) * 100;
  const summary = `\n准确率: ${passed}/${results.length} (${accuracy.toFixed(1)}%)\n`;
  console.log(summary);

  const md = [
    '# 小苏 Evals 结果',
    '',
    `- 运行时间: ${new Date().toISOString()}`,
    `- 模型: ${config.llm.model}`,
    `- 准确率: **${passed}/${results.length} (${accuracy.toFixed(1)}%)**`,
    '',
    '| # | 用例 | 关键词 | 工具 | 引用 | 结果 |',
    '|---|------|--------|------|------|------|',
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.question} | ${r.pass ? '✓' : '✗'} | ${r.toolPass ? '✓' : '✗'} | ${r.citePass ? '✓' : '✗'} | ${r.pass ? '✅' : '❌'} |`,
    ),
    '',
  ].join('\n');
  writeFileSync(join(ROOT, 'evals/results.md'), md, 'utf-8');
  console.log(`[eval] 结果已写入 evals/results.md`);
  process.exit(accuracy >= 70 ? 0 : 1);
}

main().catch((e) => {
  console.error('[eval] 失败:', e);
  process.exit(1);
});
