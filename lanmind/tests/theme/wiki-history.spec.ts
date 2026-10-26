import { openWikiSource } from './wikiEditorHelpers';
import { expect, test, type Page } from '@playwright/test';
test.setTimeout(90_000);

const editor = (page: Page) => page.getByRole('textbox', { name: 'Markdown body', exact: true });
const openHistory = async (page: Page) => {
  await page.locator('button[title*="页面历史记录"], button[title*="Page history"], button[title*="history"]').click();
  return page.getByRole('dialog', { name: /页面历史记录|Page history/i });
};
const readHistory = (page: Page) => page.evaluate(async () => {
  const storePath = '/src/components/wiki/wikiStore.ts';
  const historyPath = '/src/components/wiki/wikiHistoryStore.ts';
  const { getWikiStorageKey } = await import(storePath);
  const { loadWikiRevisions } = await import(historyPath);
  const state = JSON.parse(localStorage.getItem(getWikiStorageKey('A'))!);
  const doc = state.documents.find((document: any) => document.id === state.selectedId);
  return { doc, revisions: loadWikiRevisions(doc.id, 'A') };
});
// Exercise the same acknowledgement event that carries the desktop backend's sync clock.
const acknowledgeVersion = (page: Page, version: number) => page.evaluate(async version => {
  const storePath = '/src/components/wiki/wikiStore.ts';
  const persistencePath = '/src/components/wiki/wikiPersistence.ts';
  const { getWikiStorageKey } = await import(storePath);
  const { WIKI_SAVE_EVENT } = await import(persistencePath);
  const key = getWikiStorageKey('A');
  const state = JSON.parse(localStorage.getItem(key)!);
  window.dispatchEvent(new CustomEvent(WIKI_SAVE_EVENT, { detail: {
    key,
    documents: state.documents.filter((doc: any) => doc.id === state.selectedId).map((doc: any) => ({ ...doc, version })),
  } }));
}, version);

