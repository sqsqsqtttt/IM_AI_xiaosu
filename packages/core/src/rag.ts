import { readFileSync } from 'node:fs';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import type { Embedder } from './embed.ts';
import type { Citation, RetrievedChunk } from './types.ts';

// ---------------------------------------------------------------------------
// 文档解析：Markdown / TXT / PDF / DOCX
// ---------------------------------------------------------------------------

export async function parseFile(name: string, buffer: Buffer): Promise<string> {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md' || ext === 'txt' || ext === 'markdown') {
    return buffer.toString('utf-8');
  }
  if (ext === 'pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  if (ext === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  throw new Error(`不支持的文档格式: .${ext}（支持 md/txt/pdf/docx）`);
}

// ---------------------------------------------------------------------------
// 分块
// ---------------------------------------------------------------------------

export interface ChunkDraft {
  heading: string | null;
  content: string;
}

const MAX_CHUNK = 800;
const OVERLAP = 100;

function splitLong(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    parts.push(text.slice(start, start + MAX_CHUNK));
    if (start + MAX_CHUNK >= text.length) break;
    start += MAX_CHUNK - OVERLAP;
  }
  return parts;
}

/** 按标题层级切分 Markdown，长段落再二次切分。 */
export function chunkMarkdown(md: string): ChunkDraft[] {
  const lines = md.split(/\r?\n/);
  const chunks: ChunkDraft[] = [];
  const headingStack: string[] = [];
  let current: string[] = [];

  const flush = (): void => {
    const text = current.join('\n').trim();
    current = [];
    if (!text) return;
    if (text.length <= MAX_CHUNK) {
      chunks.push({ heading: headingStack.join(' > ') || null, content: text });
    } else {
      for (const part of splitLong(text)) {
        chunks.push({ heading: headingStack.join(' > ') || null, content: part });
      }
    }
  };

  for (const line of lines) {
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      const level = m[1]!.length;
      const title = m[2]!.trim();
      headingStack.length = level - 1;
      headingStack.push(title);
      current.push(line);
      continue;
    }
    current.push(line);
  }
  flush();
  return chunks;
}

/** 纯文本分块：按空行分段落，再按长度合并。 */
export function chunkPlain(text: string): ChunkDraft[] {
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: ChunkDraft[] = [];
  let buf: string[] = [];
  let len = 0;
  const flush = (): void => {
    const content = buf.join('\n').trim();
    buf = [];
    len = 0;
    if (!content) return;
    if (content.length <= MAX_CHUNK) {
      chunks.push({ heading: null, content });
    } else {
      for (const part of splitLong(content)) chunks.push({ heading: null, content: part });
    }
  };
  for (const p of paragraphs) {
    if (len + p.length > MAX_CHUNK && buf.length > 0) flush();
    buf.push(p);
    len += p.length;
  }
  flush();
  return chunks;
}

/** 统一入口：md 走标题切分，其余走纯文本切分。 */
export function chunkText(name: string, text: string): ChunkDraft[] {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const chunks = ext === 'md' || ext === 'markdown' ? chunkMarkdown(text) : chunkPlain(text);
  if (!chunks.length) chunks.push({ heading: null, content: text.slice(0, MAX_CHUNK) });
  return chunks;
}

// ---------------------------------------------------------------------------
// BM25 关键词检索（与向量检索混合，提高中文命中率）
// ---------------------------------------------------------------------------

export interface Bm25Doc {
  id: string;
  content: string;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // 英文/数字词
  for (const m of text.matchAll(/[A-Za-z0-9_]+/g)) tokens.push(m[0].toLowerCase());
  // 中文连续串 → 二元组 + 单字
  for (const m of text.matchAll(/[\u4e00-\u9fa5]+/g)) {
    const s = m[0];
    for (let i = 0; i < s.length - 1; i++) tokens.push(s.slice(i, i + 2));
    for (const ch of s) tokens.push(ch);
  }
  return tokens;
}

export class Bm25Index {
  private docTokens = new Map<string, Map<string, number>>();
  private docLen = new Map<string, number>();
  private df = new Map<string, number>();
  private totalLen = 0;
  private docCount = 0;
  private avgLen = 0;

