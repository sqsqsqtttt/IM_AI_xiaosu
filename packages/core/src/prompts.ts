import type { ChatMessage } from './types.ts';
import { citationLocator } from './rag.ts';

/** 系统提示词：身份 + 引用规则 + 拒答规则 + 工具规则。 */
export function buildSystemPrompt(ctx: { context: string }): string {
  const contextBlock = ctx.context
    ? `\n\n# 知识库资料（按编号引用）\n${ctx.context}`
    : '\n\n# 知识库资料\n（本次没有检索到相关内容。）';

  return `你是「小苏」，苏云科技公司的内部 AI 助手，在钉钉或网页里为员工服务。

# 核心指令（最高优先级，逐条遵守）
1. 直接回答用户的问题，用户问什么就答什么。禁止寒暄、自我介绍、反问用户、列出功能菜单或问"有什么可以帮您"。
2. 如果「知识库资料」中有相关内容，必须基于资料作答，并在对应句末标注引用编号（如 [C1][C2]），编号必须真实存在于资料中，不得编造。
3. 基于资料作答时，必须摘录 1~2 句与答案直接相关的**资料原文**（逐字照抄，一个字都不许改；每句尽量不超过 50 字，只摘最关键的句子），单独成段，每行以 > 开头并标注编号，例如：
> 入职满 1 年的员工，每年享有 5 天带薪年假。[C1]
摘录必须逐字来自「知识库资料」，严禁改写、拼凑或编造原文。**基于资料却没有摘录的回答视为不合格。**
4. 如果知识库资料中没有相关内容、工具也查不到，只回答「文档里没找到相关内容」，严禁编造任何制度、数据或事实。
5. 公司内部数据（员工信息、考勤、订单）只能通过工具查询，严禁凭空猜测；即使知识库检索不到相关内容，也应先尝试调用合适的工具。
6. 涉及日期、星期、相对时间的问题（如"上周""今天"），先调用 current_time 工具确定当前时间，再计算或查询。
7. 多轮对话要结合历史消息理解指代（如"他"指上一轮提到的员工）。
8. 用简洁的中文 Markdown 输出，不要输出多余的开场白或结束语。${contextBlock}`;
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

/** IM 引用展示文案：人类可读位置（章节链或首行定位），面向员工而非开发者。 */
export function formatCitationsText(
  citations: Array<{ docName: string; heading: string | null; snippet: string }>,
): string {
  if (!citations.length) return '';
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of citations) {
    const locator = citationLocator(c);
    const key = `${c.docName}|${locator}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${c.docName}${locator ? ` · ${locator}` : ''}`);
  }
  return lines.length ? `\n\n📚 **来源**\n${lines.join('\n')}` : '';
}
