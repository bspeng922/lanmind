import { expect, test, type Page } from '@playwright/test';

const dialog = (page: Page) => page.getByRole('alertdialog', { name: '删除任务', exact: true });
const card = (page: Page, id = 'task-0') => page.locator(`.task-list-card[data-task-id="${id}"]`);
async function openDelete(page: Page, id = 'task-0') {
  await card(page, id).getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除任务', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}

test('personal and project task deletion can be cancelled without deleting parent or children', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-deletion&theme=light');
  await openDelete(page);
  await expect(dialog(page)).toContainText('整理项目资料');
  await expect(dialog(page)).toContainText('默认保留为独立任务');
  await expect(dialog(page).getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(card(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__taskDeletionFixture.deletedIds)).toEqual([]);
  await page.locator('[data-project-drag-id="theme-project"]').click();
  await openDelete(page);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(card(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__taskDeletionFixture.deletedIds)).toEqual([]);
});

test('confirming deletion preserves children by default and reports failures for retry', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-deletion&theme=dark');
  await openDelete(page);
  await page.evaluate(() => { (window as any).__taskDeletionFixture.failDelete = true; });
  await dialog(page).getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(dialog(page).getByRole('alert')).toContainText('删除失败');
  await expect(card(page)).toBeVisible();
  await page.evaluate(() => { (window as any).__taskDeletionFixture.failDelete = false; });
  await dialog(page).getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  await expect(card(page, 'delete-child')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__taskDeletionFixture.deletedIds)).toEqual(['task-0']);
});

test('project deletion can include children and the confirmation fits a narrow dark viewport', async ({ page }, info) => {
  await page.goto('/tests/theme/index.html?view=task-deletion&theme=dark');
  await page.locator('[data-project-drag-id="theme-project"]').click();
  await openDelete(page);
  await page.setViewportSize({ width: 390, height: 700 });
  const checkbox = dialog(page).getByRole('checkbox', { name: '同时将这 1 个子任务移入回收站' });
  await dialog(page).locator('label').filter({ has: page.getByRole('checkbox', { name: '同时将这 1 个子任务移入回收站' }) }).click();
  await expect(checkbox).toBeChecked();
  expect(await dialog(page).evaluate((node) => { const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && node.scrollWidth <= node.clientWidth; })).toBe(true);
  await page.screenshot({ path: info.outputPath('delete-confirmation.png') });
  await dialog(page).getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__taskDeletionFixture.deletedIds)).toEqual(['delete-child', 'task-0']);
});

test('cancelling a deletion from task details keeps the editor open', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-deletion&theme=light');
  await card(page).locator('.task-card-title').click();
  const editor = page.getByRole('dialog', { name: '编辑任务', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除任务', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(card(page)).toBeVisible();
  await editor.getByRole('button', { name: '更多操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '删除任务', exact: true }).click();
  await dialog(page).getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
});

test('a task without children sends one deletion request and locks confirmation while it is pending', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-deletion&theme=light');
  await page.evaluate(() => { (window as any).__taskDeletionFixture.blockDelete = true; });
  await openDelete(page, 'task-1');
  await expect(dialog(page).getByRole('checkbox')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: '移入回收站', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: '正在移入…', exact: true })).toBeDisabled();
  await expect(dialog(page).getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).__taskDeletionFixture.attempts)).toBe(1);
  await page.evaluate(() => (window as any).__taskDeletionFixture.releaseDelete());
  await expect(dialog(page)).toHaveCount(0);
  await expect(card(page, 'task-1')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__taskDeletionFixture.deletedIds)).toEqual(['task-1']);
});