  constructor(docs: Bm25Doc[]) {
    this.docCount = docs.length;
    for (const d of docs) {
      const counts = new Map<string, number>();
      for (const t of tokenize(d.content)) counts.set(t, (counts.get(t) ?? 0) + 1);
      this.docTokens.set(d.id, counts);
      const len = [...counts.values()].reduce((a, b) => a + b, 0);
      this.docLen.set(d.id, len);
      this.totalLen += len;
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avgLen = this.docCount ? this.totalLen / this.docCount : 0;
  }

  search(query: string, topK: number): Array<{ id: string; score: number }> {
    const qTokens = tokenize(query);
    const k1 = 1.5;
    const b = 0.75;
    const scores: Array<{ id: string; score: number }> = [];
    for (const [id, counts] of this.docTokens) {
      let score = 0;
      for (const t of qTokens) {
        const tf = counts.get(t);
        const df = this.df.get(t);
        if (!tf || !df) continue;
        const idf = Math.log(1 + (this.docCount - df + 0.5) / (df + 0.5));
        const len = this.docLen.get(id) ?? 1;
        score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * len) / (this.avgLen || 1)));
      }
      if (score > 0) scores.push({ id, score });
    }
    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }
}

// ---------------------------------------------------------------------------
// 向量工具
// ---------------------------------------------------------------------------

