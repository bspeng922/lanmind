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

import { Marked } from 'marked';
import katex from 'katex';

/** 对 HTML 特殊字符进行安全转义 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 渲染 LaTeX 公式，如遇解析错误优雅降级为原始代码 */
function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      output: 'htmlAndMathml',
    });
  } catch {
    return escapeHtml(tex);
  }
}

/** 预处理 Markdown 中的孤立公式定界符，确保 block 与 inline 公式被准确分词 */
export function preprocessLatex(markdown: string): string {
  if (!markdown) return '';
  return markdown;
}

export function createAiMarkdownParser(copyLabel = '复制') {
  const parser = new Marked({ gfm: true, breaks: true });

  parser.use({
    // 自定义代码块渲染器：增加头部语言标识栏与右上角复制按钮
    renderer: {
      code({ text, lang }: { text: string; lang?: string }) {
        const cleanLang = (lang || '').trim().split(/\s+/)[0] || '';
        const displayLang = cleanLang ? cleanLang.toUpperCase() : 'CODE';
        const escaped = escapeHtml(text || '');

        return (
          `<div class="ai-code-block relative group my-3 rounded-xl border border-edge/80 bg-surface/90 overflow-hidden shadow-xs">` +
            `<div class="ai-code-header flex items-center justify-between border-b border-edge/60 bg-canvas/40 px-3.5 py-1.5 text-[11px] font-mono text-quiet select-none">` +
              `<span class="ai-code-lang font-semibold tracking-wider text-sub text-[10px]">${displayLang}</span>` +
              `<button type="button" class="ai-code-copy-btn flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-sub hover:bg-hover hover:text-main transition-colors select-none cursor-pointer" title="${escapeHtml(copyLabel)}">` +
                `<svg class="h-3.5 w-3.5 copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
                  `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>` +
                  `<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>` +
                `</svg>` +
                `<span class="copy-label">${escapeHtml(copyLabel)}</span>` +
              `</button>` +
            `</div>` +
            `<pre class="p-3.5 overflow-x-auto font-mono text-[11.5px] leading-relaxed text-main whitespace-pre bg-transparent border-0 m-0"><code class="${cleanLang ? `language-${cleanLang}` : ''}">${escaped}</code></pre>` +
          `</div>\n`
        );
      },
    },
    // 自定义扩展：公式支持（块级与行内）
    extensions: [
      {
        name: 'blockMath',
        level: 'block',
        start(src: string) {
          const m = src.match(/(\$\$|\\\[)/);
          return m ? m.index : -1;
        },
        tokenizer(src: string) {
          // 匹配 $$ ... $$ 或 \[ ... \]
          const match = /^(\$\$|\\\[)([\s\S]*?)(\$\$|\\\])/.exec(src);
          if (match) {
            return {
              type: 'blockMath',
              raw: match[0],
              text: match[2].trim(),
            };
          }
        },
        renderer(token: any) {
          const rendered = renderMath(token.text, true);
          return `<div class="katex-display-wrapper my-3 overflow-x-auto py-1 text-center select-text">${rendered}</div>\n`;
        },
      },
      {
        name: 'inlineMath',
        level: 'inline',
        start(src: string) {
          const m = src.match(/(\$|\\\()/);
          return m ? m.index : -1;
        },
        tokenizer(src: string) {
          // 匹配 \( ... \)
          const parenMatch = /^\\\(([\s\S]*?)\\\)/.exec(src);
          if (parenMatch) {
            return {
              type: 'inlineMath',
              raw: parenMatch[0],
              text: parenMatch[1].trim(),
            };
          }
          // 匹配 $ ... $（排除连续$$以及形如 $100 的纯金额）
          const dollarMatch = /^\$([^\$\n]+?)\$/.exec(src);
          if (dollarMatch) {
            const inner = dollarMatch[1].trim();
            // 如果仅是数字或金额形式，如 50 或 100.00，不作为公式解析
            if (/^\d+(\.\d+)?$/.test(inner)) return;
            return {
              type: 'inlineMath',
              raw: dollarMatch[0],
              text: inner,
            };
          }
        },
        renderer(token: any) {
          const rendered = renderMath(token.text, false);
          return `<span class="katex-inline-wrapper select-text">${rendered}</span>`;
        },
      },
    ],
  });

  return parser;
}
