import { test, expect } from '@playwright/test';

test('marketplace groups LAN sources, starts an installation and exposes cancellation', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US');
  await page.getByRole('tab', { name: 'Plugin marketplace', exact: true }).click();
  const card = page.locator('article').filter({ hasText: 'Hello Tools' });
  await expect(card).toHaveCount(1); await expect(card.getByText('2 LAN sources')).toBeVisible(); await expect(card.getByText('LAN source', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Installation cancelled', { exact: false })).toBeVisible();
  const install = await page.evaluate(() => (window as any).__pluginCalls.find((call: any) => call.action === 'install'));
  expect(install.payload).toEqual({ pluginKey: 'a'.repeat(64) + '/hello', sha256: '2'.repeat(64) });
});

test('conflicting versions cannot be installed and source details remain visible', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US&conflict');
  await page.getByRole('tab', { name: 'Plugin marketplace', exact: true }).click();
  await page.getByRole('button', { name: 'View versions', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('different packages'); await expect(dialog.getByRole('button', { name: 'Update', exact: true })).toBeDisabled();
  await expect(dialog.getByText('Node One · 192.168.1.10')).toBeVisible(); await expect(dialog.getByText('Node Two · 192.168.1.11')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
});

test('sharing and plugin enablement are independent; uninstall keeps data by default', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US');
  const card = page.locator('article').filter({ hasText: 'Hello Tools' });
  const enabled = card.getByRole('switch', { name: 'Enable Hello Tools', exact: true });
  await enabled.click(); await expect(enabled).not.toBeChecked();
  await expect(card.getByRole('switch', { name: 'Share this package Hello Tools' })).toBeChecked();
  await card.getByRole('button', { name: 'Uninstall', exact: true }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('dialog').getByRole('button', { name: 'Uninstall', exact: true }).click();
  await expect(page.getByText('No plugins installed', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__pluginCalls.find((call: any) => call.action === 'uninstall').payload.clearData)).toBe(false);
});

test('business access is requested in the trusted host and discarded on workspace change', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US');
  await expect(page.getByRole('tab', { name: 'Installed', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__pluginPermission());
  const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Workspace A'); await expect(dialog).toContainText('Create and modify tasks');
  await dialog.getByRole('button', { name: 'Allow', exact: true }).click(); await expect(dialog).toHaveCount(0);
  await page.evaluate(() => (window as any).__pluginPermission()); await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as any).__pluginWorkspaceChanged()); await expect(dialog).toHaveCount(0);
});

test('permission details support revocation and empty states are translated', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US');
  await page.locator('article').getByRole('button', { name: 'Plugin details', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Authorized in this workspace', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click(); await expect(dialog.getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0);
  await page.goto('/tests/theme/plugins.html?empty'); await expect(page.getByText('尚未安装插件', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '插件市场', exact: true }).click(); await expect(page.getByText('局域网中暂无可用插件', { exact: true })).toBeVisible();
});
