import { expect, type Page } from '@playwright/test';

export async function openWikiSource(page: Page) {
  await chooseWikiEditorMode(page, 'edit');
}

export async function chooseWikiEditorMode(page: Page, mode: 'live' | 'edit') {
  await expect(page.locator('.wiki-markdown-editor')).toHaveAttribute('data-editor-ready', 'true', { timeout: 20000 });
  await page.getByRole('group', { name: 'Page mode', exact: true }).getByRole('button', {
    name: { live: 'Edit', edit: 'Source' }[mode], exact: true,
  }).click();
  await expect(page.locator('.wiki-markdown-editor')).toHaveAttribute('data-editor-mode', mode);
}
