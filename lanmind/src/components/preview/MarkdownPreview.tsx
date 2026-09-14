/**
 * MarkdownPreview — Rich Markdown (.md) document preview component with
 * Prism syntax highlighting, code copy buttons, Table of Contents (TOC)
 * outline navigation, and Source vs Rendered view mode toggle.
 *
 * CALLING SPEC:
 *   <MarkdownPreview
 *     content={markdownString}
 *     fileName={fileName}
 *   />
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import {
  List,
  Eye,
  Code,
  Copy,
  Check,
  ChevronRight,
  BookOpen,
  AlignLeft,
  Search,
  Hash,
} from 'lucide-react';

interface Props {
  content: string;
  fileName: string;
}

interface TocItem {
  id: string;
  text: string;
  level: number;
}

// Convert GitHub Alert blockquotes into styled HTML blocks
function processGitHubAlerts(rawHtml: string): string {
  const alertTypes: Record<string, { label: string; color: string; border: string; bg: string; icon: string }> = {
    NOTE: {
      label: 'NOTE',
      color: 'text-info',
      border: 'border-sky-500/40',
      bg: 'bg-sky-500/10',
      icon: 'ℹ️',
    },
    TIP: {
      label: 'TIP',
      color: 'text-success',
      border: 'border-emerald-500/40',
      bg: 'bg-emerald-500/10',
      icon: '💡',
    },
    IMPORTANT: {
      label: 'IMPORTANT',
      color: 'text-feature',
      border: 'border-purple-500/40',
      bg: 'bg-purple-500/10',
      icon: '📌',
    },
    WARNING: {
      label: 'WARNING',
      color: 'text-warning',
      border: 'border-amber-500/40',
      bg: 'bg-amber-500/10',
      icon: '⚠️',
    },
    CAUTION: {
      label: 'CAUTION',
      color: 'text-danger',
      border: 'border-rose-500/40',
      bg: 'bg-rose-500/10',
      icon: '🛑',
    },
  };

  return rawHtml.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]([\s\S]*?)<\/blockquote>/gi,
    (_, type: string, rest: string) => {
      const config = alertTypes[type.toUpperCase()] || alertTypes.NOTE;
      return `<div class="my-4 rounded-xl border ${config.border} ${config.bg} p-3.5 text-xs text-main">
        <div class="mb-1 flex items-center gap-1.5 font-bold ${config.color}">
          <span>${config.icon}</span>
          <span>${config.label}</span>
        </div>
        <div class="leading-relaxed text-sub [&>p]:my-1">${rest}</div>
      </div>`;
    }
  );
}

export const MarkdownPreview: React.FC<Props> = ({ content, fileName }) => {
  const [viewMode, setViewMode] = useState<'preview' | 'source'>('preview');
  const [showToc, setShowToc] = useState<boolean>(true);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Extract headings for Table of Contents
  const tocList = useMemo<TocItem[]>(() => {
    const lines = content.split('\n');
    const items: TocItem[] = [];
    lines.forEach((line, idx) => {
      const match = line.match(/^(#{1,3})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim().replace(/[*_`#]/g, '');
        const id = `heading-${idx}-${text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-')}`;
        items.push({ id, text, level });
      }
    });
    return items;
  }, [content]);

  // Render Markdown with marked + Prism highlighting
  const htmlContent = useMemo(() => {
    let headingIdx = 0;
    const renderer = new marked.Renderer();

    // Custom heading renderer to add IDs for TOC navigation
    renderer.heading = ({ text, depth }) => {
      const cleanText = text.replace(/[*_`#]/g, '');
      const id = `heading-${headingIdx++}-${cleanText.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-')}`;
      const sizeClass =
        depth === 1
          ? 'text-lg font-bold border-b border-edge pb-2 mt-6 mb-3 text-main'
          : depth === 2
          ? 'text-base font-bold border-b border-edge/60 pb-1.5 mt-5 mb-2 text-main'
          : 'text-sm font-semibold mt-4 mb-2 text-main';

      return `<h${depth} id="${id}" class="${sizeClass} scroll-mt-6 font-mono">${text}</h${depth}>`;
    };

    // Custom code block renderer with Prism syntax highlighting and header bar
    renderer.code = ({ text, lang }) => {
      const language = (lang || 'text').toLowerCase();
      let highlighted = text;
      if (Prism.languages[language]) {
        try {
          highlighted = Prism.highlight(text, Prism.languages[language], language);
        } catch {
          highlighted = text;
        }
      }

      const codeId = `code-${Math.random().toString(36).slice(2, 9)}`;
      const langLabel = (lang || 'TEXT').toUpperCase();

      return `<div class="my-4 overflow-hidden rounded-xl border border-edge bg-canvas shadow-panel">
        <div class="flex items-center justify-between border-b border-edge/80 bg-surface/90 px-3.5 py-1.5 text-[11px] font-mono text-sub">
          <span class="font-bold text-info tracking-wider">${langLabel}</span>
          <button data-copy-code="${codeId}" class="markdown-copy-btn flex items-center gap-1 hover:text-main transition-colors">
            <span>复制</span>
          </button>
        </div>
        <pre class="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-main scrollbar-thin"><code id="${codeId}" class="language-${language}">${highlighted}</code></pre>
      </div>`;
    };

    // Tables styling
    renderer.table = ({ header, rows }) => {
      return `<div class="my-4 overflow-x-auto rounded-xl border border-edge shadow-soft">
        <table class="w-full border-collapse text-left text-xs">${header}${rows}</table>
      </div>`;
    };

    const rawParsed = marked.parse(content, { renderer, gfm: true, breaks: true }) as string;
    const alertProcessed = processGitHubAlerts(rawParsed);
    return DOMPurify.sanitize(alertProcessed);
  }, [content]);

  // Bind code block copy buttons
  useEffect(() => {
    if (!containerRef.current) return;
    const buttons = containerRef.current.querySelectorAll<HTMLButtonElement>('.markdown-copy-btn');
    const handlers: Array<() => void> = [];

    buttons.forEach((btn) => {
      const codeId = btn.getAttribute('data-copy-code');
      if (!codeId) return;
      const codeEl = containerRef.current?.querySelector(`#${codeId}`);
      if (!codeEl) return;

      const handler = () => {
        const textToCopy = codeEl.textContent || '';
        navigator.clipboard.writeText(textToCopy).then(() => {
          btn.innerHTML = '<span class="text-success">✓ 已复制</span>';
          setTimeout(() => {
            btn.innerHTML = '<span>复制</span>';
          }, 1500);
        });
      };

      btn.addEventListener('click', handler);
      handlers.push(() => btn.removeEventListener('click', handler));
    });

    return () => {
      handlers.forEach((h) => h());
    };
  }, [htmlContent, viewMode]);

  const handleCopyAll = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    });
  };

  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface text-main">
      {/* Top Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between border-b border-edge bg-surface px-4 py-2.5 text-xs">
        {/* Left: View Mode Toggle */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-all ${
              viewMode === 'preview'
                ? 'bg-sky-500/20 text-info border border-sky-500/40 shadow-soft'
                : 'text-sub hover:text-main hover:bg-hover/60'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>富文本排版</span>
          </button>

          <button
            onClick={() => setViewMode('source')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-all ${
              viewMode === 'source'
                ? 'bg-sky-500/20 text-info border border-sky-500/40 shadow-soft'
                : 'text-sub hover:text-main hover:bg-hover/60'
            }`}
          >
            <Code className="h-3.5 w-3.5" />
            <span>源码模式</span>
          </button>

          {viewMode === 'preview' && tocList.length > 0 && (
            <button
              onClick={() => setShowToc(!showToc)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                showToc
                  ? 'bg-card text-info border border-subtle'
                  : 'text-sub hover:text-main'
              }`}
              title="切换大纲目录"
            >
              <List className="h-3.5 w-3.5" />
              <span>大纲 ({tocList.length})</span>
            </button>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 text-xs text-sub hover:border-subtle hover:text-main transition-colors"
          >
            {copiedAll ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copiedAll ? '已复制全文' : '复制全文'}</span>
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Content View */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 bg-canvas">
          {viewMode === 'preview' ? (
            <div
              ref={containerRef}
              className="mx-auto max-w-4xl rounded-2xl border border-edge/80 bg-surface/90 p-8 shadow-popover backdrop-blur-sm"
            >
              <article
                className="markdown-body prose max-w-none text-xs leading-relaxed text-sub font-sans space-y-4 [&_p]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:border-l-4 [&_blockquote]:border-sky-500/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-sub [&_hr]:my-6 [&_hr]:border-edge [&_code]:rounded [&_:not(pre)>code]:bg-card/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_:not(pre)>code]:text-info [&_table_th]:border [&_table_th]:border-subtle [&_table_th]:bg-card [&_table_th]:p-2.5 [&_table_td]:border [&_table_td]:border-subtle/80 [&_table_td]:p-2.5"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            </div>
          ) : (
            <div className="mx-auto max-w-4xl rounded-2xl border border-edge/80 bg-surface/90 p-6 shadow-popover">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-main select-text">
                {content}
              </pre>
            </div>
          )}
        </div>

        {/* Outline / Table of Contents (TOC) Drawer on Right */}
        {viewMode === 'preview' && showToc && tocList.length > 0 && (
          <aside className="w-64 border-l border-edge bg-surface p-4 overflow-y-auto hidden lg:block flex-shrink-0">
            <div className="flex items-center gap-1.5 pb-2 mb-3 border-b border-edge text-xs font-bold text-main font-mono">
              <List className="h-4 w-4 text-info" />
              <span>文档大纲</span>
            </div>
            <nav className="space-y-1 text-xs">
              {tocList.map((item) => (
                <button
                  key={item.id}
                  onClick={() => scrollToHeading(item.id)}
                  className={`w-full text-left truncate rounded-lg px-2 py-1.5 transition-colors hover:bg-hover hover:text-info font-mono ${
                    item.level === 1
                      ? 'font-bold text-main'
                      : item.level === 2
                      ? 'pl-4 text-sub'
                      : 'pl-6 text-sub text-[11px]'
                  }`}
                  title={item.text}
                >
                  {item.text}
                </button>
              ))}
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
};
