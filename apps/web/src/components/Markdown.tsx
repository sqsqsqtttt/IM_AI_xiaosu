import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

/**
 * 渲染 Markdown：
 * - 引用编号 [C#] 转为醒目的蓝色上标徽章（先转义全文防注入，再注入自己的 sup 标签）；
 * - 引用块（> 原文）由 CSS 渲染为高亮摘录样式。
 */
export default function Markdown({ content }: { content: string }) {
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const withBadges = escaped.replace(/\[C(\d+)\]/g, '<sup class="cite-ref">C$1</sup>');
  return (
    <div className="md-body text-[14.5px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {withBadges}
      </ReactMarkdown>
    </div>
  );
}
