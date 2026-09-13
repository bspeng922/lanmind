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
      color: 'text-sky-400',
      border: 'border-sky-500/40',
      bg: 'bg-sky-500/10',
      icon: 'ℹ️',
    },
    TIP: {
      label: 'TIP',
      color: 'text-emerald-400',
      border: 'border-emerald-500/40',
      bg: 'bg-emerald-500/10',
      icon: '💡',
    },
    IMPORTANT: {
      label: 'IMPORTANT',
      color: 'text-purple-400',
      border: 'border-purple-500/40',
      bg: 'bg-purple-500/10',
      icon: '📌',
    },
    WARNING: {
      label: 'WARNING',
      color: 'text-amber-400',
      border: 'border-amber-500/40',
      bg: 'bg-amber-500/10',
      icon: '⚠️',
    },
    CAUTION: {
      label: 'CAUTION',
      color: 'text-rose-400',
      border: 'border-rose-500/40',
      bg: 'bg-rose-500/10',
      icon: '🛑',
    },
  };

  return rawHtml.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]([\s\S]*?)<\/blockquote>/gi,
    (_, type: string, rest: string) => {
      const config = alertTypes[type.toUpperCase()] || alertTypes.NOTE;
      return `<div class="my-4 rounded-xl border ${config.border} ${config.bg} p-3.5 text-xs text-slate-200">
        <div class="mb-1 flex items-center gap-1.5 font-bold ${config.color}">
          <span>${config.icon}</span>
          <span>${config.label}</span>
        </div>
        <div class="leading-relaxed text-slate-300 [&>p]:my-1">${rest}</div>
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
          ? 'text-lg font-bold border-b border-slate-800 pb-2 mt-6 mb-3 text-slate-100'
          : depth === 2
          ? 'text-base font-bold border-b border-slate-800/60 pb-1.5 mt-5 mb-2 text-slate-100'
          : 'text-sm font-semibold mt-4 mb-2 text-slate-200';

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

      return `<div class="my-4 overflow-hidden rounded-xl border border-slate-800 bg-[#090d16] shadow-md">
        <div class="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/90 px-3.5 py-1.5 text-[11px] font-mono text-slate-400">
          <span class="font-bold text-sky-400 tracking-wider">${langLabel}</span>
          <button data-copy-code="${codeId}" class="markdown-copy-btn flex items-center gap-1 hover:text-slate-200 transition-colors">
            <span>复制</span>
          </button>
        </div>
        <pre class="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-slate-200 scrollbar-thin"><code id="${codeId}" class="language-${language}">${highlighted}</code></pre>
      </div>`;
    };

    // Tables styling
    renderer.table = ({ header, rows }) => {
      return `<div class="my-4 overflow-x-auto rounded-xl border border-slate-800 shadow-sm">
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
          btn.innerHTML = '<span class="text-emerald-400">✓ 已复制</span>';
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
    <div className="flex h-full flex-col bg-[#0b1324] text-slate-200">
      {/* Top Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800 bg-[#0e172a] px-4 py-2.5 text-xs">
        {/* Left: View Mode Toggle */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-all ${
              viewMode === 'preview'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            <span>富文本排版</span>
          </button>

          <button
            onClick={() => setViewMode('source')}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-medium transition-all ${
              viewMode === 'source'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
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
                  ? 'bg-slate-800 text-sky-400 border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200'
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
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-700 hover:text-white transition-colors"
          >
            {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copiedAll ? '已复制全文' : '复制全文'}</span>
          </button>
        </div>
      </div>

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Content View */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 bg-[#080d19]">
          {viewMode === 'preview' ? (
            <div
              ref={containerRef}
              className="mx-auto max-w-4xl rounded-2xl border border-slate-800/80 bg-slate-900/90 p-8 shadow-2xl backdrop-blur-sm"
            >
              <article
                className="markdown-body prose prose-invert max-w-none text-xs leading-relaxed text-slate-300 font-sans space-y-4 [&_p]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:border-l-4 [&_blockquote]:border-sky-500/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-400 [&_hr]:my-6 [&_hr]:border-slate-800 [&_code]:rounded [&_code]:bg-slate-800/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sky-300 [&_table_th]:border [&_table_th]:border-slate-700 [&_table_th]:bg-slate-800 [&_table_th]:p-2.5 [&_table_td]:border [&_table_td]:border-slate-700/80 [&_table_td]:p-2.5"
                dangerouslySetInnerHTML={{ __html: htmlContent }}
              />
            </div>
          ) : (
            <div className="mx-auto max-w-4xl rounded-2xl border border-slate-800/80 bg-slate-900/90 p-6 shadow-2xl">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-slate-200 select-text">
                {content}
              </pre>
            </div>
          )}
        </div>

        {/* Outline / Table of Contents (TOC) Drawer on Right */}
        {viewMode === 'preview' && showToc && tocList.length > 0 && (
          <aside className="w-64 border-l border-slate-800 bg-[#0c1424] p-4 overflow-y-auto hidden lg:block flex-shrink-0">
            <div className="flex items-center gap-1.5 pb-2 mb-3 border-b border-slate-800 text-xs font-bold text-slate-100 font-mono">
              <List className="h-4 w-4 text-sky-400" />
              <span>文档大纲</span>
            </div>
            <nav className="space-y-1 text-xs">
              {tocList.map((item) => (
                <button
                  key={item.id}
                  onClick={() => scrollToHeading(item.id)}
                  className={`w-full text-left truncate rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-800 hover:text-sky-300 font-mono ${
                    item.level === 1
                      ? 'font-bold text-slate-200'
                      : item.level === 2
                      ? 'pl-4 text-slate-300'
                      : 'pl-6 text-slate-400 text-[11px]'
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
