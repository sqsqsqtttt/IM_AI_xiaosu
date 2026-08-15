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

  it('提供 onDelta 时答案逐字流式输出（Web 端行为）', async () => {
    const deltas: string[] = [];
    const result = await runAgent(
      '员工 001 是哪个部门的？',
      makeDeps(),
      { onDelta: (t) => deltas.push(t) },
    );
    expect(deltas.join('')).toContain('研发部');
    expect(result.content).toContain('研发部');
  });

  it('模型带旁白发起工具调用 → 工具必须执行，旁白不算最终答案', async () => {
    const mock = generateMockData(new Date('2026-08-10'));
    const registry = buildToolRegistry(mock, () => new Date('2026-08-10T10:00:00'));
    const llm = new FakeProvider([
      {
        match: /销售额/,
        toolCalls: [{ id: 't1', name: 'orders_query', args: JSON.stringify({}) }],
        partialContent: '我先确认一下当前时间，再帮你查订单数据。',
      },
      { match: /销售额/, content: '上周三销售额为 1280 元。' },
    ]);
    const result = await runAgent('上周三的销售额是多少？', {
      llm,
      llmModel: 'fake-model',
      embedder: {
        dim: 4,
        ready: async () => {},
        embed: async (ts: string[]) => ts.map(() => [0, 0, 0, 0]),
      },
      toolDefs: registry.defs,
      executeTool: registry.execute,
      listChunks: () => [],
      history: [],
    });
    expect(result.toolCalls.map((t) => t.name)).toContain('orders_query');
    expect(result.content).toContain('1280');
    expect(result.content).not.toContain('我先确认一下');
  });

  it('逐字摘录挂到对应引用上（原文精确标记数据源）', async () => {
    const quote = '入职满 1 年的员工，每年享有 5 天带薪年假。';
    const llm = new FakeProvider([
      {
        match: /年假/,
        content: `入职满 1 年每年 5 天。\n> ${quote} [C1]`,
      },
    ]);
    const deps = {
      llm,
      llmModel: 'fake-model',
      embedder: {
        dim: 4,
        ready: async () => {},
        embed: async (ts: string[]) => ts.map(() => [0, 0, 0, 0]),
      },
      toolDefs: [] as never[],
      executeTool: async () => ({ ok: false as const, error: '无工具' }),
      listChunks: () => [
        {
          chunkId: 'c1',
          docId: 'd1',
          docName: '员工手册.md',
          seq: 4,
          heading: '员工手册（苏云科技） > 2.1 年假',
          content: `${quote}工龄每满 1 年，年假增加 1 天。`,
          embedding: new Uint8Array(16),
        },
      ],
      history: [] as Array<{ role: string; content: string }>,
    };
    const result = await runAgent('年假有几天？', deps);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]!.quotes).toEqual([quote]);
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

  it('employee_info 支持按姓名查询（"张三是谁"场景）', async () => {
    const mock = generateMockData(new Date('2026-08-10'));
    const registry = buildToolRegistry(mock, () => new Date('2026-08-10T09:00:00'));
    const byName = await registry.execute('employee_info', { name: '张三' });
    expect(byName.ok).toBe(true);
    expect((byName.data as { id: string; dept: string }).id).toBe('001');
    const byId = await registry.execute('employee_info', { id: '001' });
    expect(byId.ok).toBe(true);
    const missing = await registry.execute('employee_info', { name: '不存在的人' });
    expect(missing.ok).toBe(false);
  });
});
