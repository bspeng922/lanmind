import { expect, test } from '@playwright/test';

for (const kind of ['activity', 'sync']) {
  const title = kind === 'activity' ? '任务动态' : '增量同步日志';
  const refresh = kind === 'activity' ? '刷新任务动态' : '刷新同步日志';
  const record = (index: number) => kind === 'activity' ? `动态记录-${index}` : `任务记录-${index}`;

  test(`${kind}: pagination preserves its history while new records arrive and refresh returns to page one`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=${kind}-pages&theme=titanium-light`);
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    const pager = dialog.getByRole('navigation', { name: '记录分页' });
    await expect(pager).toContainText('共 45 条');
    await expect(pager).toContainText('第 1 / 3 页');
    const initialHeight = (await dialog.locator('section').boundingBox())!.height;
    await expect(dialog.getByText(record(45), { exact: kind === 'activity' })).toBeVisible();
    await expect(pager.getByRole('button', { name: '上一页' })).toBeDisabled();
    await page.evaluate(() => {
      const state = (window as any).__paginationFixture;
      state.entries.push({ ...state.entries[0], id: 'event-46', version: 46, entityId: '任务记录-46', payload: { taskId: state.entries[0].taskId, content: '动态记录-46' } });
    });
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect(pager).toContainText('第 2 / 3 页');
    await expect(dialog.getByText(record(25), { exact: kind === 'activity' })).toBeVisible();
    await expect(dialog.getByText(record(45), { exact: kind === 'activity' })).toHaveCount(0);
    await expect(pager).toContainText('共 45 条');
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect(pager).toContainText('第 3 / 3 页');
    await expect(pager.getByRole('button', { name: '下一页' })).toBeDisabled();
    await expect(dialog.getByText(record(5), { exact: kind === 'activity' })).toBeVisible();
    expect((await dialog.locator('section').boundingBox())!.height).toBe(initialHeight);
    await dialog.getByRole('button', { name: refresh }).click();
    await expect(pager).toContainText('第 1 / 3 页');
    await expect(pager).toContainText('共 46 条');
    await expect(dialog.getByText(record(46), { exact: kind === 'activity' })).toBeVisible();
    const requests = await page.evaluate(() => (window as any).__paginationFixture.requests);
    expect(requests.map((request: any) => [request.page, request.pageSize, request.snapshot])).toEqual([[1, 20, undefined], [2, 20, 45], [3, 20, 45], [1, 20, undefined]]);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '重新打开日志' }).click();
    await expect(pager).toContainText('第 1 / 3 页');
  });

  test(`${kind}: failed pages can retry and empty history has disabled paging`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=${kind}-pages&theme=navy-slate`);
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    const pager = dialog.getByRole('navigation', { name: '记录分页' });
    await expect(pager).toContainText('共 45 条');
    const initialHeight = (await dialog.locator('section').boundingBox())!.height;
    await page.evaluate(() => { (window as any).__paginationFixture.failPage = 2; });
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect(dialog.getByRole('alert')).toContainText('测试读取失败');
    expect((await dialog.locator('section').boundingBox())!.height).toBe(initialHeight);
    await page.evaluate(() => { (window as any).__paginationFixture.failPage = 0; });
    await dialog.getByRole('button', { name: '重试', exact: true }).click();
    await expect(pager).toContainText('第 2 / 3 页');
    await expect(dialog.getByText(record(25), { exact: kind === 'activity' })).toBeVisible();
    await page.evaluate(() => { (window as any).__paginationFixture.entries = []; });
    await dialog.getByRole('button', { name: refresh }).click();
    await expect(pager).toContainText('共 0 条');
    await expect(pager).toContainText('第 1 / 1 页');
    await expect(pager.getByRole('button', { name: '上一页' })).toBeDisabled();
    await expect(pager.getByRole('button', { name: '下一页' })).toBeDisabled();
    await expect(dialog.getByText(kind === 'activity' ? '暂无动态' : '暂无同步变动日志', { exact: true })).toBeVisible();
    expect((await dialog.locator('section').boundingBox())!.height).toBe(initialHeight);
  });

  for (const theme of ['titanium-light', 'navy-slate']) test(`${kind}: ${theme} paging remains visible on a narrow screen`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto(`/tests/theme/index.html?view=${kind}-pages&theme=${theme}`);
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    const pager = dialog.getByRole('navigation', { name: '记录分页' });
    await expect(pager).toContainText('共 45 条');
    expect(await dialog.locator('section').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && element.scrollWidth <= element.clientWidth;
    })).toBe(true);
    await pager.getByRole('button', { name: '下一页' }).click();
    await expect(pager).toContainText('第 2 / 3 页');
    await page.screenshot({ path: info.outputPath('pagination.png') });
  });
}

test('closing an activity request then opening another task resets paging and ignores the old response', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=activity-pages');
  const dialog = page.getByRole('dialog', { name: '任务动态', exact: true });
  await expect(dialog.getByRole('navigation')).toContainText('共 45 条');
  await page.evaluate(() => { (window as any).__paginationFixture.delayMs = 700; });
  await dialog.getByRole('button', { name: '下一页' }).click();
  await expect(dialog.getByRole('button', { name: '下一页' })).toBeDisabled();
  await dialog.getByRole('button', { name: '关闭任务动态' }).click();
  await page.evaluate(() => { (window as any).__paginationFixture.delayMs = 0; });
  await page.getByRole('button', { name: '查看另一任务动态' }).click();
  await expect(dialog.getByRole('navigation')).toContainText('第 1 / 3 页');
  await expect(dialog.getByText('检查明亮主题', { exact: true })).toBeVisible();
  await page.waitForTimeout(750);
  await expect(dialog.getByRole('navigation')).toContainText('第 1 / 3 页');
  await expect(dialog.getByText('动态记录-45', { exact: true })).toBeVisible();
  const last = await page.evaluate(() => (window as any).__paginationFixture.requests.at(-1));
  expect(last).toMatchObject({ page: 1, pageSize: 20 });
  expect(last.snapshot).toBeUndefined();
});
