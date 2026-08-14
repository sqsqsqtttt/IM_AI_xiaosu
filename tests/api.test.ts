import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { FakeEmbedder, FakeProvider, loadConfig } from '@xiaosu/core';
import { createStatusRepo, openDb } from '@xiaosu/db';
import { createServices } from '../apps/server/src/services.ts';
import { buildApp } from '../apps/server/src/app.ts';

const MD_V1 = `# 员工手册\n## 年假\n入职满 1 年的员工每年享有 5 天带薪年假。\n\n## 报销\n报销须提供发票原件与报销单。`;
const MD_V2 = `# 员工手册\n## 年假\n入职满 1 年的员工每年享有 5 天带薪年假，上限 15 天。\n\n## 病假\n每月 1 天带薪病假无需证明。\n\n## 加班\n工作日加班 1.5 倍时薪。`;

function makeServices() {
  const db = openDb(':memory:');
  const config = loadConfig({});
  const logger = pino({ level: 'silent' });
  const services = createServices({
    db,
    config,
    embedder: new FakeEmbedder(),
    llm: new FakeProvider([{ match: /年假/, content: '入职满 1 年每年 5 天带薪年假。[C1]' }]),
    logger,
  });
  const app = buildApp({
    services,
    config,
    logger,
    statusRepo: createStatusRepo(db),
    webDist: __dirname + '/nonexistent',
  });
  return { services, app, db };
}

describe('文档知识库（服务 + API）', () => {
  it('上传 → 索引 → 列表状态正确', async () => {
    const { services } = makeServices();
    const { doc } = await services.documents.upload('员工手册.md', Buffer.from(MD_V1), 'text/markdown');
    expect(doc.status).toBe('indexed');
    expect(doc.chunk_count).toBeGreaterThan(0);
    expect(services.docsRepo.listAllChunks().length).toBe(doc.chunk_count);
  });

  it('同名同内容 → 跳过（不重复处理）；同名不同内容 → 替换重索引', async () => {
    const { services } = makeServices();
    const first = await services.documents.upload('员工手册.md', Buffer.from(MD_V1), 'text/markdown');
    const second = await services.documents.upload('员工手册.md', Buffer.from(MD_V1), 'text/markdown');
    expect(second.skipped).toBe(true);
    expect(second.doc.id).toBe(first.doc.id);
    expect(services.docsRepo.list().length).toBe(1);

    const third = await services.documents.upload('员工手册.md', Buffer.from(MD_V2), 'text/markdown');
    expect(third.skipped).toBe(false);
    expect(third.doc.id).toBe(first.doc.id);
    expect(services.docsRepo.list().length).toBe(1);
    expect(third.doc.chunk_count).not.toBe(first.doc.chunk_count);
    expect(third.doc.sha256).not.toBe(first.doc.sha256);
    expect(services.docsRepo.listAllChunks().length).toBe(third.doc.chunk_count);
  });

  it('删除文档后不再参与问答（分块级联清除）', async () => {
    const { services } = makeServices();
    const { doc } = await services.documents.upload('员工手册.md', Buffer.from(MD_V1), 'text/markdown');
    services.documents.remove(doc.id);
    expect(services.docsRepo.list()).toHaveLength(0);
    expect(services.docsRepo.listAllChunks()).toHaveLength(0);
  });

  it('HTTP：文档列表 / 员工接口 / 状态接口可用', async () => {
    const { services, app } = makeServices();
    await services.documents.upload('员工手册.md', Buffer.from(MD_V1), 'text/markdown');

    const list = await app.inject({ method: 'GET', url: '/api/documents' });
    expect(list.statusCode).toBe(200);
    expect(list.json().documents).toHaveLength(1);

    const emp = await app.inject({ method: 'GET', url: '/api/employee/001' });
    expect(emp.statusCode).toBe(200);
    expect(emp.json().name).toBe('张三');

    const status = await app.inject({ method: 'GET', url: '/api/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().bot.status).toBe('disabled');
  });
});

describe('对话链路（服务层）', () => {
  it('runWebChat 用 Mock LLM 走通并落库（含工具记录）', async () => {
    const { services, db } = makeServices();
    await services.documents.upload('员工手册.md', Buffer.from(MD_V1), 'text/markdown');
    const result = await services.chat.runWebChat({
      conversationId: 'conv-1',
      question: '年假有几天？',
    });
    expect(result.content).toContain('年假');

    const convs = services.convRepo.listConversations();
    expect(convs).toHaveLength(1);
    const messages = services.convRepo.listMessages(convs[0]!.id);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1]!.status).toBe('ok');
    expect(messages[1]!.tokens_out).toBeGreaterThan(0);
  });
});
