import { expect, test, type Page } from '@playwright/test';

const editorMetrics = (page: Page) => page.getByRole('textbox', { name: 'Markdown body', exact: true }).evaluate(element => {
  const textarea = element as HTMLTextAreaElement;
  const canvas = textarea.closest('[data-wiki-canvas]')!;
  return {
    height: textarea.clientHeight,
    innerOverflow: textarea.scrollHeight - textarea.clientHeight,
    pageOverflow: canvas.scrollHeight - canvas.clientHeight,
    bottomGap: canvas.getBoundingClientRect().bottom - textarea.getBoundingClientRect().bottom,
  };
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: Wiki editor fills the viewport and scrolls the document as content grows`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=workspace-isolation&theme=${theme}&locale=en-US`);
    const editor = page.getByRole('textbox', { name: 'Markdown body', exact: true });
    await expect(editor).toBeVisible();
    await editor.fill('A short page');
    await expect.poll(async () => (await editorMetrics(page)).pageOverflow).toBeLessThanOrEqual(1);
    const initial = await editorMetrics(page);
    expect(initial.height).toBeGreaterThan(300);
    expect(initial.bottomGap).toBeLessThanOrEqual(36);

    await page.setViewportSize({ width: 1100, height: 700 });
    await expect.poll(async () => (await editorMetrics(page)).height).toBeLessThan(initial.height - 200);
    await expect.poll(async () => (await editorMetrics(page)).pageOverflow).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await expect.poll(async () => (await editorMetrics(page)).height).toBeGreaterThan(initial.height + 80);

    await editor.fill(Array.from({ length: 120 }, (_, index) => `Line ${index}: Wiki content`).join('\n'));
    await expect.poll(async () => (await editorMetrics(page)).pageOverflow).toBeGreaterThan(1000);
    expect((await editorMetrics(page)).innerOverflow).toBeLessThanOrEqual(1);
    await page.locator('[data-wiki-canvas]').evaluate(element => { element.scrollTop = element.scrollHeight; });
    const previousScroll = await page.locator('[data-wiki-canvas]').evaluate(element => element.scrollTop);
    await editor.press('Control+End');
    await editor.press('Enter');
    await editor.pressSequentially('Last line');
    for (let index = 0; index < 8; index++) await editor.press('Enter');
    expect(await page.locator('[data-wiki-canvas]').evaluate(element => element.scrollTop)).toBeGreaterThanOrEqual(previousScroll - 2);
    expect((await editorMetrics(page)).bottomGap).toBeGreaterThanOrEqual(0);
    expect((await editorMetrics(page)).innerOverflow).toBeLessThanOrEqual(1);

    await editor.fill('Short again');
    await expect.poll(async () => (await editorMetrics(page)).pageOverflow).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect.poll(async () => (await editorMetrics(page)).pageOverflow).toBeLessThanOrEqual(1);
    expect((await editorMetrics(page)).height).toBeGreaterThan(300);
    await editor.fill(Array.from({ length: 100 }, (_, index) => `## Section ${index}`).join('\n\n'));
    await expect.poll(async () => (await editorMetrics(page)).pageOverflow).toBeGreaterThan(1000);
    expect((await editorMetrics(page)).innerOverflow).toBeLessThanOrEqual(1);
  });

  test(`${theme}: Wiki icons update the tree and tags persist with removable controls`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=workspace-isolation&theme=${theme}&locale=en-US`);
    await page.getByRole('textbox', { name: 'Page title', exact: true }).fill('Tagged page');
    await page.getByRole('textbox', { name: 'Markdown body', exact: true }).press('Control+s');
    await page.getByRole('button', { name: 'Add to favorites', exact: true }).first().click();
    const icon = page.getByRole('button', { name: 'Page icon', exact: true });
    await icon.click();
    await page.getByRole('menuitem', { name: '🚀', exact: true }).click();
    await expect(icon).toContainText('🚀');
    await expect(page.locator('[data-wiki-row]')).toContainText('🚀');
    await expect(page.getByRole('region', { name: 'Favorites', exact: true })).toContainText('🚀');

    await page.getByRole('button', { name: 'Add tag', exact: true }).click();
    const newTag = page.getByRole('textbox', { name: 'New tag', exact: true });
    await newTag.fill('  Product  ');
    await newTag.press('Enter');
    await newTag.fill('Product');
    await newTag.press('Enter');
    await expect(page.getByRole('button', { name: 'Remove tag Product', exact: true })).toHaveCount(1);
    await newTag.fill('团队文档');
    await newTag.press('Tab');
    await expect(page.getByRole('button', { name: 'Remove tag 团队文档', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add tag', exact: true }).click();
    await newTag.fill('Discard me');
    await newTag.press('Escape');
    await expect(page.getByRole('button', { name: 'Remove tag Discard me', exact: true })).toHaveCount(0);

    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(value => value.includes('团队文档')))).toBe(true);
    await page.reload();
    await expect(icon).toContainText('🚀');
    await expect(page.locator('[data-wiki-row]')).toContainText('🚀');
    await expect(page.getByRole('button', { name: 'Remove tag Product', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove tag 团队文档', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Enable read-only lock', exact: true }).click();
    await expect(icon).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add tag', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove tag Product', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Unlock read-only', exact: true }).click();
    await page.getByRole('button', { name: 'Remove tag Product', exact: true }).click();
    await page.getByRole('button', { name: 'Remove tag 团队文档', exact: true }).click();
    await icon.click();
    await page.getByRole('button', { name: 'Remove icon', exact: true }).click();
    await expect(page.locator('[data-wiki-row]')).not.toContainText('🚀');
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(value => value.includes('团队文档')))).toBe(false);
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(value => value.includes('🚀')))).toBe(false);
    await page.reload();
    await expect(icon).toContainText('📄');
    await expect(page.locator('[data-wiki-row]')).not.toContainText('🚀');
    await expect(page.getByRole('button', { name: /^Remove tag / })).toHaveCount(0);
  });

  test(`${theme}: acknowledging metadata preserves the unpublished Wiki body across reload`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=workspace-isolation&theme=${theme}&locale=en-US`);
    const editor = page.getByRole('textbox', { name: 'Markdown body', exact: true });
    await editor.fill('Published body');
    await editor.press('Control+s');
    await page.evaluate(async () => {
      const path = '/src/components/wiki/wikiStore.ts';
      const { getWikiStorageKey } = await import(path);
      const key = getWikiStorageKey('A');
      const state = JSON.parse(localStorage.getItem(key)!);
      state.documents[0].version = 1;
      localStorage.setItem(key, JSON.stringify(state));
    });
    await page.reload();
    await editor.fill('Unpublished body remains a draft');
    await page.getByRole('button', { name: 'Add tag', exact: true }).click();
    await page.getByRole('textbox', { name: 'New tag', exact: true }).fill('Metadata');
    await page.getByRole('textbox', { name: 'New tag', exact: true }).press('Enter');
    await page.getByRole('textbox', { name: 'New tag', exact: true }).press('Escape');
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(value => value.includes('Metadata')))).toBe(true);
    await page.evaluate(async () => {
      const storePath = '/src/components/wiki/wikiStore.ts';
      const persistencePath = '/src/components/wiki/wikiPersistence.ts';
      const { getWikiStorageKey } = await import(storePath);
      const { WIKI_SAVE_EVENT } = await import(persistencePath);
      const key = getWikiStorageKey('A');
      const state = JSON.parse(localStorage.getItem(key)!);
      window.dispatchEvent(new CustomEvent(WIKI_SAVE_EVENT, { detail: { key, documents: state.documents.map((doc: any) => ({ ...doc, version: 2 })) } }));
    });
    await page.reload();
    await expect(editor).toHaveValue('Unpublished body remains a draft');
    await expect(page.getByRole('button', { name: 'Remove tag Metadata', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('Unpublished body remains a draft')))).toBe(false);
  });
}
