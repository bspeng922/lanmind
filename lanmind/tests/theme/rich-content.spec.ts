import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { chooseWikiEditorMode, openWikiSource } from './wikiEditorHelpers';

test.setTimeout(120_000);
const samples: Record<string, string> = {
  chart: '{"type":"bar","data":{"labels":["A","B"],"datasets":[{"label":"Count","data":[1,2]}]}}',
  echarts: '{"xAxis":{"data":["A","B"]},"yAxis":{},"series":[{"type":"bar","data":[1,2]}]}',
  flowchart: 'st=>start: Start\ne=>end: End\nst->e',
  graphviz: 'digraph G { A -> B }',
  mermaid: 'flowchart TD\nA[Start] --> B[End]',
  plantuml: '@startuml\nAlice -> Bob: Hello\n@enduml',
  mindmap: '{"name":"Root","children":[{"name":"Branch A"},{"name":"Branch B"}]}',
  markmap: '# Root\n## Branch A\n## Branch B',
};
const fence = (kind: string, value: string) => '```' + kind + '\n' + value + '\n```';

for (const theme of ['light', 'dark']) {
  test(`${theme}: math keeps symbols, reserves height and stays within a narrow message`, async ({ page }) => {
    await page.goto(`/tests/theme/rich.html?theme=${theme}&narrow=1`);
    await page.waitForFunction(() => typeof (window as any).setRichContent === 'function');
    await page.evaluate(() => (window as any).setRichContent(String.raw`Before $\dfrac{a^2+b^2}{\sqrt{1+x^2}}$ after.
Next line $\overbrace{a+b}^{c}$ end.

$$\begin{aligned}a &= \frac{1}{2} \\ b &= \sqrt{c^2+d^2}\end{aligned}$$

$$\begin{pmatrix}a & b \\ c & d\end{pmatrix}$$

$$\int_0^\infty x^2 e^{-x}\,dx = 2$$

After all formulas.`));
    for (const id of ['ai', 'wiki']) {
      const article = page.getByTestId(id).locator('article');
      await expect(article.locator('.katex')).toHaveCount(5);
      const layout = await article.evaluate(async root => {
        await document.fonts.ready;
        const blocks = Array.from(root.querySelectorAll('.rich-math-display')).map(node => node.getBoundingClientRect());
        return {
          paths: Array.from(root.querySelectorAll('svg path')).every(path => Boolean(path.getAttribute('d'))),
          hiddenMathml: Array.from(root.querySelectorAll('.katex-mathml')).every(node => getComputedStyle(node).clipPath === 'inset(50%)'),
          noOverlap: blocks.every((rect, i) => !i || rect.top >= blocks[i - 1].bottom),
          inlineHeight: root.querySelector('.rich-math-inline')!.getBoundingClientRect().height,
          width: root.clientWidth, scrollWidth: root.scrollWidth,
        };
      });
      expect(layout.paths).toBe(true); expect(layout.hiddenMathml).toBe(true); expect(layout.noOverlap).toBe(true);
      expect(layout.inlineHeight).toBeGreaterThan(25); expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
    }
  });

  test(`${theme}: all diagram engines render locally and preserve completed diagrams during streaming`, async ({ page }) => {
    const external: string[] = []; const errors: string[] = [];
    page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:1421')) external.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/tests/theme/rich.html?theme=${theme}`);
    await page.waitForFunction(() => typeof (window as any).setRichContent === 'function');
    const markdown = Object.entries(samples).map(([kind, value]) => fence(kind, value)).join('\n\n');
    await page.evaluate(value => (window as any).setRichContent(value), markdown);
    await expect(page.locator('[data-rich-state="ready"]')).toHaveCount(16, { timeout: 90_000 });
    expect(await page.locator('[data-rich-state="error"]').allTextContents()).toEqual([]);
    await page.evaluate(() => { (window as any).keptDiagram = document.querySelector('.rich-diagram'); });
    await page.evaluate(value => (window as any).setRichContent(value + '\n\nStreaming $$\\frac{a}{'), markdown);
    await expect(page.locator('[data-rich-state="ready"]')).toHaveCount(16);
    expect(await page.evaluate(() => (window as any).keptDiagram === document.querySelector('.rich-diagram'))).toBe(true);
    const figure = page.getByTestId('ai').locator('[data-rich-kind="mermaid"]');
    await figure.getByRole('button', { name: 'View source', exact: true }).click();
    await expect(figure.locator('pre')).toBeVisible();
    await figure.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(figure.locator('.rich-diagram-preview')).toBeVisible();
    expect(external).toEqual([]); expect(errors).toEqual([]);
  });
}

