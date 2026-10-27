import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiMarkdownParser } from './aiMarkdown';

test('parses LaTeX block formulas with \\[ \\] delimiters', () => {
  const parser = createAiMarkdownParser('复制');
  const markdown = '公式展示：\n\n\\[\nI \\propto \\frac{1}{\\lambda^4}\n\\]\n\n测试完毕。';
  const html = parser.parse(markdown) as string;
  assert.ok(html.includes('katex-display-wrapper'), 'should contain katex-display-wrapper');
  assert.ok(html.includes('katex'), 'should contain katex class');
  assert.ok(html.includes('∝'), 'should contain propto symbol');
});

test('parses LaTeX block formulas with $$ $$ delimiters', () => {
  const parser = createAiMarkdownParser('复制');
  const markdown = '能量方程：\n\n$$\nE = mc^2\n$$\n';
  const html = parser.parse(markdown) as string;
  assert.ok(html.includes('katex-display-wrapper'));
  assert.ok(html.includes('mc'));
});

test('parses inline formulas with \\( \\) and $ $ delimiters', () => {
  const parser = createAiMarkdownParser('复制');
  const markdown = '波长 \\(\\lambda = 450\\text{ nm}\\)，动量 $p = mv$。纯金额 $100 不受影响。';
  const html = parser.parse(markdown) as string;
  assert.ok(html.includes('katex-inline-wrapper'));
  assert.ok(html.includes('$100'), 'currency $100 should remain plain text');
});

test('renders code block with language header and copy button without vertical scrollbar limit', () => {
  const parser = createAiMarkdownParser('复制');
  const markdown = '```python\ndef quicksort_3way(arr, lo=0, hi=None):\n    if hi is None:\n        hi = len(arr) - 1\n```';
  const html = parser.parse(markdown) as string;
  assert.ok(html.includes('ai-code-block'));
  assert.ok(html.includes('ai-code-lang'));
  assert.ok(html.includes('PYTHON'));
  assert.ok(html.includes('ai-code-copy-btn'));
  assert.ok(html.includes('quicksort_3way'));
});
