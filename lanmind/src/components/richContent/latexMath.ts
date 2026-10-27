type MathDelimiter = '$$' | '$' | '\\[' | '\\(';

/** Visit complete formulas while keeping fenced and inline code literal. */
function mapMath(markdown: string, transform: (formula: string, delimiter: MathDelimiter, raw: string) => string): string {
  let output = '';
  let copied = 0;
  let index = 0;
  while (index < markdown.length) {
    if (index === 0 || markdown[index - 1] === '\n') {
      const fence = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(markdown.slice(index));
      if (fence) {
        const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*\\r?$`, 'gm');
        close.lastIndex = index + fence[0].length;
        const end = close.exec(markdown);
        index = end ? close.lastIndex : markdown.length;
        continue;
      }
    }
    if (markdown[index] === '`') {
      const ticks = /^`+/.exec(markdown.slice(index))![0];
      const close = /`+/g;
      close.lastIndex = index + ticks.length;
      let end: RegExpExecArray | null;
      do { end = close.exec(markdown); } while (end && end[0].length !== ticks.length);
      index = end ? close.lastIndex : index + ticks.length;
      continue;
    }
    // An escaped delimiter remains ordinary Markdown text.
    if (markdown[index] === '\\' && /[\\$`]/.test(markdown[index + 1] || '')) { index += 2; continue; }
    const match = /^(\$\$)([\s\S]*?)\$\$|^(\\\[)([\s\S]*?)\\\]|^(\\\()([^\n]+?)\\\)|^(\$)(?!\$)(\S(?:[^$\n]*?\S)?)\$(?![\d$])/.exec(markdown.slice(index));
    if (!match) { index++; continue; }
    const delimiter = (match[1] || match[3] || match[5] || match[7]) as MathDelimiter;
    const formula = match[2] ?? match[4] ?? match[6] ?? match[8];
    if (delimiter === '$' && formula.endsWith('\\')) { index += match[0].length; continue; }
    output += markdown.slice(copied, index) + transform(formula, delimiter, match[0]);
    index += match[0].length;
    copied = index;
  }
  return output + markdown.slice(copied);
}

const cleanBlock = (formula: string) => formula.replace(/\n={2,}[ \t]*(?=\r?\n|$)/g, '\n=').trim();
const mathKey = (formula: string, delimiter: MathDelimiter) =>
  JSON.stringify([delimiter === '$$' || delimiter === '\\[', cleanBlock(formula).replace(/\r\n?/g, '\n')]);

/** Convert LaTeX delimiters for parsers that only accept dollar math. */
export function normalizeLatexMathDelimiters(markdown: string): string {
  if (!/[\\$]/.test(markdown)) return markdown;
  return mapMath(markdown, (formula, delimiter, raw) => {
    if (delimiter === '\\[') return `\n\n$$\n${cleanBlock(formula)}\n$$\n\n`;
    if (delimiter === '\\(') return `$${formula.trim()}$`;
    if (delimiter === '$$' && /\n={2,}/.test(formula)) return `$$\n${cleanBlock(formula)}\n$$`;
    return raw;
  });
}

/** Native editor math uses dollars; retain unchanged formulas' original source syntax. */
export function preserveLatexMathDelimiters(markdown: string, source: string): string {
  if (markdown === source || (!source.includes('\\[') && !source.includes('\\('))) return markdown;
  const originals = new Map<string, string[]>();
  mapMath(source, (formula, delimiter, raw) => {
    const key = mathKey(formula, delimiter);
    const entries = originals.get(key) || [];
    entries.push(raw); originals.set(key, entries);
    return raw;
  });
  return mapMath(markdown, (formula, delimiter, raw) => originals.get(mathKey(formula, delimiter))?.shift() ?? raw);
}
