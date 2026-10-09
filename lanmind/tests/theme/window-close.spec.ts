import { expect, test } from '@playwright/test';

for (const theme of ['titanium-light', 'navy-slate']) {
  test(`${theme}: close behavior defaults to tray and both choices survive reopening`, async ({ page }, info) => {
    await page.goto(`/tests/theme/index.html?view=window-close-settings&theme=${theme}`);
    const select = page.getByRole('button', { name: '关闭按钮行为', exact: true });
    await expect(select).toBeEnabled();
    await expect(select).toContainText('最小化到系统托盘');
    await select.click();
    const menu = page.getByRole('listbox', { name: '关闭按钮行为', exact: true });
    await expect(menu.getByRole('option')).toHaveCount(2);
    await menu.getByRole('option', { name: '退出程序', exact: true }).click();
    await expect(select).toBeEnabled();
    await expect(select).toContainText('退出程序');
    expect(await page.evaluate(() => (window as any).__windowCloseFixture.commands.filter((call: any) => call.command === 'set_close_button_behavior'))).toEqual([{ command: 'set_close_button_behavior', args: { behavior: 'exit' } }]);
    await page.reload();
    await expect(select).toBeEnabled();
    await expect(select).toContainText('退出程序');
    await select.click();
    await menu.getByRole('option', { name: '最小化到系统托盘', exact: true }).click();
    await expect(select).toContainText('最小化到系统托盘');
    await page.reload();
    await expect(select).toBeEnabled();
    await expect(select).toContainText('最小化到系统托盘');
    await page.screenshot({ path: info.outputPath('window-close-settings.png') });
  });
}

test('failed save preserves the active close behavior and allows retry', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=window-close-settings');
  const select = page.getByRole('button', { name: '关闭按钮行为', exact: true });
  await expect(select).toBeEnabled();
  await page.evaluate(() => { (window as any).__windowCloseFixture.failSaves = true; });
  await select.click();
  await page.getByRole('option', { name: '退出程序', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('保存关闭按钮行为失败');
  await expect(select).toBeEnabled();
  await expect(select).toContainText('最小化到系统托盘');
  expect(await page.evaluate(() => localStorage.getItem('test-close-button-behavior'))).toBeNull();
  await page.evaluate(() => { (window as any).__windowCloseFixture.failSaves = false; });
  await select.click();
  await page.getByRole('option', { name: '退出程序', exact: true }).click();
  await expect(select).toContainText('退出程序');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('read failure disables changes until the saved preference can be loaded', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('test-close-button-behavior', 'exit'));
  await page.goto('/tests/theme/index.html?view=window-close-settings&read-error=1');
  const select = page.getByRole('button', { name: '关闭按钮行为', exact: true });
  await expect(page.getByRole('alert')).toContainText('读取关闭按钮行为失败');
  await expect(select).toBeDisabled();
  await page.evaluate(() => { (window as any).__windowCloseFixture.failReads = false; });
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(select).toBeEnabled();
  await expect(select).toContainText('退出程序');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('browser settings show the default and disable the desktop preference', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=settings');
  const select = page.getByRole('button', { name: '关闭按钮行为', exact: true });
  await expect(select).toBeDisabled();
  await expect(select).toContainText('最小化到系统托盘');
  await expect(page.getByText('关闭按钮行为仅在桌面客户端中可用。', { exact: true })).toBeVisible();
});
