import { createRichMarkdownParser, richCodeBlock } from '../richContent/richMarkdown';
import { sanitizeRichHtml } from '../richContent/sanitize';
import { plainCodeBlock } from '../richContent/codeHighlight';

// An isolated parser prevents Wiki extensions from affecting chat and task Markdown.
const parser = createRichMarkdownParser();
parser.use({ renderer: { code(token) { return richCodeBlock(token) ?? plainCodeBlock(token.text, (token.lang || '').trim().split(/\s+/)[0]); } }, extensions: [{
  name: 'wikiHighlight',
  level: 'inline',
  start: source => source.indexOf('=='),
  tokenizer(source) {
    const match = /^==(?=\S)([^\n]+?\S|\S)==/.exec(source);
    if (match) return { type: 'wikiHighlight', raw: match[0], tokens: this.lexer.inlineTokens(match[1]) };
  },
  renderer(token) { return `<mark>${this.parser.parseInline(token.tokens || [])}</mark>`; },
}] });

export function parseWikiMarkdown(content: string): string {
  return parser.parse(content || '') as string;
}

/** Shared by reading, history, public shares and document exports. */
export function renderWikiMarkdown(content: string): string {
  const html = sanitizeRichHtml(parseWikiMarkdown(content));
  const host = document.createElement('div');
  host.innerHTML = html;
  host.querySelectorAll('a[href]').forEach(anchor => anchor.setAttribute('rel', 'noreferrer noopener'));
  return host.innerHTML;
}
