import { test, expect } from '@playwright/test';

test('successful installation messages expire and old successes stay hidden on reentry', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US&completed');
  const notification = page.locator('[data-plugin-job="install-one"]');
  await expect(page.locator('article')).toBeVisible();
  await expect(notification).toHaveCount(0);
  await page.clock.install({ time: new Date('2026-11-09T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-09T12:00:01Z'));
  await page.evaluate(() => (window as any).__pluginProgress('installed'));
  await expect(notification).toBeVisible();
  await page.clock.fastForward(4900);
  await expect(notification).toBeVisible();
  await page.clock.fastForward(200);
  await expect(notification).toHaveCount(0);
  await page.clock.resume();
  await page.reload();
  await expect(page.locator('article')).toBeVisible();
  await expect(notification).toHaveCount(0);
  await page.evaluate(() => (window as any).__pluginProgress('failed'));
  await expect(notification).toBeVisible();
  await page.clock.fastForward(10_000);
  await expect(notification).toBeVisible();
});

test('installed plugin shortcuts launch with host context and follow installation lifecycle', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US&rail&empty');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  const shortcut = nav.getByRole('button', { name: 'Hello Tools', exact: true });
  await expect(shortcut).toHaveCount(0);
  await page.evaluate(() => (window as any).__pluginInstall());
  await expect(shortcut).toBeVisible();
  await expect.poll(() => shortcut.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => page.locator('article [data-plugin-icon] img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__pluginHoldOpen());
  await shortcut.click();
  await expect(shortcut).toBeDisabled();
  await expect.poll(() => page.evaluate(() => (window as any).__pluginCalls.filter((call: any) => call.action === 'open').length)).toBe(1);
  await page.evaluate(() => (window as any).__pluginReleaseOpen());
  await expect(shortcut).toBeEnabled();
  const opened = await page.evaluate(() => (window as any).__pluginCalls.find((call: any) => call.action === 'open').payload);
  expect(opened.pluginKey).toBe('a'.repeat(64) + '/hello');
  expect(opened.locale).toBe('en-US');
  expect(['light', 'dark']).toContain(opened.theme.id);
  await expect(page.getByRole('tab', { name: 'Installed', exact: true })).toHaveAttribute('aria-selected', 'true');
  const enabled = page.getByRole('switch', { name: 'Enable Hello Tools', exact: true });
  await enabled.click(); await expect(shortcut).toHaveCount(0);
  await enabled.click(); await expect(shortcut).toBeVisible();
  await page.evaluate(() => (window as any).__pluginState({ available: false }));
  await expect(shortcut).toHaveCount(0);
  await page.evaluate(() => (window as any).__pluginState({ available: true }));
  await expect(shortcut).toBeVisible();
  await page.locator('article').getByRole('button', { name: 'Uninstall', exact: true }).click();
  await page.mouse.click(4, 4);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Uninstall', exact: true }).click();
  await expect(shortcut).toHaveCount(0);
  await expect(nav.getByRole('group', { name: 'Installed plugins' })).toHaveCount(0);
});

test('plugin shortcuts handle launch failures and application lock changes', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US&rail');
  const shortcut = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Hello Tools', exact: true });
  await page.evaluate(() => (window as any).__pluginOpenError('PLUGIN_SESSION'));
  await shortcut.click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => (window as any).__pluginLock(true));
  await expect(shortcut).toHaveCount(0);
  await page.evaluate(() => (window as any).__pluginLock(false));
  await expect(shortcut).toBeEnabled();
});

for (const fixture of ['no-icon', 'bad-icon', 'external-icon']) {
  test(`plugin icons fall back safely for ${fixture}`, async ({ page }) => {
    let probes = 0;
    await page.route('**/__plugin_icon_probe__', route => { ++probes; return route.abort(); });
    await page.goto(`/tests/theme/plugins.html?locale=en-US&rail&${fixture}`);
    await expect(page.locator('article [data-plugin-icon] svg')).toBeVisible();
    await expect(page.locator('article [data-plugin-icon] img')).toHaveCount(0);
    await expect(page.locator('[data-plugin-shortcut] [data-plugin-icon] svg')).toBeVisible();
    expect(probes).toBe(0);
  });
}

test('SVG icons render as images without scripts or external resource requests', async ({ page }) => {
  let probes = 0;
  await page.route('**/__plugin_icon_probe__', route => { ++probes; return route.abort(); });
  await page.goto('/tests/theme/plugins.html?locale=en-US&rail&unsafe-icon');
  await expect(page.locator('article [data-plugin-icon] img')).toHaveJSProperty('naturalWidth', 64);
  expect(await page.evaluate(() => (window as any).__pluginIconExecuted)).toBeUndefined();
  expect(probes).toBe(0);
});

