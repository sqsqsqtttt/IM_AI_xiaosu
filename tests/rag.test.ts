import { describe, expect, it } from 'vitest';
import { chunkMarkdown, chunkText, extractCitationRefs, resolveCitations } from '@xiaosu/core';

const SAMPLE = `# 员工手册
## 假期
### 年假
入职满 1 年的员工每年享有 5 天带薪年假。
### 病假
每月 1 天带薪病假无需证明。
## 报销
报销须提供发票原件。
`;

describe('RAG 分块', () => {
  it('Markdown 按标题层级切分，保留章节路径', () => {
    const chunks = chunkMarkdown(SAMPLE);
    const annual = chunks.find((c) => c.content.includes('带薪年假'));
    expect(annual).toBeDefined();
    expect(annual!.heading).toContain('年假');
    expect(annual!.heading).toContain('假期');
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it('纯文本按段落分块，非空', () => {
    const chunks = chunkText('假期政策.txt', '一、年假\n入职满 1 年每年 5 天。\n\n二、病假\n每月 1 天免证明。');
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.every((c) => c.content.length > 0)).toBe(true);
  });

  it('长段落切分不超上限', () => {
    const long = '制度内容。'.repeat(400);
    const chunks = chunkText('a.txt', long);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(900);
  });
});

describe('引用校验', () => {
  const chunks = [
    {
      chunkId: 'c1',
      docId: 'd1',
      docName: '员工手册.md',
      seq: 1,
      heading: '年假',
      content: '入职满 1 年每年 5 天年假。',
      score: 0.9,
    },
  ];

  it('提取 [C#] 编号', () => {
    expect(extractCitationRefs('答案是 [C1][C2]。')).toEqual([1, 2]);
    expect(extractCitationRefs('没有引用')).toEqual([]);
  });

  it('超出检索范围的引用被剔除（防瞎编引用）', () => {
    const { content, citations } = resolveCitations('见 [C1] 与 [C7] 的规定', chunks);
    expect(content).toContain('[C1]');
    expect(content).not.toContain('[C7]');
    expect(citations).toHaveLength(1);
    expect(citations[0]!.docName).toBe('员工手册.md');
  });
});
