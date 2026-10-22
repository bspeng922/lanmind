import { expect, test, type Page } from '@playwright/test';

async function remove(page: Page, withChildren = false) {
  const card = page.locator('.task-list-card[data-task-id="task-0"]');
  await card.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除任务', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '删除任务', exact: true });
  await expect(dialog).toContainText('保留 30 天');
  if (withChildren) await dialog.locator('label').click();
  await dialog.getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function openBin(page: Page) {
  await page.getByRole('button', { name: '任务回收站', exact: true }).click();
  await expect(page.locator('.task-recycle-view')).toBeVisible();
  await expect(page.locator('.recycle-list')).toHaveAttribute('aria-busy', 'false');
}

test('deleted task can be previewed, searched, filtered and restored from the sidebar', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-deletion&theme=light');
  await remove(page);
  await openBin(page);
  const row = page.locator('.recycle-row[data-task-id="task-0"]');
  await expect(row).toContainText('整理项目资料');
  await page.getByRole('textbox', { name: '搜索任务名称或编号…' }).fill('不存在');
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: '所属位置', exact: true }).click();
  await page.getByRole('option', { name: '个人任务', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: '所属位置', exact: true }).click();
  await page.getByRole('option', { name: '全部位置', exact: true }).click();
  await row.locator('.recycle-title').click();
  const preview = page.getByRole('dialog', { name: '已删除任务详情', exact: true });
  await expect(preview).toContainText('到期时间');
  await expect(preview.getByRole('textbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(row.locator('.recycle-title')).toBeFocused();
  await row.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.locator('.task-recycle-view').getByRole('status')).toContainText('任务已恢复');
  expect(await page.evaluate(() => (window as any).__taskDeletionFixture.tasks.some((t: any) => t.id === 'task-0'))).toBe(true);
});

test('project entry filters the shared bin and a deletion family can be restored together', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-deletion&theme=dark');
  await page.locator('[data-project-drag-id="theme-project"]').click();
  await remove(page, true);
  await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '任务回收站', exact: true }).click();
  await expect(page.getByRole('button', { name: '所属位置', exact: true })).toContainText('协作工作台');
  const row = page.locator('.recycle-row[data-task-id="task-0"]');
  await row.getByLabel('更多回收站操作').click();
  await row.getByRole('button', { name: '恢复同次删除的 2 项', exact: true }).click();
  await expect(page.locator('.recycle-row')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__taskDeletionFixture.tasks.find((t: any) => t.id === 'delete-child')?.parentTaskId)).toBe('task-0');
});

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`permanent deletion requires confirmation and fits ${theme} at ${width}px`, async ({ page }, info) => {
    await page.goto(`/tests/theme/index.html?view=task-deletion&theme=${theme}`);
    await remove(page);
    await openBin(page);
    await page.setViewportSize({ width, height: 900 });
    const row = page.locator('.recycle-row[data-task-id="task-0"]');
    await row.getByLabel('更多回收站操作').click();
    await row.getByRole('button', { name: '彻底删除', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '彻底删除任务', exact: true });
    await expect(dialog).toContainText('无法从回收站恢复');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await expect(row).toBeVisible();
    const overflow = await page.locator('.task-recycle-view,.recycle-row').evaluateAll((nodes) => nodes.some((n) => n.scrollWidth > n.clientWidth + 1));
    expect(overflow).toBe(false);
    await page.screenshot({ path: info.outputPath('task-recycle.png') });
    await row.getByLabel('更多回收站操作').click();
    await row.getByRole('button', { name: '彻底删除', exact: true }).click();
    await dialog.getByRole('button', { name: '彻底删除', exact: true }).click();
    await expect(row).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__taskRecycleFixture.size)).toBe(0);
  });
}
