import { expect, test } from '@playwright/test';
import { chooseWikiEditorMode, openWikiSource } from './wikiEditorHelpers';

test.setTimeout(90_000);

test('Edit and Source preserve unpublished content without extra modes', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?locale=en-US');
  const modes = page.getByRole('group', { name: 'Page mode', exact: true });
  await expect(modes.getByRole('button')).toHaveCount(2);
  await expect(modes.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^(Preview|Split|Live editing|Editor mode)$/ })).toHaveCount(0);
  await openWikiSource(page);
  await expect(modes.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(modes.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const body = page.getByRole('textbox', { name: 'Markdown body', exact: true });
  const markdown = '## Unpublished\n\n![Diagram](assets/missing.png)\n\n- [ ] Review';
  await body.fill(markdown);
  await chooseWikiEditorMode(page, 'live');
  await expect(page.locator('.vditor-ir h2')).toContainText('Unpublished');
  await expect(modes.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(modes.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await openWikiSource(page);
  await expect(body).toHaveValue(markdown);
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and publish', exact: true })).toHaveAttribute('title', /Save and publish/);
});

test('Chinese mode controls are labeled 编辑 and 源码', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?locale=zh-CN');
  const modes = page.getByRole('group', { name: '页面模式', exact: true });
  await expect(modes.getByRole('button')).toHaveText(['编辑', '源码']);
  await expect(page.getByRole('button', { name: /^(即时编辑|即时预览|预览|分屏|编辑模式)$/ })).toHaveCount(0);
});

for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`${theme}: discussion floats without shrinking the document, keeps drafts and supports replies`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/tests/theme/wiki.html?locale=en-US&theme=${theme}`);
    const canvas = page.locator('[data-wiki-edit-canvas]');
    await expect(canvas).toBeVisible();
    const before = await canvas.boundingBox();
    const trigger = page.getByRole('button', { name: 'Open discussion (0)', exact: true });
    await expect(page.getByRole('dialog', { name: 'Discussion', exact: true })).toHaveCount(0);
    await trigger.click();
    const discussion = page.getByRole('dialog', { name: /Discussion/, exact: false });
    const draft = discussion.getByRole('textbox', { name: 'Discussion message', exact: true });
    await expect(draft).toBeFocused();
    expect(await canvas.boundingBox()).toEqual(before);
    const box = (await discussion.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThan(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    await draft.fill('Unsent discussion draft');
    await draft.press('Escape');
    await expect(discussion).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(draft).toHaveValue('Unsent discussion draft');
    await draft.press('Control+Enter');
    await expect(discussion).toContainText('Unsent discussion draft');
    await expect(page.getByRole('button', { name: 'Open discussion (1)', exact: true })).toBeVisible();
    await discussion.getByRole('button', { name: "Quote Current user's comment", exact: true }).click();
    await draft.fill('A quoted reply');
    await discussion.getByRole('button', { name: 'Close discussion', exact: true }).click();
    await page.getByRole('button', { name: 'Open discussion (1)', exact: true }).click();
    await expect(draft).toHaveValue('A quoted reply');
    await expect(discussion.getByRole('button', { name: 'Cancel reply', exact: true })).toBeVisible();
    await draft.press('Control+Enter');
    await expect(discussion).toContainText('A quoted reply');
    await discussion.getByRole('button', { name: 'Delete comment', exact: true }).last().click();
    await expect(discussion).not.toContainText('A quoted reply');
    await page.reload();
    await page.getByRole('button', { name: 'Open discussion (1)', exact: true }).click();
    await expect(discussion).toContainText('Unsent discussion draft');
    await expect(draft).toHaveValue('');
    await page.getByRole('button', { name: 'Workspace B', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open discussion (0)', exact: true })).toBeVisible();
    await expect(discussion).toHaveCount(0);
  });
}