test('invalid diagrams fail locally, preserve source and do not affect valid neighbors', async ({ page }) => {
  await page.goto('/tests/theme/rich.html'); await page.waitForFunction(() => (window as any).setRichContent);
  await page.evaluate(value => (window as any).setRichContent(value), fence('echarts', '{series:()=>alert(1)}') + '\n\n' + fence('mermaid', samples.mermaid));
  await expect(page.locator('[data-rich-state="error"]')).toHaveCount(2);
  await expect(page.locator('[data-rich-state="ready"]')).toHaveCount(2);
  await expect(page.getByTestId('ai').locator('[data-rich-state="error"] pre')).toBeVisible();
});

test('long formulas scroll inside their own containers', async ({ page }) => {
  await page.goto('/tests/theme/rich.html?narrow=1'); await page.waitForFunction(() => (window as any).setRichContent);
  const formula = Array.from({ length: 45 }, (_, i) => `x_{${i}}^2`).join('+');
  await page.evaluate(value => (window as any).setRichContent(`Inline $${value}$ end.\n\n$$${value}$$`), formula);
  await expect(page.locator('.katex')).toHaveCount(4);
  const results = await page.locator('article').evaluateAll(nodes => nodes.map(root => ({
    bounded: root.scrollWidth <= root.clientWidth + 1,
    scrolls: [...root.querySelectorAll('.rich-math-inline, .rich-math-display')].every(node => node.scrollWidth > node.clientWidth),
  })));
  expect(results).toEqual([{ bounded: true, scrolls: true }, { bounded: true, scrolls: true }]);
});

test('all engines obey the public-share script policy without external requests', async ({ page }) => {
  await page.goto('/tests/theme/rich.html'); await page.waitForFunction(() => (window as any).setRichContent);
  const violations: string[] = [];
  await page.exposeFunction('recordRichCspViolation', (directive: string) => violations.push(directive));
  await page.evaluate(() => {
    document.addEventListener('securitypolicyviolation', event => (window as any).recordRichCspViolation(event.violatedDirective));
    const policy = document.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'";
    document.head.append(policy);
  });
  await page.evaluate(value => (window as any).setRichContent(value), Object.entries(samples).map(([kind, value]) => fence(kind, value)).join('\n\n'));
  await expect(page.locator('[data-rich-state="ready"]')).toHaveCount(16, { timeout: 90_000 });
  expect(violations).toEqual([]);
});

test('Wiki live previews survive source roundtrips and edits without entering persisted Markdown', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?locale=en-US&theme=light'); await openWikiSource(page);
  const original = 'Inline $\\sqrt{x}$ and **bold**.\n\n$$\nE=mc^2\n$$\n\n' + fence('mermaid', samples.mermaid) + '\n';
  const body = page.getByRole('textbox', { name: 'Markdown body', exact: true }); await body.fill(original); await body.press('Control+s');
  await chooseWikiEditorMode(page, 'live');
  await page.getByRole('textbox', { name: 'Page title', exact: true }).click();
  await expect(page.locator('.wiki-rich-preview .katex')).toHaveCount(2);
  await expect(page.locator('.wiki-rich-preview [data-rich-state="ready"]')).toHaveCount(1);
  await openWikiSource(page); await expect(body).toHaveValue(original);
  await body.fill(original + '\nChanged paragraph.'); await body.press('Control+s');
  await chooseWikiEditorMode(page, 'live'); await openWikiSource(page);
  await expect(body).toHaveValue(original + '\nChanged paragraph.');
  await expect(body).not.toHaveValue(/wiki-rich|rich-diagram|<svg/);
});

test('editing beside live formulas preserves all delimiter forms and supports undo', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?locale=en-US&theme=light'); await openWikiSource(page);
  const original = 'Inline $\\sqrt{x}$ and \\(a+b\\).\n\n$$\nE=mc^2\n$$\n\n\\[\n\\frac{a}{b}\n\\]\n';
  const body = page.getByRole('textbox', { name: 'Markdown body', exact: true }); await body.fill(original); await body.press('Control+s');
  await chooseWikiEditorMode(page, 'live'); await page.getByRole('textbox', { name: 'Page title', exact: true }).click();
  await expect(page.locator('.wiki-rich-preview .katex')).toHaveCount(4);
  await page.locator('p[data-block] > .wiki-rich-preview').first().click();
  await page.keyboard.type(' Added'); await page.keyboard.press('Control+s');
  await openWikiSource(page);
  const changed = await body.inputValue();
  expect(changed).toContain('Added'); expect(changed).toContain('$\\sqrt{x}$'); expect(changed).toContain('\\(a+b\\)');
  expect(changed).toContain('\\['); expect(changed.match(/Inline/g)).toHaveLength(1);
  expect(changed).not.toMatch(/wiki-rich|rich-math|<svg/);
  await chooseWikiEditorMode(page, 'live'); await page.keyboard.press('Control+z'); await openWikiSource(page);
  await expect(body).not.toHaveValue(/Added/);
});

