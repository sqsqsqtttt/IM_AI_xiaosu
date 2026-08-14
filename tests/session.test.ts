import { describe, expect, it } from 'vitest';
import { createConversationsRepo, openDb } from '@xiaosu/db';

describe('IM 会话隔离（验收 7.3：A 问的话不能被 B 接着）', () => {
  it('不同用户/不同会话的上下文互不可见', () => {
    const db = openDb(':memory:');
    const repo = createConversationsRepo(db);

    // 用户 A 在群 G1 问员工 001
    const a = repo.upsert('dingtalk', 'user-A', 'group-1');
    repo.addMessage({ conversation_id: a.id, role: 'user', content: '员工 001 是哪个部门的？', status: 'ok' });
    repo.addMessage({ conversation_id: a.id, role: 'assistant', content: '研发部', status: 'ok' });

    // 用户 B 在同一群 G1 发言：不得看到 A 的历史
    const b = repo.upsert('dingtalk', 'user-B', 'group-1');
    expect(b.id).not.toBe(a.id);
    expect(repo.history(b.id)).toHaveLength(0);

    // 用户 A 换到另一个群 G2：同样隔离
    const a2 = repo.upsert('dingtalk', 'user-A', 'group-2');
    expect(a2.id).not.toBe(a.id);
    expect(repo.history(a2.id)).toHaveLength(0);

    // A 回到 G1：历史还在
    const aBack = repo.upsert('dingtalk', 'user-A', 'group-1');
    expect(aBack.id).toBe(a.id);
    expect(repo.history(aBack.id)).toHaveLength(2);
  });

  it('历史按时间正序且限长', () => {
    const db = openDb(':memory:');
    const repo = createConversationsRepo(db);
    const c = repo.upsert('web', 'u', 'c1');
    for (let i = 0; i < 20; i++) {
      repo.addMessage({ conversation_id: c.id, role: i % 2 ? 'assistant' : 'user', content: `m${i}`, status: 'ok' });
    }
    const hist = repo.history(c.id, 6);
    expect(hist).toHaveLength(6);
    expect(hist[0]!.content).toBe('m14');
    expect(hist[5]!.content).toBe('m19');
  });
});
