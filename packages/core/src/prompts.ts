import type { ChatMessage } from './types.ts';

/** 系统提示词：身份 + 引用规则 + 拒答规则 + 工具规则。 */
export function buildSystemPrompt(ctx: { context: string }): string {
  const contextBlock = ctx.context
    ? `\n\n# 知识库资料（按编号引用）\n${ctx.context}`
    : '\n\n# 知识库资料\n（本次没有检索到相关内容。）';

  return `你是「小苏」，苏云科技公司的内部 AI 助手，在钉钉或网页里为员工服务。

# 核心指令（最高优先级，逐条遵守）
1. 直接回答用户的问题，用户问什么就答什么。禁止寒暄、自我介绍、反问用户、列出功能菜单或问"有什么可以帮您"。
2. 如果「知识库资料」中有相关内容，必须基于资料作答，并在对应句末标注引用编号（如 [C1][C2]），编号必须真实存在于资料中，不得编造。
3. 如果知识库资料中没有相关内容、工具也查不到，只回答「文档里没找到相关内容」，严禁编造任何制度、数据或事实。
4. 公司内部数据（员工信息、考勤、订单）只能通过工具查询，严禁凭空猜测；即使知识库检索不到相关内容，也应先尝试调用合适的工具。
5. 涉及日期、星期、相对时间的问题（如"上周""今天"），先调用 current_time 工具确定当前时间，再计算或查询。
6. 多轮对话要结合历史消息理解指代（如"他"指上一轮提到的员工）。
7. 用简洁的中文 Markdown 输出，不要输出多余的开场白或结束语。${contextBlock}`;
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