test('Wiki and AI code blocks share language highlighting, theme colors and exact code copying', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/tests/theme/rich.html?theme=dark'); await page.waitForFunction(() => (window as any).setRichContent);
  const source = 'const value: number = 42;\nconsole.log("Hello <world>", value);';
  await page.evaluate(value => (window as any).setRichContent(value), fence('ts', source) + '\n\n' + fence('ps1', '$value = Get-Content "file.txt"'));
  for (const id of ['ai', 'wiki']) {
    await expect(page.getByTestId(id).locator('pre .token.keyword').first()).toBeVisible();
    const color = await page.getByTestId(id).locator('pre .token.keyword').first().evaluate(node => ({ actual: getComputedStyle(node).color,
      expected: getComputedStyle(document.documentElement).getPropertyValue('--code-keyword').trim() }));
    expect(color.actual).not.toBe('rgb(237, 237, 237)'); expect(color.expected).not.toBe('');
  }
  const wikiCode = page.getByTestId('wiki').locator('.rich-code-block').first(); await wikiCode.hover();
  await wikiCode.locator('.wiki-code-copy-btn').click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(source);
  await page.goto('/tests/theme/wiki.html?locale=en-US&theme=light'); await openWikiSource(page);
  const body = page.getByRole('textbox', { name: 'Markdown body', exact: true }); await body.fill(fence('typescript', source)); await body.press('Control+s');
  await chooseWikiEditorMode(page, 'live'); await page.getByRole('textbox', { name: 'Page title', exact: true }).click();
  await expect(page.locator('.wiki-rich-preview .token.keyword').first()).toBeVisible();
  await openWikiSource(page); await expect(body).toHaveValue(fence('typescript', source));
});

test('Word and PDF exports include rendered math and every diagram type', async ({ page }) => {
  await page.goto('/tests/theme/rich.html?theme=dark'); await page.waitForFunction(() => (window as any).setRichContent);
  const markdown = '$\\sqrt{x}$\n\n$$\\frac{a}{b}$$\n\n' + Object.entries(samples).map(([kind, value]) => fence(kind, value)).join('\n\n');
  const data = await page.evaluate(async content => {
    const path = '/src/components/wiki/wikiRichExport.ts'; const { buildWikiDocx, buildWikiPdf } = await import(path);
    const doc = { title: 'Math and diagrams', content, updatedAt: new Date().toISOString() };
    const word: Uint8Array = await buildWikiDocx(doc); const pdf: Uint8Array = await buildWikiPdf(doc);
    return { word: Array.from(word), pdf: Array.from(pdf) };
  }, markdown);
  const JSZip = createRequire(import.meta.url)('jszip'); const zip = await JSZip.loadAsync(new Uint8Array(data.word));
  const xml = await zip.file('word/document.xml').async('string');
  expect((xml.match(/<w:drawing>/g) || []).length).toBe(10);
  // The inline radical uses a 2x snapshot but must keep its original display size.
  const firstDrawing = xml.match(/<w:drawing>[\s\S]*?<\/w:drawing>/)![0];
  const displayWidth = Number(firstDrawing.match(/<wp:extent cx="(\d+)"/)![1]) / 9525;
  const imageId = firstDrawing.match(/r:embed="([^"]+)"/)![1];
  const relationships = await zip.file('word/_rels/document.xml.rels').async('string');
  const relationship = relationships.match(/<Relationship\b[^>]+/g).find((item: string) => item.includes(`Id="${imageId}"`));
  const target = relationship.match(/Target="([^"]+)"/)[1];
  const image = await zip.file(`word/${target}`).async('nodebuffer');
  expect(Math.abs(displayWidth - image.readUInt32BE(16) / 2)).toBeLessThanOrEqual(1);
  expect(Buffer.from(data.pdf).subarray(0, 5).toString()).toBe('%PDF-');
});
