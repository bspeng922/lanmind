/**
 * 知识库页面的 Markdown 渲染与本地资产解析。
 *
 * 调用约定：接收 Markdown 原文，渲染为已净化 HTML。
 * - 自动异步解析引用自本地存储的图片及附件（"assets/..."），赋予可预览及下载的 ObjectURL；
 * - 保持对既有 data:image Base64 图片及外部超链接的向下兼容；
 * - 链接统一补 `rel="noreferrer noopener"`，避免在桌面端被本地页面接管。
 */

import React, { useMemo, useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { renderWikiMarkdown } from './wikiMarkdown';
import { useRichContent } from '../richContent/useRichContent';
import { Copy, Check } from 'lucide-react';
import { currentLocale, tr, useLocale } from '../../i18n';
import { hydrateWikiAssets } from './wikiAssetHelper';

export const WikiPagePreview: React.FC<{ content: string; className?: string }> = ({ content, className = '' }) => {
  useLocale();
  const containerRef = useRef<HTMLElement | null>(null);
  const [floatingCopy, setFloatingCopy] = useState<{
    visible: boolean;
    x: number;
    y: number;
    text: string;
    copied: boolean;
  } | null>(null);

  const rendered = useMemo(() => {
    try {
      return renderWikiMarkdown(content);
    } catch {
      // 解析失败时退回纯文本，避免整页白屏。
      return DOMPurify.sanitize(`<p>${content.replace(/[<>&]/g, '')}</p>`);
    }
  }, [content, currentLocale()]);
  // Keep React from replacing hydrated images/download links on unrelated parent updates.
  useRichContent(containerRef, rendered);

  // 动态解析并绑定本地 assets/... 资源的 ObjectURL，并为代码块挂载一键复制按钮
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    void hydrateWikiAssets(root);

    // 为代码块挂载右上角复制按钮
    const preElements = root.querySelectorAll<HTMLPreElement>('pre');
    preElements.forEach((pre) => {
      if (pre.closest('.rich-diagram') || pre.querySelector('.wiki-code-copy-btn')) return;
      pre.classList.add('group', 'relative');
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className =
        'wiki-code-copy-btn absolute right-2.5 top-2.5 flex items-center gap-1 rounded-md border border-edge bg-surface/90 px-2 py-1 text-[11px] text-sub shadow-sm backdrop-blur-xs opacity-0 transition-opacity group-hover:opacity-100 hover:text-main hover:bg-hover select-none cursor-pointer';
      copyBtn.setAttribute('title', tr('wiki:wikiEditor.copyCode'));
      copyBtn.innerHTML = `
        <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
        </svg>
        <span class="copy-label">${tr('wiki:wikiEditor.copyCode')}</span>
      `;

      copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const codeEl = pre.querySelector('code');
        const codeText = codeEl ? codeEl.textContent || '' : pre.innerText;
        try {
          await navigator.clipboard.writeText(codeText);
          copyBtn.innerHTML = `
            <svg class="h-3.5 w-3.5 text-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span class="copy-label text-success font-medium">${tr('wiki:wikiEditor.copied')}</span>
          `;
          setTimeout(() => {
            copyBtn.innerHTML = `
              <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
              </svg>
              <span class="copy-label">${tr('wiki:wikiEditor.copyCode')}</span>
            `;
          }, 1800);
        } catch (err) {
          console.warn('Failed to copy code to clipboard:', err);
        }
      });

      pre.appendChild(copyBtn);
    });

  }, [rendered]);

  // 选中文本时浮现快捷复制胶囊
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const handleMouseUp = () => {
      const selection = window.getSelection();
      const text = selection?.toString() || '';
      if (!text.trim() || !selection || selection.rangeCount === 0) {
        setFloatingCopy(null);
        return;
      }
      const range = selection.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) {
        setFloatingCopy(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      setFloatingCopy({
        visible: true,
        x: rect.left - rootRect.left + rect.width / 2,
        y: Math.max(0, rect.top - rootRect.top - 36),
        text: text,
        copied: false,
      });
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.wiki-floating-copy-pill')) return;
      setFloatingCopy(null);
    };

    root.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      root.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  return (
    <div className="relative">
      <article
        ref={containerRef}
        className={`markdown-body rich-content select-text cursor-auto max-w-none break-words text-sm leading-relaxed text-main [&_a]:text-info [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-accent [&_blockquote]:bg-accent/5 [&_blockquote]:py-1.5 [&_blockquote]:pl-4 [&_blockquote]:pr-3 [&_blockquote]:rounded-r-lg [&_blockquote]:text-sub [&_code]:rounded-md [&_code]:bg-card [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:mb-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-main [&_h1]:border-b [&_h1]:border-edge/60 [&_h1]:pb-2 [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-main [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-main [&_hr]:my-6 [&_hr]:border-edge/60 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-canvas/90 [&_pre]:px-3.5 [&_pre]:py-2.5 [&_pre]:my-2.5 [&_pre]:border [&_pre]:border-edge/60 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-edge/60 [&_td]:px-3 [&_td]:py-1.5 [&_th]:border [&_th]:border-edge/60 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:bg-canvas/60 [&_ul]:list-disc ${className}`}
      />
      {floatingCopy && floatingCopy.visible && (
        <div
          style={{ top: `${floatingCopy.y}px`, left: `${floatingCopy.x}px` }}
          className="wiki-floating-copy-pill absolute z-30 -translate-x-1/2 flex items-center rounded-lg border border-edge bg-surface/95 px-2.5 py-1 shadow-popover backdrop-blur-md select-none animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              e.preventDefault();
              try {
                await navigator.clipboard.writeText(floatingCopy.text);
                setFloatingCopy((prev) => (prev ? { ...prev, copied: true } : null));
                setTimeout(() => setFloatingCopy(null), 1500);
              } catch (err) {
                console.warn('Failed to copy text selection:', err);
              }
            }}
            className="flex items-center gap-1.5 text-xs text-main hover:text-accent transition-colors cursor-pointer"
          >
            {floatingCopy.copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-success" />
                <span className="text-success font-medium">{tr('wiki:wikiEditor.copied')}</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-sub" />
                <span>{tr('wiki:wikiEditor.copySelection')}</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
