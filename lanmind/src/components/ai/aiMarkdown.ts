/**
 * aiMarkdown — 对话与智能体回复 Markdown、LaTeX 数学公式与代码块渲染器。
 *
 * CALLING SPEC:
 *   const html = parseAiMarkdown(markdownText, currentLang);
 *
 * TOOL CONTRACT:
 *   - 输入：模型原始 Markdown 文本，包含 LaTeX 数学公式（$$...$$, \\[...\\], $...$, \\(...\\)）及多语言代码块
 *   - 输出：解析为包含 KaTeX 渲染公式与带语言标识及复制按钮代码块的 HTML
 *   - 确定性逻辑，纯函数，无全局副作用
 */

import type { Tokens } from 'marked';
import { createRichMarkdownParser, escapeHtml, richCodeBlock } from '../richContent/richMarkdown';
import { highlightCode } from '../richContent/codeHighlight';

export function preprocessLatex(markdown: string): string { return markdown || ''; }

export function createAiMarkdownParser(copyLabel = '复制') {
  const parser = createRichMarkdownParser();

  parser.use({
    // 自定义代码块渲染器：增加头部语言标识栏与右上角复制按钮
    renderer: {
      code(token: Tokens.Code) {
        const rich = richCodeBlock(token);
        if (rich !== undefined) return rich;
        const { text, lang } = token;
        const cleanLang = (lang || '').trim().split(/\s+/)[0] || '';
        const displayLang = cleanLang ? cleanLang.toUpperCase() : 'CODE';
        const escaped = highlightCode(text || '', cleanLang);

        return (
          `<div class="ai-code-block relative group my-3 rounded-xl border border-edge/80 bg-surface/90 overflow-hidden shadow-xs">` +
            `<div class="ai-code-header flex items-center justify-between border-b border-edge/60 bg-canvas/40 px-3.5 py-1.5 text-[11px] font-mono text-quiet select-none">` +
              `<span class="ai-code-lang font-semibold tracking-wider text-sub text-[10px]">${escapeHtml(displayLang)}</span>` +
              `<button type="button" class="ai-code-copy-btn flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-sub hover:bg-hover hover:text-main transition-colors select-none cursor-pointer" title="${escapeHtml(copyLabel)}">` +
                `<svg class="h-3.5 w-3.5 copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
                  `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>` +
                  `<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>` +
                `</svg>` +
                `<span class="copy-label">${escapeHtml(copyLabel)}</span>` +
              `</button>` +
            `</div>` +
            `<pre class="p-3.5 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-main whitespace-pre bg-transparent border-0 m-0"><code class="${cleanLang ? `language-${escapeHtml(cleanLang)}` : ''}">${escaped}</code></pre>` +
          `</div>\n`
        );
      },
    },
  });

  return parser;
}
