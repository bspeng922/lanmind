/**
 * 知识库页面的 Markdown 渲染与本地资产解析。
 *
 * 调用约定：接收 Markdown 原文，渲染为已净化 HTML。
 * - 自动异步解析引用自本地存储的图片及附件（"assets/..."），赋予可预览及下载的 ObjectURL；
 * - 保持对既有 data:image Base64 图片及外部超链接的向下兼容；
 * - 链接统一补 `rel="noreferrer noopener"`，避免在桌面端被本地页面接管。
 */

import React, { useMemo, useEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { currentLocale } from '../../i18n';
import { getWikiAssetUrl } from './wikiAssetStore';

export const WikiPagePreview: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
  const containerRef = useRef<HTMLElement | null>(null);

  const rendered = useMemo(() => {
    try {
      const html = DOMPurify.sanitize(
        marked.parse(content || '', { gfm: true, breaks: true }) as string,
        {
          ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|lanmind|data|blob):|assets\/|\.\.?\/|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
        }
      );
      const host = document.createElement('div');
      host.innerHTML = html;
      host.querySelectorAll('a[href]').forEach((anchor) => {
        anchor.setAttribute('rel', 'noreferrer noopener');
      });
      return host.innerHTML;
    } catch {
      // 解析失败时退回纯文本，避免整页白屏。
      return DOMPurify.sanitize(`<p>${content.replace(/[<>&]/g, '')}</p>`);
    }
  }, [content, currentLocale()]);

  // 动态解析并绑定本地 assets/... 资源的 ObjectURL
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    let isSubscribed = true;

    // 解析图片
    const images = root.querySelectorAll<HTMLImageElement>('img[src]');
    images.forEach(async (img) => {
      const rawSrc = img.getAttribute('src') || '';
      if (rawSrc.includes('assets/')) {
        const assetPath = rawSrc.replace(/^[./]+/, '').replace(/^.*(assets\/[^"'#? ]+).*$/, '$1');
        const url = await getWikiAssetUrl(assetPath);
        if (url && isSubscribed) {
          img.src = url;
        }
      }
    });

    // 解析附件链接
    const links = root.querySelectorAll<HTMLAnchorElement>('a[href]');
    links.forEach(async (anchor) => {
      const rawHref = anchor.getAttribute('href') || '';
      if (rawHref.includes('assets/')) {
        const assetPath = rawHref.replace(/^[./]+/, '').replace(/^.*(assets\/[^"'#? ]+).*$/, '$1');
        const url = await getWikiAssetUrl(assetPath);
        if (url && isSubscribed) {
          anchor.href = url;
          const cleanName = anchor.textContent?.replace(/^📎\s*/, '').trim() || 'attachment';
          anchor.setAttribute('download', cleanName);
        }
      }
    });

    return () => {
      isSubscribed = false;
    };
  }, [rendered]);

  return (
    <article
      ref={containerRef}
      className={`markdown-body max-w-none break-words text-sm leading-relaxed text-main [&_a]:text-info [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-accent [&_blockquote]:bg-accent/5 [&_blockquote]:py-1.5 [&_blockquote]:pl-4 [&_blockquote]:pr-3 [&_blockquote]:rounded-r-lg [&_blockquote]:text-sub [&_code]:rounded-md [&_code]:bg-card [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-main [&_h1]:border-b [&_h1]:border-edge/60 [&_h1]:pb-2 [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-main [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-main [&_hr]:my-6 [&_hr]:border-edge/60 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-canvas/90 [&_pre]:p-4 [&_pre]:border [&_pre]:border-edge/60 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-edge/60 [&_td]:px-3 [&_td]:py-1.5 [&_th]:border [&_th]:border-edge/60 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:bg-canvas/60 [&_ul]:list-disc ${className}`}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
};