export function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function bytesToFloats(bytes: Uint8Array): number[] {
  const out = new Array<number>(bytes.length / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

export function floatsToBytes(floats: number[]): Uint8Array {
  const buf = new ArrayBuffer(floats.length * 4);
  const view = new DataView(buf);
  floats.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return new Uint8Array(buf);
}

// ---------------------------------------------------------------------------
// 混合检索：0.5 × 向量余弦 + 0.5 × BM25，附精确匹配加成
// ---------------------------------------------------------------------------

export interface SearchChunk {
  chunkId: string;
  docId: string;
  docName: string;
  seq: number;
  heading: string | null;
  content: string;
  embedding: Uint8Array | null;
}

export const SCORE_THRESHOLD = 0.22;

function exactMatchBoost(query: string, content: string): number {
  let boost = 0;
  for (const m of query.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    if (content.includes(m[0])) boost += 0.12;
  }
  return Math.min(boost, 0.3);
}

export async function retrieve(
  query: string,
  chunks: SearchChunk[],
  embedder: Embedder,
  topK = 6,
): Promise<RetrievedChunk[]> {
  if (!chunks.length) return [];

  const bm25 = new Bm25Index(chunks.map((c) => ({ id: c.chunkId, content: c.content })));
  const bm25Results = new Map(bm25.search(query, 200).map((r) => [r.id, r.score]));
  const maxBm25 = Math.max(1, ...[...bm25Results.values()]);

  let queryVec: number[] | null = null;
  try {
    const [v] = await embedder.embed([query]);
    queryVec = v ?? null;
  } catch {
    queryVec = null; // 嵌入失败时降级为纯 BM25
  }

  const scored: RetrievedChunk[] = [];
  for (const c of chunks) {
    let score = 0;
    if (queryVec && c.embedding) {
      const cos = cosine(queryVec, bytesToFloats(c.embedding));
      score += 0.5 * ((cos + 1) / 2);
    } else {
      score += 0.15; // 无向量时给基线，让 BM25 主导
    }
    const b = (bm25Results.get(c.chunkId) ?? 0) / maxBm25;
    score += 0.5 * b;
    score += exactMatchBoost(query, c.content);
    if (score >= SCORE_THRESHOLD) {
      scored.push({
        chunkId: c.chunkId,
        docId: c.docId,
        docName: c.docName,
        seq: c.seq,
        heading: c.heading,
        content: c.content,
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ---------------------------------------------------------------------------
// 引用
// ---------------------------------------------------------------------------

/** 组装注入模型的编号上下文。 */
export function buildContext(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return '';
  return chunks
    .map((c, i) => {
      const heading = c.heading ? `（章节：${c.heading}）` : '';
      return `[C${i + 1}] 来源《${c.docName}》${heading}\n${c.content}`;
    })
    .join('\n\n');
}

/** 提取回答中的 [C#] 引用编号。 */
export function extractCitationRefs(content: string): number[] {
  const refs = new Set<number>();
  for (const m of content.matchAll(/\[C(\d+)\]/g)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n >= 1) refs.add(n);
  }
  return [...refs].sort((a, b) => a - b);
}

/**
 * 校验引用：编号必须指向真实检索到的分块，防模型瞎编引用。
 * 返回合法引用列表；非法编号从正文中移除。
 */
export function resolveCitations(content: string, chunks: RetrievedChunk[]): {
  content: string;
  citations: Citation[];
} {
  const refs = extractCitationRefs(content);
  const valid = refs.filter((n) => n <= chunks.length);
  const invalid = refs.filter((n) => n > chunks.length);
  let cleaned = content;
  for (const n of invalid) {
    cleaned = cleaned.replace(new RegExp(`\\[C${n}\\]`, 'g'), '');
  }
  const citations: Citation[] = valid.map((n) => {
    const c = chunks[n - 1]!;
    return {
      docId: c.docId,
      docName: c.docName,
      chunkId: c.chunkId,
      seq: c.seq,
      heading: c.heading,
      snippet: c.content.slice(0, 140),
    };
  });
  return { content: cleaned, citations };
}

// ---------------------------------------------------------------------------
// 原文摘录（引用块）校验：摘录必须逐字出现在检索到的原文中，否则剔除（防编造原话）
// ---------------------------------------------------------------------------

/** 提取回答中的引用块（行首 > 的行）。 */
export function extractQuotes(content: string): string[] {
  const quotes: string[] = [];
  for (const m of content.matchAll(/^>\s*(.+)$/gm)) {
    if (m[1]) quotes.push(m[1]);
  }
  return quotes;
}

/** 归一化：去掉空白、Markdown 强调符号与引用编号，便于逐字比对。 */
function normalizeForMatch(text: string): string {
  return text
    .replace(/\[C\d+\]/g, '')
    .replace(/[*_`~#>\s]/g, '');
}

/**
 * 校验引用块：每段摘录必须逐字出现在任一检索分块中（忽略空白与 Markdown 符号）。
 * 对不上的摘录行整体移除；返回 { content, quotes }。
 */
export function validateQuotes(
  content: string,
  chunks: RetrievedChunk[],
): { content: string; quotes: string[] } {
  if (!chunks.length) {
    // 无检索结果时全部摘录视为可疑，整行移除
    const stripped = content.replace(/^>\s*.+$/gm, '').replace(/\n{3,}/g, '\n\n');
    return { content: stripped, quotes: [] };
  }
  const haystacks = chunks.map((c) => normalizeForMatch(c.content));
  const kept: string[] = [];
  const removedLines = new Set<string>();
  for (const q of extractQuotes(content)) {
    const needle = normalizeForMatch(q);
    const matched = needle.length >= 6 && haystacks.some((h) => h.includes(needle));
    if (matched) {
      kept.push(q);
    } else {
      removedLines.add(q.trim());
    }
  }
  if (removedLines.size === 0) return { content, quotes: kept };
  // 仅移除未通过校验的摘录行
  const cleaned = content
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (!t.startsWith('>')) return true;
      const body = t.slice(1).trim();
      return !removedLines.has(body);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return { content: cleaned, quotes: kept };
}

/** 读取本地文件（种子数据加载用）。 */
export function readTextFile(path: string): string {
  return readFileSync(path, 'utf-8');
}

/**
 * 面向员工的人类可读位置描述：
 * 有章节路径 → 去掉文档标题段后的章节链（如 "2. 假期与考勤 › 2.1 年假"）；
 * 无章节 → 取分块内容首行（如 "一、年假" / "第一条 标准工时…"）作为定位。
 */
export function citationLocator(c: { heading: string | null; snippet: string }): string {
  if (c.heading) {
    const parts = c.heading.split(' > ').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) return parts.slice(1).join(' › ');
  }
  const firstLine = c.snippet
    .split('\n')
    .map((s) => s.trim())
    .find(Boolean);
  return firstLine ? firstLine.slice(0, 40) : '';
}

/**
 * 从分块原文中自动取一句适合作为摘录的句子（模型漏摘录时的兜底）：
 * 跳过标题/项目符号，找第一句足够长、含汉字、像完整句子的内容。
 */
export function autoExcerptLine(content: string): string | null {
  for (const raw of content.split('\n')) {
    const line = raw
      .replace(/^#{1,4}\s*/, '')
      .replace(/^[-*•]\s*/, '')
      .trim();
    if (line.length < 12) continue;
    if (!/[\u4e00-\u9fa5]/.test(line)) continue;
    if (!/[。；;！!？?]$/.test(line) && line.length < 20) continue;
    return line.length <= 60 ? line : line.slice(0, 60);
  }
  return null;
}
