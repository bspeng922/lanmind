import { Marked, type MarkedExtension, type Tokens } from 'marked';
import katex from 'katex';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const diagramLanguages = new Set([
  'chart', 'chartjs', 'echarts', 'flowchart', 'graphviz', 'dot', 'mermaid', 'plantuml', 'puml', 'markmap', 'mindmap',
]);

export function renderMath(source: string, display: boolean): string {
  const wrapper = display ? 'katex-display-wrapper rich-math-block' : 'katex-inline-wrapper rich-math-inline';
  try {
    const html = katex.renderToString(source, {
      displayMode: display, throwOnError: true, trust: false, maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml',
    });
    return `<span class="${wrapper}" data-math-source="${escapeHtml(source)}">${html}</span>`;
  } catch {
    return `<code class="rich-math-error" data-math-source="${escapeHtml(source)}">${escapeHtml(source)}</code>`;
  }
}

/** Exact delimiter pairs; incomplete tokens remain text throughout streaming. */
export function mathExtension(): MarkedExtension {
  return { extensions: [{
    name: 'richBlockMath', level: 'block',
    start(source) { return /(?:^|\n) {0,3}(?:\$\$|\\\[)/.exec(source)?.index; },
    tokenizer(source) {
      const match = /^ {0,3}(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])(?=\s|$)/.exec(source);
      if (match) return { type: 'richBlockMath', raw: match[0], text: (match[1] ?? match[2]).trim() };
      // Do not let Marked consume the backslash or parse a lone $ inside $$.
      const pending = /^ {0,3}(?:\$\$|\\\[)[\s\S]*?(?=\n\s*\n|$)/.exec(source);
      if (pending) return { type: 'richBlockMath', raw: pending[0], text: pending[0], pending: true };
    },
    renderer(token) {
      return token.pending ? `<pre class="rich-math-pending">${escapeHtml(token.text)}</pre>\n`
        : `<div class="rich-math-display">${renderMath(token.text, true)}</div>\n`;
    },
  }, {
    name: 'richInlineMath', level: 'inline',
    start(source) { return /\$|\\[([]/.exec(source)?.index; },
    tokenizer(source) {
      const display = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])/.exec(source);
      if (display) return { type: 'richInlineMath', raw: display[0], text: (display[1] ?? display[2]).trim(), display: true };
      const paren = /^\\\(([^\n]+?)\\\)/.exec(source);
      if (paren) return { type: 'richInlineMath', raw: paren[0], text: paren[1].trim() };
      // No whitespace next to $, no currency pair ($5 and $10), no escaped closing $.
      const dollar = /^\$(?!\$)(\S(?:[^$\n]*?\S)?)\$(?![\d$])/.exec(source);
      if (dollar && !dollar[1].endsWith('\\')) return { type: 'richInlineMath', raw: dollar[0], text: dollar[1] };
      const literal = /^(?:\$\$|\\[([])/.exec(source);
      if (literal) return { type: 'richInlineMath', raw: literal[0], text: literal[0], literal: true };
    },
    renderer(token) { return token.literal ? escapeHtml(token.text) : renderMath(token.text, Boolean(token.display)); },
  }] };
}

export function richCodeBlock(token: Tokens.Code): string | undefined {
  const language = (token.lang || '').trim().split(/\s+/)[0].toLowerCase();
  if (!diagramLanguages.has(language) && !['math', 'latex', 'tex'].includes(language)) return;
  const opener = /^( {0,3})(`{3,}|~{3,})/.exec(token.raw);
  const closed = !opener || new RegExp(`\\n {0,3}${opener[2][0]}{${opener[2].length},}[ \\t]*\\n?$`).test(token.raw);
  if (!closed) return `<pre class="rich-pending-code"><code>${escapeHtml(token.raw)}</code></pre>\n`;
  if (['math', 'latex', 'tex'].includes(language)) return `<div class="rich-math-display">${renderMath(token.text, true)}</div>\n`;
  return `<figure class="rich-diagram" data-rich-kind="${language}"><pre class="rich-diagram-source"><code class="language-${language}">${escapeHtml(token.text)}</code></pre></figure>\n`;
}

export function createRichMarkdownParser(): Marked {
  const parser = new Marked({ gfm: true, breaks: true, async: false });
  parser.use(mathExtension());
  return parser;
}
