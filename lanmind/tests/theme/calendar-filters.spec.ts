import { expect, test, type Page } from '@playwright/test';

const filters = (page: Page) => page.getByRole('dialog', { name: '任务排序和过滤', exact: true });
const calendar = (page: Page) => page.locator('.calendar-view');
const completed = (page: Page) => calendar(page).getByText('完成联调验证', { exact: true });

async function openCalendar(page: Page, fixture = 'project-layout') {
  await page.clock.setFixedTime(new Date('2026-09-14T12:00:00Z'));
  await page.goto(`/tests/theme/index.html?view=${fixture}&theme=titanium-light#calendar`);
  await expect(calendar(page)).toBeVisible();
}

async function openFilters(page: Page) {
  await page.getByRole('button', { name: '排序和过滤', exact: true }).click();
}

test('personal calendar and list share completed preferences and allow explicit status review', async ({ page }) => {
  await openCalendar(page);
  await expect(completed(page)).toHaveCount(0);
  await expect(calendar(page).getByText(/未排期/)).toHaveCount(0);
  await openFilters(page);
  await filters(page).getByRole('switch', { name: '显示已完成的任务' }).click();
  await calendar(page).locator('h2').click();
  await calendar(page).getByRole('button', { name: '查看 2026-09-14 的任务', exact: true }).click();
  await expect(completed(page).last()).toBeVisible();
  await expect(calendar(page).getByText('共 4 项', { exact: true })).toBeVisible();
  await page.getByTitle('关闭当天任务', { exact: true }).click();

  await page.getByRole('button', { name: /全部任务/ }).click();
  await expect(page.locator('main').getByRole('button', { name: '完成联调验证', exact: true })).toBeVisible();
  await openFilters(page);
  await filters(page).getByRole('switch', { name: '显示已完成的任务' }).click();
  await page.getByRole('button', { name: /日历视图/ }).click();
  await expect(completed(page)).toHaveCount(0);
  await openFilters(page);
  await filters(page).getByRole('button', { name: '任务状态', exact: true }).click();
  await page.getByRole('listbox', { name: '任务状态' }).getByRole('option', { name: '已完成', exact: true }).click();
  await expect(completed(page)).toBeVisible();
  await expect(calendar(page).getByText('整理项目资料', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(completed(page)).toBeVisible();

  await openFilters(page);
  await filters(page).getByRole('button', { name: '任务状态', exact: true }).click();
  await page.getByRole('listbox', { name: '任务状态' }).getByRole('option', { name: '全部', exact: true }).click();
  await page.getByRole('listbox', { name: '任务状态' }).getByRole('option', { name: '已放弃', exact: true }).click();
  await expect(calendar(page).getByText('无截止日期 1', { exact: true })).toBeVisible();
  await expect(completed(page)).toHaveCount(0);
});

test('completing a task removes it from the calendar and day details until completed tasks are shown', async ({ page }) => {
  await openCalendar(page, 'task-detail');
  await calendar(page).getByRole('button', { name: '查看 2026-09-14 的任务', exact: true }).click();
  await expect(calendar(page).getByText('共 3 项', { exact: true })).toBeVisible();
  await page.getByTitle('完成任务', { exact: true }).click();
  await expect(calendar(page).getByText('检查明亮主题', { exact: true })).toHaveCount(0);
  await expect(calendar(page).getByText('共 2 项', { exact: true })).toBeVisible();
  await page.getByTitle('关闭当天任务', { exact: true }).click();
  await openFilters(page);
  await filters(page).getByRole('switch', { name: '显示已完成的任务' }).click();
  await calendar(page).locator('h2').click();
  await calendar(page).getByRole('button', { name: '查看 2026-09-14 的任务', exact: true }).click();
  await expect(calendar(page).getByText('检查明亮主题', { exact: true }).last()).toBeVisible();
  await expect(calendar(page).getByText('共 4 项', { exact: true })).toBeVisible();
});
