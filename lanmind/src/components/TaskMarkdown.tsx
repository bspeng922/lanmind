import { currentLocale } from '../i18n/core';
import { tr, useLocale } from "../i18n";
import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { TaskAttachment } from '../types';
import { taskIdFromLink } from '../utils/taskLinks';

export const TaskMarkdown: React.FC<{ value: string; attachments?: TaskAttachment[]; className?: string }> = ({ value, attachments = [], className = '' }) => {
  useLocale();
  const rendered = useMemo(() => {
    const renderer = new marked.Renderer();
    const image = renderer.image.bind(renderer);
    renderer.image = (token) => {
      if (!token.href.startsWith('lanmind-attachment:')) return image(token);
      const file = attachments.find((item) => `lanmind-attachment:${encodeURIComponent(item.id)}` === token.href);
      return file?.dataUrl && file.type.startsWith('image/') ? image({ ...token, href: file.dataUrl }) : tr("tasks:taskMarkdown.spanImageAttachmentUnavailableSpan");
    };
    const fragment = DOMPurify.sanitize(marked.parse(value || '', { gfm: true, breaks: true, renderer }) as string, { RETURN_DOM_FRAGMENT: true, ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|lanmind):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i });
    fragment.querySelectorAll('a[href]').forEach((anchor) => {
      if (taskIdFromLink(anchor.getAttribute('href') || '')) {
        anchor.classList.add('task-reference');
        anchor.textContent = (anchor.textContent || '').replace(/^任务[：:]\s*/, '');
        anchor.setAttribute('title', tr("tasks:taskMarkdown.viewTaskDetails"));
      }
    });
    const host = document.createElement('div');
    host.append(fragment);
    return host.innerHTML;
  }, [value, attachments, currentLocale()]);
  return <article className={`markdown-body task-markdown break-words text-xs leading-6 text-sub [&_img]:max-w-full [&_img]:h-auto [&_blockquote]:border-l-2 [&_blockquote]:border-subtle [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-card [&_code]:px-1 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-bold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-card [&_pre]:p-3 [&_ul]:list-disc ${className}`} dangerouslySetInnerHTML={{ __html: rendered || tr("tasks:taskMarkdown.pClassTextQuietNoDescriptionP") }} />;
};
