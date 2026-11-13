import { expect, test, type Locator, type Page } from '@playwright/test';

const open = async (page: Page, view: string, theme: string) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/tests/theme/index.html?view=${view}&theme=${theme}&locale=zh-CN`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
};

async function fitsHorizontally(locator: Locator) {
  await expect.poll(() => locator.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
}

async function isInsideViewport(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
}

for (const theme of ['light', 'dark']) {
  for (const view of ['wiki-preview', 'ai-agent']) {
    test(`${theme}: ${view} content expands with the window and fits narrow screens`, async ({ page }, info) => {
      await page.setViewportSize({ width: 1024, height: 1000 });
      await open(page, view, theme);
      const isWiki = view === 'wiki-preview';
      const content = page.locator(isWiki ? '.wiki-document' : '.ai-message-list');
      await expect(content).toBeVisible();
      if (isWiki) {
        await expect(page.locator('.wiki-markdown-editor .vditor')).toBeVisible();
        await expect(content).not.toHaveAttribute('data-full-width');
      } else {
        await page.locator('.ai-composer textarea').fill('请检查对话内容的自适应排版。'.repeat(20));
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await expect(page.locator('[data-message-role="assistant"] .markdown-body p').first()).toBeVisible();
      }
      const initialWidth = (await content.boundingBox())!.width;
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect.poll(async () => (await content.boundingBox())!.width).toBeGreaterThan(initialWidth + 250);
      expect((await content.boundingBox())!.width).toBeGreaterThan(1000);
      if (!isWiki) {
        expect((await page.locator('[data-message-role="assistant"] .markdown-body p').first().boundingBox())!.width).toBeGreaterThan(960);
      }
      await page.setViewportSize({ width: 1920, height: 1000 });
      const wideWidth = (await content.boundingBox())!.width;
      expect(wideWidth).toBeGreaterThan(1200);
      await page.screenshot({ path: info.outputPath(`${view}-wide.png`) });
      if (isWiki) {
        await page.getByRole('button', { name: '宽屏铺满', exact: true }).click();
        await expect(content).toHaveAttribute('data-full-width');
        expect((await content.boundingBox())!.width).toBeGreaterThan(wideWidth + 200);
        await page.getByRole('button', { name: '标准宽度', exact: true }).click();
      } else {
        const composer = (await page.locator('.ai-composer').boundingBox())!;
        const messages = (await content.boundingBox())!;
        expect(composer.x).toBeCloseTo(messages.x, 0);
        expect(composer.width).toBeCloseTo(messages.width, 0);
      }
      await page.setViewportSize({ width: 2560, height: 1000 });
      expect((await content.boundingBox())!.width).toBeCloseTo(wideWidth, 0);
      await page.setViewportSize({ width: 390, height: 900 });
      await fitsHorizontally(page.locator(isWiki ? '.wiki-workspace' : '.ai-workspace-layout'));
      await fitsHorizontally(content);
      const narrow = (await content.boundingBox())!;
      expect(narrow.x).toBeGreaterThanOrEqual(0);
      expect(narrow.x + narrow.width).toBeLessThanOrEqual(390);
      await page.screenshot({ path: info.outputPath(`${view}-narrow.png`) });
    });
  }

  test(`${theme}: settings navigation remains scrollable vertically and horizontally`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1024, height: 540 });
    await open(page, 'settings&tab=models', theme);
    const navigation = page.locator('.settings-navigation');
    const lastCategory = navigation.getByRole('button').last();
    await expect.poll(() => navigation.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
    await lastCategory.focus();
    await expect(lastCategory).toBeInViewport();
    await lastCategory.click();
    await expect(lastCategory).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: info.outputPath('settings-navigation-vertical.png') });
    await page.setViewportSize({ width: 390, height: 900 });
    await expect.poll(() => navigation.evaluate(node => node.scrollWidth - node.clientWidth)).toBeGreaterThan(0);
    await navigation.getByRole('button').first().focus();
    await expect(navigation.getByRole('button').first()).toBeInViewport();
    await lastCategory.focus();
    await expect(lastCategory).toBeInViewport();
    await page.screenshot({ path: info.outputPath('settings-navigation-horizontal.png') });
  });

  for (const width of [320, 780, 1440]) {
    test(`${theme}/${width}: provider settings reflow and retain usable actions`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, 'settings&tab=models', theme);
      const content = page.locator('.provider-settings');
      await expect(content).toBeVisible();
      await fitsHorizontally(content);
      await fitsHorizontally(page.locator('.settings-shell'));
      await fitsHorizontally(page.locator('.provider-presets'));
      const anthropic = page.locator('.provider-presets button').filter({ hasText: 'Anthropic' });
      await anthropic.click();
      const editor = page.locator('.provider-editor');
      await isInsideViewport(editor, page);
      await fitsHorizontally(editor);
      await fitsHorizontally(page.locator('.provider-editor-fields'));
      await expect(editor.getByRole('button', { name: '保存供应商', exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath('provider-editor.png') });
    });
  }

  for (const view of ['ai-agent', 'chat', 'wiki-preview', 'workspace-dissolution']) {
    test(`${theme}: ${view} stays usable at narrow width and 200% text size`, async ({ page }, info) => {
      await page.setViewportSize({ width: 390, height: 900 });
      await open(page, view, theme);
      if (view === 'ai-agent') {
        await expect(page.locator('.ai-v2')).toBeVisible();
        await page.addStyleTag({ content: ':root { font-size: 200%; }' });
        await fitsHorizontally(page.locator('.ai-workspace-layout'));
        await isInsideViewport(page.locator('.ai-composer textarea'), page);
        await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
      } else if (view === 'chat') {
        await expect(page.locator('.lan-chat-dialog')).toBeVisible();
        await page.addStyleTag({ content: ':root { font-size: 200%; }' });
        await fitsHorizontally(page.locator('.lan-chat-layout'));
        await expect(page.getByRole('button', { name: '发送', exact: true })).toBeInViewport();
      } else if (view === 'wiki-preview') {
        await expect(page.locator('.wiki-page-tree')).toBeVisible();
        await page.addStyleTag({ content: ':root { font-size: 200%; }' });
        await fitsHorizontally(page.locator('.wiki-workspace'));
        await fitsHorizontally(page.locator('.wiki-topbar'));
        await expect(page.locator('[data-wiki-canvas]')).toBeInViewport();
      } else {
        await page.getByRole('button', { name: /用户与组织/ }).click();
        await page.addStyleTag({ content: ':root { font-size: 200%; }' });
        await fitsHorizontally(page.locator('.workspace-settings-panel'));
        await fitsHorizontally(page.locator('.workspace-organization'));
        await fitsHorizontally(page.locator('.workspace-organization-members'));
      }
      await page.screenshot({ path: info.outputPath(`${view}-large-text.png`) });
    });
  }

  test(`${theme}: main window and task actions reflow with 200% text`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, 'app', theme);
    await expect(page.locator('.task-list-card').first()).toBeVisible();
    await page.addStyleTag({ content: ':root { font-size: 200%; }' });
    for (const selector of ['.app-header', '.app-header-actions', '.task-list-toolbar', '.task-list-actions']) {
      await fitsHorizontally(page.locator(selector));
    }
    const overflowingCards = await page.locator('.task-card-heading').evaluateAll(elements =>
      elements.filter(el => el.scrollWidth > el.clientWidth + 1).length);
    expect(overflowingCards).toBe(0);
    const search = page.locator('.task-list-actions input');
    await fitsHorizontally(page.locator('.task-list-actions > div').first());
    await search.fill('整理');
    await expect(search).toHaveValue('整理');
    await expect(page.locator('.task-create-button').first()).toBeInViewport();
    await page.screenshot({ path: info.outputPath('main-window-large-text.png') });
  });

  test(`${theme}: report navigation and period labels remain readable with large text`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await open(page, 'report', theme);
    await expect(page.locator('.report-studio')).toBeVisible();
    await page.addStyleTag({ content: ':root { font-size: 200%; }' });
    await fitsHorizontally(page.locator('.report-studio-hero'));
    await fitsHorizontally(page.locator('.report-studio-hero .report-studio-tabs'));
    const presentation = page.locator('.report-studio-hero .report-studio-tab').last();
    await presentation.click();
    await expect(presentation).toHaveAttribute('data-active', 'true');
    const clipped = await page.locator('.report-studio-period > span').evaluateAll(elements =>
      elements.filter(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).length);
    expect(clipped).toBe(0);
    await page.screenshot({ path: info.outputPath('report-large-text.png') });
  });

  test(`${theme}: narrow vault keeps record creation, details and folders accessible with large text`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/tests/theme/vault.html?theme=${theme}&locale=en-US`);
    await page.getByLabel('Master password', { exact: true }).fill('layout fixture password');
    await page.getByLabel('Confirm password', { exact: true }).fill('layout fixture password');
    await page.getByRole('button', { name: 'Create vault', exact: true }).click();
    await expect(page.locator('.vault-record-list')).toBeVisible();
    await page.addStyleTag({ content: ':root { font-size: 200%; }' });
    await fitsHorizontally(page.locator('.vault-header'));
    await fitsHorizontally(page.locator('.vault-header h1'));
    await fitsHorizontally(page.locator('.vault-layout'));
    await fitsHorizontally(page.locator('.vault-record-list'));
    await page.getByRole('button', { name: 'New record', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'New record', exact: true });
    await fitsHorizontally(editor);
    await editor.getByLabel('Name', { exact: true }).fill('Layout sample');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Layout sample', exact: true })).toBeVisible();
    await fitsHorizontally(page.locator('.vault-record-detail'));
    await page.locator('.vault-record-back').click();
    const record = page.getByRole('button', { name: 'Layout sample', exact: false });
    await record.scrollIntoViewIfNeeded();
    await expect(record).toBeInViewport();
    await page.getByRole('button', { name: 'Trash', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Trash', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: info.outputPath('vault-large-text.png') });
  });
}

