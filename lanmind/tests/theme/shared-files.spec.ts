import { expect, test } from '@playwright/test';

test('user share button opens a lazy directory tree and preserves nested paths', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=shares&theme=light');
  await page.getByRole('button').filter({ has: page.getByText('协作成员', { exact: true }) }).click();
  const launcher = page.getByRole('button', { name: '查看共享文件', exact: true });
  await launcher.click();
  const dialog = page.getByRole('dialog', { name: '协作成员的共享' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('接口说明.pdf', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '项目资料', exact: true }).click();
  await dialog.getByRole('button', { name: '加载更多', exact: true }).click();
  await dialog.getByRole('button', { name: '设计文档', exact: true }).click();
  await expect(dialog.getByText('接口说明.pdf', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '上传文件', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '下载 接口说明.pdf', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(launcher).toBeFocused();
});

test('writable folders allow creation and owner can revoke sharing', async ({ page }, info) => {
  await page.goto('/tests/theme/index.html?view=shares&theme=dark');
  await page.getByRole('button').filter({ has: page.getByText('协作成员', { exact: true }) }).click();
  await page.getByRole('button', { name: '查看共享文件', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '协作成员的共享' });
  await dialog.getByRole('button', { name: '交付收集', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '新建目录', exact: true }).click();
  await dialog.getByRole('textbox', { name: '目录名称' }).fill('本周交付');
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '本周交付', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('shared-files-dark.png') });
  await dialog.getByRole('button', { name: '关闭共享文件' }).click();
  await page.getByRole('button', { name: '我的共享', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '我的共享' });
  await expect(dialog.getByText('D:\\项目资料', { exact: true })).toBeVisible();
  await dialog.getByRole('combobox', { name: '项目资料的共享权限' }).selectOption('write');
  await expect(dialog.getByRole('combobox', { name: '项目资料的共享权限' })).toHaveValue('write');
  await expect(dialog.getByRole('combobox', { name: '说明.pdf的共享权限' })).toBeDisabled();
  await dialog.getByRole('button', { name: '停止共享', exact: true }).first().click();
  await expect(dialog.getByRole('combobox', { name: '项目资料的共享权限' })).toHaveCount(0);
});

test('offline errors are localized and share dialog fits a narrow window', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=shares&theme=light&locale=en-US&offline');
  await page.getByRole('button').filter({ has: page.getByText('协作成员', { exact: true }) }).click();
  await page.getByRole('button', { name: 'View shared files', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 740 });
  const dialog = page.getByRole('dialog', { name: 'Files shared by 协作成员' });
  await expect(dialog.getByRole('alert')).toContainText('offline or unreachable');
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole('button', { name: 'Close shared files' })).toBeVisible();
});
