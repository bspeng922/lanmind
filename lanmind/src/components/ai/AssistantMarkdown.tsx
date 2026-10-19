/**
 * AssistantMarkdown — 对话回复的 Markdown 渲染。
 *
 * CALLING SPEC:
 *   <AssistantMarkdown value={message.content} />
 *
 * TOOL CONTRACT:
 *   - 输入：模型返回的 Markdown 文本
 *   - 输出：经 DOMPurify 清洗的 HTML，样式沿用 .markdown-body 约定
 *   - 语言切换后按当前语言重新渲染，便于本地化链接标题
 *   - 无副作用；不注入脚本，不允许 data: 以外的图片协议
 */

import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { currentLocale } from '../../i18n/core';
import { tr, useLocale } from '../../i18n';
import { wikiIdFromLink } from '../wiki/wikiLinks';
import { taskIdFromLink } from '../../utils/taskLinks';

export const AssistantMarkdown: React.FC<{ value: string; className?: string }> = ({
  value,
  className = '',
}) => {
  useLocale();
  const rendered = useMemo(() => {
    const fragment = DOMPurify.sanitize(marked.parse(value || '', { gfm: true, breaks: true }) as string, {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|lanmind|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    });
    fragment.querySelectorAll('a[href]').forEach((anchor) => {
      if (taskIdFromLink(anchor.getAttribute('href') || '')) {
        anchor.classList.add('task-reference');
        anchor.setAttribute('title', tr('ai:business.openTask'));
      } else if (wikiIdFromLink(anchor.getAttribute('href') || '')) {
        anchor.setAttribute('title', tr('ai:business.openWiki'));
        anchor.classList.add('wiki-reference');
      } else {
        anchor.setAttribute('rel', 'noreferrer noopener');
        anchor.setAttribute('target', '_blank');
      }
    });
    const host = document.createElement('div');
    host.append(fragment);
    return host.innerHTML;
  }, [value, currentLocale()]);

  return (
    <article
      className={`markdown-body break-words select-text text-xs leading-6 text-main [&_img]:max-h-96 [&_img]:rounded-xl [&_img]:border [&_img]:border-edge [&_img]:shadow-soft [&_img]:my-2.5 [&_img]:cursor-pointer [&_img]:select-auto [&_blockquote]:border-l-2 [&_blockquote]:border-subtle [&_blockquote]:pl-3 [&_blockquote]:text-sub [&_code]:rounded [&_code]:bg-card [&_code]:px-1 [&_code]:py-0.5 [&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-xs [&_h2]:font-bold [&_h3]:mb-1.5 [&_h3]:text-xs [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-subtle [&_li]:ml-4 [&_ol]:mb-2 [&_ol]:list-decimal [&_p]:mb-2 [&_p]:last:mb-0 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-card [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-subtle [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-subtle [&_th]:bg-card [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:mb-2 [&_ul]:list-disc ${className}`}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
};
