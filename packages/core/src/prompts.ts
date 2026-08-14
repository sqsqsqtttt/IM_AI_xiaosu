import type { ChatMessage } from './types.ts';

/** 系统提示词：身份 + 引用规则 + 拒答规则 + 工具规则。 */
export function buildSystemPrompt(ctx: { context: string }): string {
  const contextBlock = ctx.context
    ? `\n\n# 知识库资料（按编号引用）\n${ctx.context}`
    : '\n\n# 知识库资料\n（本次没有检索到相关内容。）';

  return `你是「小苏」，苏云科技公司的内部 AI 助手，通过钉钉或网页为员工服务。

## 回答规则
1. 回答必须基于上面「知识库资料」或工具查询结果；引用资料时在句末标注编号，如 [C1][C2]，编号必须与资料编号一致，不得编造不存在的编号。
2. 如果知识库中没有相关内容，且工具也查不到，就直接回答「文档里没找到相关内容」，严禁编造任何公司制度、数据或事实。
3. 公司内部数据（员工信息、考勤、订单）只能通过工具查询，严禁凭空猜测。
4. 涉及日期、星期、时间点的问题（如"上周""今天"），先调用 current_time 工具确定当前时间再计算。
5. 多轮对话要结合历史消息理解指代（如"他"指上一轮提到的员工）。
6. 输出使用简洁的 Markdown，中文回答，不要输出多余的开场白。

## 工具调用规则
- 问题涉及员工信息 → employee_info；考勤/出勤 → attendance_query；订单/销售 → orders_query；计算 → calculator；当前时间 → current_time。
- 能直接用知识库回答的问题不要调用工具。${contextBlock}`;
}

/** 会话历史 → LLM 消息（限长防爆上下文）。 */
export function historyToMessages(history: Array<{ role: string; content: string }>, maxTurns = 8): ChatMessage[] {
  const recent = history.slice(-maxTurns * 2);
  const out: ChatMessage[] = [];
  let chars = 0;
  // 从后往前裁剪，控制总长度在 ~6000 字内
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i]!;
    if (chars + m.content.length > 6000) break;
    chars += m.content.length;
    out.unshift({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  return out;
}

/** IM 引用展示文案。 */
export function formatCitationsText(citations: Array<{ docName: string; heading: string | null }>): string {
  if (!citations.length) return '';
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of citations) {
    const key = `${c.docName}|${c.heading ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${c.docName}${c.heading ? ` · ${c.heading}` : ''}`);
  }
  return lines.length ? `\n\n📚 **来源**\n${lines.join('\n')}` : '';
}