test('chat dialog can maximize and restore after responsive sizing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, 'chat', 'light');
  const dialog = page.locator('.lan-chat-dialog');
  await expect(dialog).toBeVisible();
  const initial = (await dialog.boundingBox())!;
  await dialog.locator('.lan-chat-header button').nth(1).click();
  await expect(dialog).toHaveAttribute('data-maximized', 'true');
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeGreaterThan(initial.width + 100);
  await expect.poll(async () => (await dialog.boundingBox())!.height).toBeGreaterThan(initial.height + 100);
  await dialog.locator('.lan-chat-header button').nth(1).click();
  await expect(dialog).not.toHaveAttribute('data-maximized');
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBeCloseTo(initial.width, 0);
});

test('shared text controls grow with user font preferences without clipping their labels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await open(page, 'settings&tab=models', 'light');
  await page.locator('.provider-presets button').filter({ hasText: 'Anthropic' }).click();
  const trigger = page.locator('.provider-editor .filter-select-trigger').first();
  const initialHeight = (await trigger.boundingBox())!.height;
  await page.addStyleTag({ content: ':root { font-size: 200%; }' });
  expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(initialHeight * 1.9);
  await fitsHorizontally(page.locator('.provider-editor-body'));
  const save = page.locator('.provider-editor').getByRole('button', { name: '保存供应商', exact: true });
  await expect(save).toBeInViewport();
  expect(await save.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
});