test('history previews resolve images and downloadable attachments with Chinese filenames after reload', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?view=workspace-isolation&theme=light&locale=en-US', { waitUntil: 'domcontentloaded' });
  await openWikiSource(page);
  const markdown = await page.evaluate(async () => {
    const path = '/src/components/wiki/wikiAssetHelper.ts';
    const { wikiFilesMarkdown } = await import(path);
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    const markdown = await wikiFilesMarkdown([
      new File([png], '设计图.png', { type: 'image/png' }),
      new File(['Historical attachment'], '附件说明.txt', { type: 'text/plain' }),
      new File(['Special filename'], '计划(最终)#100%.txt', { type: 'text/plain' }),
    ]);
    const storePath = '/src/components/wiki/wikiAssetStore.ts';
    const { saveWikiAsset } = await import(storePath);
    const legacy = await saveWikiAsset(new File([png], '旧版插图.png', { type: 'image/png' }));
    return `${markdown}\n![旧版插图](${legacy.assetPath})\n\n[External asset](https://example.invalid/${legacy.assetPath})`;
  });
  await editor(page).fill(markdown);
  await editor(page).press('Control+s');
  await editor(page).fill('Current page without attachments');
  await editor(page).press('Control+s');
  const { revisions } = await readHistory(page);
  const historical = revisions.find((revision: any) => revision.content.includes('设计图'));
  expect(historical.content).not.toContain('blob:');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openWikiSource(page);
  const history = await openHistory(page);
  await history.getByRole('button', { name: `v. ${historical.version}`, exact: true }).click();
  const preview = page.getByRole('dialog').last();
  const image = preview.getByRole('img', { name: '设计图.png', exact: true });
  await expect(image).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
  await expect(preview.getByRole('img', { name: '旧版插图', exact: true })).toHaveAttribute('src', /^blob:/);
  const attachment = preview.getByRole('link', { name: '📎 附件说明.txt', exact: true });
  await expect(attachment).toHaveAttribute('href', /^blob:/);
  await expect(attachment).toHaveAttribute('download', '附件说明.txt');
  expect(await attachment.evaluate(async (node: HTMLAnchorElement) => (await fetch(node.href)).text())).toBe('Historical attachment');
  const special = preview.getByRole('link', { name: '📎 计划(最终)#100%.txt', exact: true });
  await expect(special).toHaveAttribute('download', '计划(最终)#100%.txt');
  expect(await special.evaluate(async (node: HTMLAnchorElement) => (await fetch(node.href)).text())).toBe('Special filename');
  const external = preview.getByRole('link', { name: 'External asset', exact: true });
  await expect(external).toHaveAttribute('href', /^https:\/\/example\.invalid\//);
  await expect(external).not.toHaveAttribute('download');
  await preview.getByRole('button', { name: 'Close version preview', exact: true }).click();
  await history.getByRole('button', { name: /Current \(v\./ }).click();
  await expect(page.getByRole('dialog').last().locator('.markdown-body')).toContainText('Current page without attachments');
  await expect(page.getByRole('dialog').last().getByRole('img')).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: Wiki history keeps old content and stable version labels after backend acknowledgement`, async ({ page }) => {
    await page.goto(`/tests/theme/wiki.html?view=workspace-isolation&theme=${theme}&locale=en-US`, { waitUntil: 'domcontentloaded' });
    await openWikiSource(page);
    await page.getByRole('textbox', { name: 'Page title', exact: true }).fill('Original title');
    await editor(page).fill('First published body');
    await editor(page).press('Control+s');
    await acknowledgeVersion(page, 1_800_000_000_000);
    await page.getByRole('textbox', { name: 'Page title', exact: true }).fill('Updated title');
    await editor(page).fill('Latest published body');
    await editor(page).press('Control+s');
    const published = await readHistory(page);
    expect(published.doc.version).toBe(1_800_000_000_000);
    await acknowledgeVersion(page, 1_800_000_001_000);
    const old = published.revisions.find((revision: any) => revision.content === 'First published body');
    const current = published.revisions[0];
    const history = await openHistory(page);
    await expect(history.getByRole('button', { name: new RegExp(`(当前|Current) \\(v\\. ${current.version}\\)`) })).toBeVisible();
    await expect(history.getByRole('button', { name: `v. ${current.version}`, exact: true })).toHaveCount(0);
    await history.getByRole('button', { name: `v. ${old.version}`, exact: true }).click();
    const preview = page.getByRole('dialog').last();
    await expect(preview.getByRole('heading', { name: 'Original title', exact: true })).toBeVisible();
    await expect(preview.locator('.markdown-body')).toContainText('First published body');
    await expect(preview).not.toContainText('Latest published body');
    await preview.getByRole('button', { name: /关闭版本预览|Close version preview/i }).click();
    await history.getByRole('button', { name: /关闭|Close/i, exact: true }).click();
    await editor(page).press('Control+s');
    expect((await readHistory(page)).revisions).toEqual(published.revisions);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openWikiSource(page);
    const reloaded = await openHistory(page);
    await expect(reloaded.getByRole('button', { name: new RegExp(`(当前|Current) \\(v\\. ${current.version}\\)`) })).toBeVisible();
  });

  test(`${theme}: Wiki page switching records an automatic save after the latest accepted content`, async ({ page }) => {
    await page.goto(`/tests/theme/wiki.html?view=workspace-isolation&theme=${theme}&locale=en-US`, { waitUntil: 'domcontentloaded' });
    await openWikiSource(page);
    await page.getByRole('textbox', { name: 'Page title', exact: true }).fill('Source page');
    await editor(page).fill('First body');
    await editor(page).press('Control+s');
    await acknowledgeVersion(page, 40);
    await editor(page).fill('Second published body');
    await editor(page).press('Control+s');
    await acknowledgeVersion(page, 47);
    await editor(page).fill('Automatically saved body');
    await page.getByRole('button', { name: 'New page options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New top-level page', exact: true }).click();
    await page.getByText('Source page', { exact: true }).click();
    await expect(editor(page)).toHaveValue('Automatically saved body');
    const { doc, revisions } = await readHistory(page);
    expect(doc.version).toBe(47);
    expect(revisions.map((revision: any) => revision.content)).toEqual([
      'Automatically saved body', 'Second published body', 'First body', '',
    ]);
    const history = await openHistory(page);
    await history.getByRole('button', { name: `v. ${revisions[1].version}`, exact: true }).click();
    await expect(page.getByRole('dialog').last().locator('.markdown-body')).toContainText('Second published body');
  });

  test(`${theme}: Wiki restoration preserves a visible draft backup and clears the restored draft`, async ({ page }) => {
    await page.goto(`/tests/theme/wiki.html?view=workspace-isolation&theme=${theme}&locale=en-US`, { waitUntil: 'domcontentloaded' });
    await openWikiSource(page);
    await editor(page).fill('First body');
    await editor(page).press('Control+s');
    await editor(page).fill('Second body');
    await editor(page).press('Control+s');
    const { revisions } = await readHistory(page);
    const first = revisions.find((revision: any) => revision.content === 'First body');
    await editor(page).fill('Unpublished draft to preserve');
    let history = await openHistory(page);
    await history.locator('tbody tr').filter({ has: page.getByRole('button', { name: `v. ${first.version}`, exact: true }) })
      .getByRole('button', { name: /恢复|Restore/i, exact: true }).click();
    await page.getByRole('button', { name: /确认恢复|Confirm restore/i, exact: true }).click();
    await expect(editor(page)).toHaveValue('First body');
    expect(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.includes('wiki-editor-draft:')))).toBe(false);
    const restored = await readHistory(page);
    const backup = restored.revisions.find((revision: any) => revision.content === 'Unpublished draft to preserve');
    expect(backup).toBeTruthy();
    expect(restored.revisions.filter((revision: any) => revision.content === 'First body')).toHaveLength(2);
    history = await openHistory(page);
    await history.getByRole('button', { name: `v. ${backup.version}`, exact: true }).click();
    const preview = page.getByRole('dialog').last();
    await expect(preview.locator('.markdown-body')).toContainText('Unpublished draft to preserve');
    await preview.getByRole('button', { name: /恢复此版本|Restore this version/i, exact: true }).click();
    await page.getByRole('button', { name: /确认恢复|Confirm restore/i, exact: true }).click();
    await expect(editor(page)).toHaveValue('Unpublished draft to preserve');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openWikiSource(page);
    await expect(editor(page)).toHaveValue('Unpublished draft to preserve');
  });
}
