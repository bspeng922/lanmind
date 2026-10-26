import { openWikiSource } from './wikiEditorHelpers';
import { expect, test } from '@playwright/test';
test.setTimeout(90_000);
import { readFile } from 'node:fs/promises';

for (const theme of ['light', 'dark']) {
  test(`${theme}: switching Wiki pages saves a draft to its original page`, async ({ page }) => {
    await page.goto(`/tests/theme/wiki.html?view=workspace-isolation&theme=${theme}&locale=en-US`, { waitUntil: 'domcontentloaded' });
    await openWikiSource(page);
    const title = page.getByRole('textbox', { name: 'Page title', exact: true });
    const editor = page.getByRole('textbox', { name: 'Markdown body', exact: true });
    await title.fill('Source page');
    await editor.fill('Source draft');
    await page.getByRole('button', { name: 'New page options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New top-level page', exact: true }).click();
    await openWikiSource(page);
    await expect(editor).toHaveValue('');
    await title.fill('Target page');
    await editor.fill('Target content');
    await editor.press('Control+s');
    await page.getByText('Source page', { exact: true }).click();
    await expect(editor).toHaveValue('Source draft');
    await page.getByText('Target page', { exact: true }).click();
    await expect(editor).toHaveValue('Target content');
  });

  test(`${theme}: Wiki conflict survives remount and exports pending edits before reload`, async ({ page }) => {
    await page.goto(`/tests/theme/wiki.html?view=workspace-isolation&theme=${theme}&locale=en-US`, { waitUntil: 'domcontentloaded' });
    await openWikiSource(page);
    const editor = page.getByRole('textbox', { name: 'Markdown body', exact: true });
    await editor.fill('Local draft');
    await editor.press('Control+s');
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(value => value.includes('Local draft')))).toBe(true);
    await page.evaluate(async () => {
      const path = '/src/components/wiki/wikiStore.ts';
      const { getWikiStorageKey } = await import(path);
      const key = getWikiStorageKey('A');
      localStorage.setItem(`${key}:save-error`, 'VERSION_CONFLICT');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openWikiSource(page);
    await expect(page.getByRole('alert')).toContainText('VERSION_CONFLICT');
    await expect(editor).toHaveValue('Local draft');
    await page.evaluate(async () => {
      const storePath = '/src/components/wiki/wikiStore.ts';
      const apiPath = '/src/services/api.ts';
      const { getWikiStorageKey } = await import(storePath);
      const { ApiService } = await import(apiPath);
      const latest = JSON.parse(localStorage.getItem(getWikiStorageKey('A'))!);
      latest.documents = latest.documents.map((doc: any) => ({ ...doc, content: 'External accepted content', version: 99 }));
      ApiService.getWorkspaceData = async () => latest;
    });
    await editor.fill('Newest draft still in debounce');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export draft', exact: true }).click();
    const download = await downloaded;
    const content = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(content.documents.some((doc: any) => doc.content === 'Newest draft still in debounce')).toBe(true);
    await page.getByRole('button', { name: 'Load latest pages', exact: true }).click();
    await expect(editor).toHaveValue('External accepted content');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.endsWith(':save-error')))).toBe(false);
  });
}
