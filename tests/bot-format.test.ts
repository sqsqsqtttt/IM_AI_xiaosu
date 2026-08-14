import { describe, expect, it } from 'vitest';
import { stripMarkdownForIM } from '@xiaosu/bot';

describe('IM 文案去 Markdown 化', () => {
  it('去掉加粗与斜体星号', () => {
    expect(stripMarkdownForIM('上周三销售额为 **2,535.73 元**。')).toBe(
      '上周三销售额为 2,535.73 元。',
    );
    expect(stripMarkdownForIM('详见 *第2章* 的规定')).toBe('详见 第2章 的规定');
  });

  it('去掉标题井号与无序列表符号', () => {
    expect(stripMarkdownForIM('# 来源\n- 员工手册.md\n- FAQ.md')).toBe(
      '来源\n· 员工手册.md\n· FAQ.md',
    );
  });

  it('去掉行内代码反引号', () => {
    expect(stripMarkdownForIM('接口为 `POST /api/orders`')).toBe('接口为 POST /api/orders');
  });

  it('引用区块整体干净（模拟真实回复）', () => {
    const reply = '入职满 1 年每年 **5 天**带薪年假。[C1][C2]\n\n📚 **来源**\n- 员工手册.md · 2.1 年假';
    const clean = stripMarkdownForIM(reply);
    expect(clean).not.toContain('*');
    expect(clean).not.toContain('[C');
    expect(clean).toContain('5 天');
    expect(clean).toContain('📚 来源');
  });
});
