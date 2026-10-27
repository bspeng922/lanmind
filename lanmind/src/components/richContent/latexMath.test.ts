import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLatexMathDelimiters, preserveLatexMathDelimiters } from './latexMath';

test('normalizeLatexMathDelimiters: converts \\[ ... \\] to $$ ... $$', () => {
  const input = `前文
\\[
I \\propto \\frac{1}{\\lambda^4}
\\]
后文`;
  const result = normalizeLatexMathDelimiters(input);
  assert.ok(result.includes('$$\nI \\propto \\frac{1}{\\lambda^4}\n$$'));
  assert.ok(!result.includes('\\[' ));
  assert.ok(!result.includes('\\]'));
});

test('normalizeLatexMathDelimiters: converts \\( ... \\) to $ ... $', () => {
  const input = '- \\(I\\)：散射光的强度，也就是空气分子；\\(\\lambda\\)：波长约 \\(450\\,\\text{nm}\\)。';
  const result = normalizeLatexMathDelimiters(input);
  assert.equal(result, '- $I$：散射光的强度，也就是空气分子；$\\lambda$：波长约 $450\\,\\text{nm}$。');
});

test('normalizeLatexMathDelimiters: heals Setext heading underlines inside multiline formulas', () => {
  const input = `\\[
\\frac{I_{\\text{蓝}}}{I_{\\text{红}}}
=====================================
\\left(\\frac{\\lambda_{\\text{红}}}{\\lambda_{\\text{蓝}}}\\right)^4
================================================================
\\approx 5.8
\\]`;
  const result = normalizeLatexMathDelimiters(input);
  assert.ok(result.includes('$$\n\\frac{I_{\\text{蓝}}}{I_{\\text{红}}}\n=\n\\left(\\frac{\\lambda_{\\text{红}}}{\\lambda_{\\text{蓝}}}\\right)^4\n=\n\\approx 5.8\n$$'));
  assert.ok(!result.includes('===='));
});

test('normalizeLatexMathDelimiters: preserves code blocks and inline code', () => {
  const input = '`\\[code\\]` and ```\n\\(code\\)\n``` but math: \\[x+y=z\\]';
  const result = normalizeLatexMathDelimiters(input);
  assert.ok(result.includes('`\\[code\\]`'));
  assert.ok(result.includes('```\n\\(code\\)\n```'));
  assert.ok(result.includes('$$\nx+y=z\n$$'));
});

test('math normalization leaves long fences, tilde fences, unclosed fences and literal placeholders intact', () => {
  for (const code of [
    '````text\n```\n\\[literal\\]\n````',
    '~~~latex\n\\[literal\\]\n~~~',
    '```text\n\\[unfinished code\\]',
    '`` `\\(literal\\)` ``',
    '\\\\[escaped\\\\]',
  ]) assert.equal(normalizeLatexMathDelimiters(code), code);
  assert.equal(normalizeLatexMathDelimiters('__CODE_BLOCK_0__ and `\\(x\\)`'), '__CODE_BLOCK_0__ and `\\(x\\)`');
});

test('unchanged formulas retain mixed original delimiters after native editor serialization', () => {
  const source = String.raw`\(x\), $x$, \(x\).

\[
\frac{700}{450}
=
\frac{14}{9}
\]

$$x$$

\`\`\`text
$x$
\`\`\``.replaceAll('\\`', '`');
  const normalized = normalizeLatexMathDelimiters(source);
  const restored = preserveLatexMathDelimiters(normalized, source);
  assert.equal(restored.replace(/\n{3,}/g, '\n\n'), source);
  assert.equal(preserveLatexMathDelimiters('$y$', '\\(x\\)'), '$y$');
  assert.equal(preserveLatexMathDelimiters('$$\nx=y\n$$', '\\[\r\nx=y\r\n\\]'), '\\[\r\nx=y\r\n\\]');
});
