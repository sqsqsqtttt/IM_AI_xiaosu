import { env, pipeline } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import type { EmbedProviderKind } from './config.ts';

export interface Embedder {
  dim: number;
  /** 文本 → 向量（用于文档分块与查询）。 */
  embed(texts: string[]): Promise<number[][]>;
  /** 预热（本地模型下载/加载，失败时抛错以便降级）。 */
  ready(): Promise<void>;
}

function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

// ---------------------------------------------------------------------------
// 本地嵌入：bge-small-zh-v1.5（transformers.js + onnxruntime-node，离线可用）
// ---------------------------------------------------------------------------

export class LocalEmbedder implements Embedder {
  readonly dim = 512;
  private pipe: FeatureExtractionPipeline | null = null;

  constructor(
    private model: string,
    private hfEndpoint: string,
  ) {}

  async ready(): Promise<void> {
    if (this.pipe) return;
    // 国内网络默认走 hf-mirror 镜像，避免 huggingface.co 下载失败
    if (this.hfEndpoint) env.remoteHost = this.hfEndpoint;
    env.allowLocalModels = false;
    this.pipe = await pipeline('feature-extraction', this.model, { dtype: 'fp32' });
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.ready();
    if (!texts.length) return [];
    const out: number[][] = [];
    // 分批避免一次占满内存
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16);
      const tensors = await Promise.all(batch.map((t) => this.pipe!(t, { pooling: 'mean', normalize: true })));
      for (const t of tensors) {
        const dims = (t as unknown as { dims: number[] }).dims;
        const data = Array.from((t as unknown as { data: Float32Array }).data);
        const flat = dims.length === 2 && dims[0] === 1 ? data : data.slice(0, this.dim);
        out.push(normalize(flat));
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// 远程嵌入：OpenAI 兼容 /embeddings 接口（如硅基流动 bge-m3、阿里 text-embedding）
// ---------------------------------------------------------------------------

export class RemoteEmbedder implements Embedder {
  dim = 1024;

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string,
  ) {}

  async ready(): Promise<void> {
    if (!this.baseUrl) throw new Error('EMBED_BASE_URL 未配置');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`嵌入接口 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
    const vecs = json.data.map((d) => d.embedding);
    this.dim = vecs[0]?.length ?? this.dim;
    return vecs.map(normalize);
  }
}

// ---------------------------------------------------------------------------
// 假嵌入：确定性哈希向量（离线测试用，保证结果可复现）
// ---------------------------------------------------------------------------

export class FakeEmbedder implements Embedder {
  readonly dim = 64;

  async ready(): Promise<void> {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const vec = new Array<number>(this.dim).fill(0);
      // 字符 n-gram 哈希到向量桶
      const grams: string[] = [];
      for (let i = 0; i < t.length; i++) {
        grams.push(t.slice(i, i + 2));
      }
      for (const g of grams) {
        let h = 0;
        for (const ch of g) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
        const idx = h % this.dim;
        vec[idx] = (vec[idx] ?? 0) + 1;
      }
      return normalize(vec);
    });
  }
}

export function createEmbedder(
  kind: EmbedProviderKind,
  opts: { model: string; baseUrl: string; apiKey: string; hfEndpoint: string },
): Embedder {
  switch (kind) {
    case 'remote':
      return new RemoteEmbedder(opts.baseUrl, opts.apiKey, opts.model);
    case 'fake':
      return new FakeEmbedder();
    case 'local':
    default:
      return new LocalEmbedder(opts.model, opts.hfEndpoint);
  }
}
