import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { chooseWikiEditorMode, openWikiSource } from './wikiEditorHelpers';

const rayleigh = await readFile(new URL('./fixtures/rayleigh.md', import.meta.url), 'utf8');
const body = (page: Page) => page.getByRole('textbox', { name: 'Markdown body', exact: true });

async function expectFractions(root: Locator) {
  const fractions = await root.evaluate(async element => {
    await document.fonts.ready;
    return [...element.querySelectorAll('.mfrac')].map(fraction => {
      const rows = fraction.querySelectorAll(':scope > .vlist-t > .vlist-r:first-child > .vlist > span');
      const denominator = rows[0]?.lastElementChild?.getBoundingClientRect();
      const line = rows[1]?.querySelector('.frac-line')?.getBoundingClientRect();
      const numerator = rows[2]?.lastElementChild?.getBoundingClientRect();
      return { visibleLine: Boolean(line?.width && line.height),
        separated: Boolean(numerator && denominator && numerator.bottom < denominator.top),
        numeratorAbove: Boolean(numerator && line && numerator.top < line.top),
        denominatorBelow: Boolean(denominator && line && denominator.bottom > line.bottom) };
    });
  });
  expect(fractions).toHaveLength(6);
  expect(fractions.every(fraction => Object.values(fraction).every(Boolean))).toBe(true);
}

for (const theme of ['light', 'dark']) {
  test(`${theme}: Rayleigh fractions and scripts render in reading and live editing without changing source`, async ({ page }, info) => {
    await page.goto(`/tests/theme/rich.html?theme=${theme}`);
    await page.waitForFunction(() => typeof (window as any).setRichContent === 'function');
    await page.evaluate(content => (window as any).setRichContent(content), rayleigh);
    const reading = page.getByTestId('wiki').locator('article');
    await expect(reading.locator('.rich-math-display')).toHaveCount(4);
    await expect(reading.locator('.katex')).toHaveCount(11);
    await expectFractions(reading);

    await page.goto(`/tests/theme/wiki.html?theme=${theme}&locale=en-US`);
    await openWikiSource(page);
    await body(page).fill(rayleigh);
    await body(page).press('Control+s');
    await chooseWikiEditorMode(page, 'live');
    await page.getByRole('textbox', { name: 'Page title', exact: true }).focus();
    const live = page.locator('.vditor-ir > pre');
    await expect(live.locator('.wiki-rich-preview .rich-math-display')).toHaveCount(4);
    await expect(live.locator('.wiki-rich-preview .katex')).toHaveCount(11);
    await expect(live.locator('h1')).toHaveCount(0);
    await expectFractions(live);
    await info.attach('rayleigh-formulas', { body: await live.screenshot(), contentType: 'image/png' });
    await openWikiSource(page);
    await expect(body(page)).toHaveValue(rayleigh);
    await chooseWikiEditorMode(page, 'live');
    await live.locator('p').last().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' edited');
    await body(page).press('Control+s');
    await openWikiSource(page);
    await expect(body(page)).toHaveValue(/\\\[\n\\frac\{I_/);
    await expect(body(page)).toHaveValue(/\\\(\\lambda\\\)/);
    await expect(body(page)).not.toHaveValue(/wiki-rich|katex|====/);
  });

  test(`${theme}: code previews do not reserve empty fence lines and still reveal editable source`, async ({ page }) => {
    await page.goto(`/tests/theme/wiki.html?theme=${theme}&locale=en-US`);
    await openWikiSource(page);
    const markdown = 'Before code\n\n```js\nconst answer = 42;\nconsole.log(answer);\n```\n\nAfter code';
    await body(page).fill(markdown);
    await chooseWikiEditorMode(page, 'live');
    await page.getByRole('textbox', { name: 'Page title', exact: true }).focus();
    const block = page.locator('[data-type="code-block"][data-wiki-rich-block]');
    await expect(block.locator('.rich-code-block')).toBeVisible();
    const spacing = await block.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const preview = element.querySelector('.rich-code-block')!.getBoundingClientRect();
      return { top: preview.top - rect.top, bottom: rect.bottom - preview.bottom };
    });
    expect(spacing.top).toBeLessThanOrEqual(5);
    expect(spacing.bottom).toBeLessThanOrEqual(5);
    await block.locator('pre').last().dblclick();
    await expect(page.locator('[data-type="code-block"] > pre > code')).toBeVisible();
    await page.getByRole('textbox', { name: 'Page title', exact: true }).focus();
    await openWikiSource(page);
    await expect(body(page)).toHaveValue(markdown);
  });
}

test('Ctrl/Meta clicking formatted, reference, linked-image and math-preview links follows the right destination once', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?theme=light&locale=en-US');
  await openWikiSource(page);
  const markdown = '[**Formatted**](https://example.com/formatted "Title") and [Reference][target]\n\n' +
    '[![Linked image](data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2230%22%20height=%2230%22/%3E)](https://example.com/image)\n\n' +
    'Math $x^2$ and [Preview](https://example.com/preview).\n\n[target]: https://example.com/reference "Reference title"\n';
  await body(page).fill(markdown);
  await chooseWikiEditorMode(page, 'live');
  await page.getByRole('textbox', { name: 'Page title', exact: true }).focus();
  await expect(page.locator('.wiki-rich-preview a')).toBeVisible();
  // Observe the existing app-navigation bridge without opening real external pages.
  await page.evaluate(() => {
    (window as any).followedLinks = [];
    document.addEventListener('click', event => {
      const anchor = (event.target as Element).closest('a');
      if (anchor?.style.display !== 'none') return;
      (window as any).followedLinks.push({ url: anchor.href, target: anchor.target });
      event.preventDefault();
    }, true);
  });
  const cases = [
    { link: page.locator('.vditor-ir strong .vditor-ir__link'), path: 'formatted' },
    { link: page.locator('[data-type="link-ref"] > span').filter({ hasText: /^Reference$/ }), path: 'reference' },
    { link: page.locator('.vditor-ir img'), path: 'image' },
    { link: page.locator('.wiki-rich-preview a'), path: 'preview' },
  ];
  for (const modifier of ['Control', 'Meta'] as const) {
    for (const { link, path } of cases) {
      await link.click({ modifiers: [modifier] });
      expect(await page.evaluate(() => (window as any).followedLinks.splice(0))).toEqual([
        { url: `https://example.com/${path}`, target: '_blank' },
      ]);
    }
  }
  await cases[0].link.click();
  expect(await page.evaluate(() => (window as any).followedLinks)).toEqual([]);
  await openWikiSource(page);
  await expect(body(page)).toHaveValue(markdown);
});
