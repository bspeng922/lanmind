import { Marked } from 'marked';
import DOMPurify from 'dompurify';

// An isolated parser prevents Wiki extensions from affecting chat and task Markdown.
const parser = new Marked({ gfm: true, breaks: true, async: false });
parser.use({ extensions: [{
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
  const html = DOMPurify.sanitize(parseWikiMarkdown(content), {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|lanmind|data|blob):|assets\/|\.\.?\/|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
  const host = document.createElement('div');
  host.innerHTML = html;
  host.querySelectorAll('a[href]').forEach(anchor => anchor.setAttribute('rel', 'noreferrer noopener'));
  return host.innerHTML;
}
