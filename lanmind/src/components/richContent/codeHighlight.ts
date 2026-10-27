import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-perl';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-matlab';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-diff';
import { escapeHtml } from './richMarkdown';

const aliases: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', py: 'python', python3: 'python',
  'c++': 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp', 'c#': 'csharp', cs: 'csharp', golang: 'go', rs: 'rust',
  kt: 'kotlin', sh: 'bash', shell: 'bash', zsh: 'bash', shellscript: 'bash', ps1: 'powershell', pwsh: 'powershell',
  rb: 'ruby', pl: 'perl', yml: 'yaml', html: 'markup', xml: 'markup', svg: 'markup', md: 'markdown',
  dockerfile: 'docker', conf: 'ini', config: 'ini', text: 'plain', txt: 'plain', plaintext: 'plain',
};

export const supportedCodeLanguages = [
  'javascript', 'typescript', 'jsx', 'tsx', 'python', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'kotlin', 'swift',
  'sql', 'bash', 'powershell', 'ruby', 'php', 'perl', 'lua', 'r', 'matlab', 'json', 'yaml', 'toml', 'ini',
  'markup', 'css', 'scss', 'markdown', 'docker', 'diff',
];

export function codeLanguage(language: string): string {
  const value = language.trim().split(/\s+/)[0].toLowerCase(); return aliases[value] || value;
}

export function highlightCode(source: string, language: string): string {
  const name = codeLanguage(language);
  const grammar = Prism.languages[name];
  // Long blocks remain copyable without running expensive regular expressions.
  if (!name || !grammar || source.length > 100_000) return escapeHtml(source);
  try { return Prism.highlight(source, grammar, name); } catch { return escapeHtml(source); }
}

export function plainCodeBlock(source: string, language: string): string {
  const name = codeLanguage(language);
  return `<div class="rich-code-block"><div class="rich-code-header">${escapeHtml(language || 'CODE')}</div>` +
    `<pre><code class="${name ? `language-${escapeHtml(name)}` : ''}">${highlightCode(source, name)}</code></pre></div>\n`;
}
