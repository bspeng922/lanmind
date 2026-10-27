import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiMarkdownParser } from '../ai/aiMarkdown';
import { parseWikiMarkdown } from '../wiki/wikiMarkdown';
import { diagramJson } from './engines';
import { highlightCode } from './codeHighlight';

for (const [name, parse] of Object.entries({ ai: (text: string) => createAiMarkdownParser().parse(text) as string, wiki: parseWikiMarkdown })) {
  test(`${name}: all delimiters, numeric formulas and complex math use the same engine`, () => {
    const html = parse('$1$ and $2.5$ and \\(x^2\\)\n\n$$\\frac{a}{\\sqrt{b}}$$\n\n\\[\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}\\]');
    assert.equal((html.match(/class="katex"/g) || []).length, 5);
    assert.match(html, /<path d=/);
    assert.match(html, /data-math-source=/);
  });
  test(`${name}: currency, escapes and code remain literal`, () => {
    const html = parse('Price $5 and $10 today. \\$20\n\n`$x$`\n\n```text\n$x$\n```');
    assert.doesNotMatch(html, /class="katex"/);
    assert.match(html, /Price \$5 and \$10/);
    assert.match(html, /<code>\$x\$<\/code>/);
  });
  test(`${name}: incomplete and mismatched math is not rendered`, () => {
    for (const source of ['$$x^2\\]', '\\[x^2$$', '$$\nx^2', '\\(x^2']) assert.doesNotMatch(parse(source), /class="katex"/);
    assert.match(parse('$$\\badCommand{x}$$'), /rich-math-error/);
  });
  test(`${name}: closed diagram fences become previews and open fences remain source`, () => {
    for (const language of ['chart', 'chartjs', 'echarts', 'flowchart', 'graphviz', 'dot', 'mermaid', 'plantuml', 'puml', 'mindmap', 'markmap']) {
      assert.match(parse('```' + language + '\nA-->B\n```'), new RegExp(`data-rich-kind="${language}"`));
      assert.doesNotMatch(parse('```' + language + '\nA-->B'), /data-rich-kind=/);
    }
    assert.match(parse('```math\nE=mc^2\n```'), /class="katex"/);
  });
}

test('diagram JSON rejects code, unsafe properties and network resources', () => {
  assert.deepEqual(diagramJson('{"series":[]}'), { series: [] });
  for (const input of ['{series:[]}', '{"formatter":()=>alert(1)}', '{"__proto__":{}}', '{"symbol":"image://https://example.com/a.png"}',
    '{"graphic":{"type":"image","style":{"image":"/relative.png"}}}', '{"image":"//example.com/a.png"}']) assert.throws(() => diagramJson(input));
});

test('common programming, scripting and configuration languages highlight with useful aliases', () => {
  const examples: Record<string, string> = {
    ts: 'const value: number = 1;', js: 'const value = true;', tsx: 'const node = <div>{value}</div>;',
    py: 'def greet(name):\n    return "Hello"', java: 'public class Main { private int count = 1; }',
    'c++': '#include <iostream>\nint main() { return 0; }', 'c#': 'public class Main { string value = "Hi"; }',
    go: 'package main\nfunc main() {}', rust: 'fn main() { let x = 1; }', sql: 'SELECT name FROM users WHERE id = 1;',
    shell: 'if [ -n "$HOME" ]; then echo "hi"; fi', ps1: '$value = Get-Content -Path "file.txt"',
    rb: 'def greet\n puts "hi"\nend', php: '<?php echo "Hello"; ?>', lua: 'local x = true',
    kotlin: 'fun main() { val x = 1 }', swift: 'let value: Int = 1', perl: 'my $value = "Hi";',
    r: 'value <- function(x) { return(x + 1) }', matlab: 'function y = square(x)\ny = x^2;\nend',
    json: '{"value":true}', yml: 'enabled: true', toml: 'enabled = true', ini: '[server]\nport=80',
    html: '<div class="test">Hi</div>', css: '.test { color: red; }', scss: '$color: red; .test { color: $color; }',
    md: '# Heading\n**bold**', dockerfile: 'FROM node:22\nRUN npm install', diff: '+added\n-removed',
  };
  for (const [language, source] of Object.entries(examples)) assert.match(highlightCode(source, language), /class="token /, language);
  assert.equal(highlightCode('<script>alert(1)</script>', 'unknown-language'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});