test('plugin shortcuts scroll without a scrollbar while core navigation stays fixed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1100, height: 440 });
  await page.goto('/tests/theme/plugins.html?locale=en-US&rail&many');
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  const core = nav.getByRole('button', { name: 'All tasks', exact: true });
  const corePosition = await core.boundingBox();
  const scroller = nav.locator('[data-plugin-scroll]');
  await expect(scroller).toHaveCSS('scrollbar-width', 'none');
  const down = nav.getByRole('button', { name: 'Scroll plugins down', exact: true });
  const up = nav.getByRole('button', { name: 'Scroll plugins up', exact: true });
  await expect(down).toBeVisible();
  await expect(up).toBeHidden();
  await down.click();
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(up).toBeVisible();
  const beforeWheel = await scroller.evaluate(element => element.scrollTop);
  await scroller.hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(beforeWheel);
  await scroller.focus();
  await page.keyboard.press('End');
  const last = nav.getByRole('button', { name: 'Tool 24', exact: true });
  await expect(last).toBeInViewport();
  await expect(core).toBeInViewport();
  expect((await core.boundingBox())?.y).toBe(corePosition?.y);
  await expect(page.locator('.app-rail').getByRole('button', { name: 'Settings', exact: true })).toBeInViewport();
  await page.keyboard.press('Home');
  await expect(nav.getByRole('button', { name: 'Tool 1', exact: true })).toBeInViewport();
  await expect(up).toBeHidden();
  await page.setViewportSize({ width: 1100, height: 1500 });
  await expect(down).toHaveCount(0);
});

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

test('unsigned plugins remain marked unsigned when requesting business access', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US&unsigned');
  await expect(page.getByRole('tab', { name: 'Installed', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__pluginPermission());
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Unsigned · Source unverified', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Valid signature · unverified publisher', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('permission details support revocation and empty states are translated', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US');
  await page.locator('article').getByRole('button', { name: 'Plugin details', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Authorized in this workspace', { exact: true })).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0);
  await page.locator('article').getByRole('button', { name: 'Plugin details', exact: true }).click();
  await dialog.getByRole('button', { name: 'Revoke', exact: true }).click(); await expect(dialog.getByRole('button', { name: 'Revoke', exact: true })).toHaveCount(0);
  await page.goto('/tests/theme/plugins.html?empty'); await expect(page.getByText('尚未安装插件', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '插件市场', exact: true }).click(); await expect(page.getByText('局域网中暂无可用插件', { exact: true })).toBeVisible();
});

test('unsigned source ZIP requires confirmation bound to its preview hash', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US&unsigned');
  await expect(page.locator('article').getByText('Unsigned · Source unverified')).toBeVisible();
  await page.getByRole('button', { name: 'Import package', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Install unsigned plugin?');
  await page.mouse.click(4, 4);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('replaces the unsigned plugin');
  expect(await page.evaluate(() => (window as any).__pluginCalls.filter((call: any) => call.action === 'import'))).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__pluginCalls.filter((call: any) => call.action === 'import'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Import package', exact: true }).click();
  await dialog.getByRole('button', { name: 'Install unsigned plugin', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__pluginCalls.find((call: any) => call.action === 'import').payload)).toEqual({ path: '/downloads/block-breeze-main.zip', expectedSha256: '4'.repeat(64), allowUnsigned: true });
});

test('unsigned LAN packages require confirmation and signed imports do not', async ({ page }) => {
  await page.goto('/tests/theme/plugins.html?locale=en-US&unsigned');
  await page.getByRole('tab', { name: 'Plugin marketplace', exact: true }).click();
  await page.locator('article').getByRole('button', { name: 'Update', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('no publisher signature');
  expect(await page.evaluate(() => (window as any).__pluginCalls.filter((call: any) => call.action === 'install'))).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Install unsigned plugin', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__pluginCalls.find((call: any) => call.action === 'install').payload.allowUnsigned)).toBe(true);
  await page.goto('/tests/theme/plugins.html?locale=en-US');
  await page.getByRole('button', { name: 'Import package', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__pluginCalls.filter((call: any) => call.action === 'import').length)).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__pluginCalls.find((call: any) => call.action === 'import').payload)).toEqual({ path: '/downloads/block-breeze-main.zip', expectedSha256: '4'.repeat(64) });
});
