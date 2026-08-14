import { describe, expect, it } from 'vitest';
import { buildToolRegistry, FakeProvider, runAgent, type FakeRule } from '@xiaosu/core';
import { generateMockData } from '@xiaosu/core';

const rules: FakeRule[] = [
  {
    // 工具决策阶段：模型自主决定调员工工具
    match: /001/,
    toolCalls: [{ id: 't1', name: 'employee_info', args: JSON.stringify({ id: '001' }) }],
  },
  {
    // 回答阶段：工具结果注入后直接回答
    match: /001/,
    content: '员工 001 张三在研发部。[C1]',
  },
  {
    // 拒答路径
    match: /CEO|家庭住址/,
    content: '文档里没找到相关内容。',
  },
];

function makeDeps() {
  const mock = generateMockData(new Date('2026-08-10'));
  const registry = buildToolRegistry(mock, () => new Date('2026-08-10T10:00:00'));
  return {
    llm: new FakeProvider(rules),
    llmModel: 'fake-model',
    embedder: { dim: 4, ready: async () => {}, embed: async (ts: string[]) => ts.map(() => [0, 0, 0, 0]) },
    toolDefs: registry.defs,
    executeTool: registry.execute,
    listChunks: () => [] as never[],
    history: [] as Array<{ role: string; content: string }>,
  };
}

describe('Agent 工具自主决策（Mock LLM，完全离线）', () => {
  it('问员工部门 → 模型自主调用 employee_info 工具并作答', async () => {
    const result = await runAgent('员工 001 是哪个部门的？', makeDeps());
    expect(result.toolCalls.map((t) => t.name)).toContain('employee_info');
    const call = result.toolCalls.find((t) => t.name === 'employee_info');
    expect(call?.args).toEqual({ id: '001' });
    expect(result.content).toContain('研发部');
  });

  it('知识库外的问题（CEO 家庭住址）→ 拒答不编造', async () => {
    const result = await runAgent('我们公司 CEO 的家庭住址是？', makeDeps());
    expect(result.content).toContain('没找到');
    expect(result.toolCalls).toHaveLength(0);
  });
});

describe('工具执行器', () => {
  it('current_time 返回星期信息（供"上周"类问题计算）', async () => {
    const mock = generateMockData(new Date('2026-08-10'));
    const registry = buildToolRegistry(mock, () => new Date('2026-08-10T09:00:00'));
    const res = await registry.execute('current_time', {});
    expect(res.ok).toBe(true);
    expect((res.data as { weekday: string }).weekday).toBe('周一');
  });

  it('calculator 拒绝非法表达式', async () => {
    const mock = generateMockData(new Date('2026-08-10'));
    const registry = buildToolRegistry(mock);
    const bad = await registry.execute('calculator', { expression: 'process.exit()' });
    expect(bad.ok).toBe(false);
    const good = await registry.execute('calculator', { expression: '(1280+350)/2' });
    expect(good.ok).toBe(true);
    expect((good.data as { result: number }).result).toBe(815);
  });

  it('attendance_query 按员工与日期过滤', async () => {
    const mock = generateMockData(new Date('2026-08-10'));
    const registry = buildToolRegistry(mock, () => new Date('2026-08-10T09:00:00'));
    const res = await registry.execute('attendance_query', {
      emp_id: '001',
      from: '2026-08-01',
      to: '2026-08-10',
    });
    expect(res.ok).toBe(true);
    const data = res.data as { records: Array<{ emp_id: string }> };
    expect(data.records.length).toBeGreaterThan(0);
    expect(data.records.every((r) => r.emp_id === '001')).toBe(true);
  });
});
