/**
 * AssistantMarkdown — 对话与智能体回复的 Markdown、LaTeX 公式与代码块渲染。
 *
 * CALLING SPEC:
 *   <AssistantMarkdown value={message.content} />
 *
 * TOOL CONTRACT:
 *   - 输入：模型返回的 Markdown 文本（含数学公式、代码块、任务/Wiki 链接等）
 *   - 输出：经 KaTeX 渲染公式与代码块复制头部的 HTML，由 DOMPurify 安全清洗
 *   - 语言切换后按当前语言重新渲染
 *   - 代码块右上角浮动复制按钮，点击即复制并提供即时状态反馈
 *   - 去除代码块纵向硬限制，避免自动滚动到顶部
 */

import React, { useMemo, useRef, useEffect } from 'react';
import { sanitizeRichHtml } from '../richContent/sanitize';
import { useRichContent } from '../richContent/useRichContent';
import { currentLocale } from '../../i18n/core';
import { tr, useLocale } from '../../i18n';
import { wikiIdFromLink } from '../wiki/wikiLinks';
import { taskIdFromLink } from '../../utils/taskLinks';
import { createAiMarkdownParser } from './aiMarkdown';

export const AssistantMarkdown: React.FC<{ value: string; className?: string }> = ({
  value,
  className = '',
}) => {
  useLocale();
  const containerRef = useRef<HTMLElement>(null);

  const rendered = useMemo(() => {
    const parser = createAiMarkdownParser(tr('ai:message.copy'));
    const rawHtml = parser.parse(value || '') as string;

    const fragment = document.createElement('template');
    fragment.innerHTML = sanitizeRichHtml(rawHtml);

    fragment.content.querySelectorAll('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href') || '';
      if (taskIdFromLink(href)) {
        anchor.classList.add('task-reference');
        anchor.setAttribute('title', tr('ai:business.openTask'));
      } else if (wikiIdFromLink(href)) {
        anchor.setAttribute('title', tr('ai:business.openWiki'));
        anchor.classList.add('wiki-reference');
      } else {
        anchor.setAttribute('rel', 'noreferrer noopener');
        anchor.setAttribute('target', '_blank');
      }
    });

    const host = document.createElement('div');
    host.append(fragment.content);
    return host.innerHTML;
  }, [value, currentLocale()]);
  useRichContent(containerRef, rendered);

  // 事件委托：处理代码块右上角复制功能
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const handleContainerClick = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const copyBtn = target?.closest<HTMLButtonElement>('.ai-code-copy-btn');
      if (!copyBtn || !root.contains(copyBtn)) return;

      event.preventDefault();
      event.stopPropagation();

      const block = copyBtn.closest<HTMLElement>('.ai-code-block');
      const codeEl = block?.querySelector<HTMLElement>('code');
      const codeText = codeEl ? codeEl.textContent || '' : block?.innerText || '';

      if (!codeText) return;

      try {
        await navigator.clipboard.writeText(codeText);
        const originalHtml = copyBtn.innerHTML;
        const copiedLabel = tr('ai:message.copied');
        copyBtn.innerHTML = `
          <svg class="h-3.5 w-3.5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span class="copy-label text-success font-medium">${copiedLabel}</span>
        `;
        copyBtn.classList.add('is-copied');

        setTimeout(() => {
          if (copyBtn && document.body.contains(copyBtn)) {
            copyBtn.innerHTML = originalHtml;
            copyBtn.classList.remove('is-copied');
          }
        }, 2000);
      } catch (err) {
        console.error('Failed to copy code to clipboard', err);
      }
    };

    root.addEventListener('click', handleContainerClick);
    return () => {
      root.removeEventListener('click', handleContainerClick);
    };
  }, []);

  return (
    <article
      ref={containerRef}
      className={`markdown-body rich-content break-words select-text text-xs leading-6 text-main [&_img]:max-h-96 [&_img]:rounded-xl [&_img]:border [&_img]:border-edge [&_img]:shadow-soft [&_img]:my-2.5 [&_img]:cursor-pointer [&_img]:select-auto [&_blockquote]:border-l-2 [&_blockquote]:border-subtle [&_blockquote]:pl-3 [&_blockquote]:text-sub [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-card [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-xs [&_h2]:font-bold [&_h3]:mb-1.5 [&_h3]:text-xs [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-subtle [&_li]:ml-4 [&_ol]:mb-2 [&_ol]:list-decimal [&_p]:mb-2 [&_p]:last:mb-0 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-subtle [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-subtle [&_th]:bg-card [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:mb-2 [&_ul]:list-disc ${className}`}
    />
  );
};
