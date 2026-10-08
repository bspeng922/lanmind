import { expect, test, type Page } from '@playwright/test';

const reveals = (page: Page) => page.evaluate(() => (window as any).__appLockFixture.reveals);
const completions = (page: Page) => page.evaluate(() => (window as any).__appLockFixture.completions);
async function expectCompletion(page: Page, expected: unknown) {
  // IPC promises commit React state between clock steps. Continue painting the
  // final frames while the simulated clock is paused, just as a real window does.
  await expect.poll(async () => { await page.clock.runFor(100); return completions(page); }).toEqual([expected]);
}
async function expectSplash(page: Page) {
  await expect(page.locator('#app-splash')).toBeVisible();
  expect(await page.evaluate(() => Boolean(document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#app-splash')))).toBe(true);
  await expect(page.getByText('正在读取锁定状态')).toHaveCount(0);
}
async function open(page: Page, query: string, theme = 'titanium-light') {
  await page.clock.install({ time: new Date('2026-10-08T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-08T12:00:01Z'));
  await page.goto(`/tests/theme/index.html?view=app-startup&theme=${theme}&${query}`);
  await page.clock.runFor(100);
  await expectSplash(page);
  await expect.poll(() => reveals(page)).toEqual([{ splashPresent: true, splashOnTop: true }]);
  expect(await completions(page)).toEqual([]);
}

for (const query of ['read-delay=0&session-delay=2500', 'read-delay=2500&session-delay=0']) {
  test(`startup keeps the branded splash over lock and identity initialization: ${query}`, async ({ page }) => {
    await open(page, query);
    await page.clock.runFor(1000);
    await expectSplash(page);
    expect(await completions(page)).toEqual([]);
    await page.clock.runFor(2000);
    await expectCompletion(page, { lockView: 'unlocked', sessionReady: true, splashRemoved: true, initializing: false });
    await expect(page.locator('#app-splash')).toHaveCount(0);
    await page.clock.runFor(3000);
    expect((await reveals(page)).length).toBe(1);
    expect((await completions(page)).length).toBe(1);
  });
}

test('fast startup still displays the splash briefly and reveals the window only once in StrictMode', async ({ page }) => {
  await open(page, 'read-delay=0&session-delay=0');
  await page.clock.runFor(400);
  await expectSplash(page);
  expect(await completions(page)).toEqual([]);
  await page.clock.runFor(300);
  await expect(page.locator('#app-splash')).toHaveCount(0);
  await expectCompletion(page, { lockView: 'unlocked', sessionReady: true, splashRemoved: true, initializing: false });
  await page.clock.runFor(3000);
  expect((await reveals(page)).length).toBe(1);
  expect((await completions(page)).length).toBe(1);
});

test('locked startup switches from the splash directly to the final password form', async ({ page }) => {
  await open(page, 'startup=locked&session-delay=20000');
  await page.clock.runFor(800);
  await expectCompletion(page, { lockView: 'locked', sessionReady: false, splashRemoved: true, initializing: false });
  const dialog = page.getByRole('dialog', { name: '程序锁定' });
  await expect(dialog.getByLabel('解锁密码', { exact: true })).toBeFocused();
  expect(await page.getByLabel('任务草稿').evaluate((node) => Boolean(node.closest('[inert]')))).toBe(true);
  await dialog.getByLabel('解锁密码', { exact: true }).fill('correct password');
  await dialog.getByRole('button', { name: '解锁', exact: true }).click();
  await page.clock.runFor(21000);
  expect((await reveals(page)).length).toBe(1);
  expect((await completions(page)).length).toBe(1);
});

test('transient startup failure stays behind the splash until the main view recovers', async ({ page }) => {
  await open(page, 'initial-read-error&session-delay=0');
  await page.clock.runFor(3000);
  await expectSplash(page);
  expect(await completions(page)).toEqual([]);
  await expect(page.locator('[data-app-lock-initializing]')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: '程序锁定' })).toHaveCount(0);
  await page.evaluate(() => { (window as any).__appLockFixture.failReads = false; });
  await page.clock.runFor(1200);
  await expectCompletion(page, { lockView: 'unlocked', sessionReady: true, splashRemoved: true, initializing: false });
});

test('persistent failure exits the splash into a protected retry page', async ({ page }) => {
  await open(page, 'initial-read-error&session-delay=20000');
  await page.clock.runFor(5500);
  await expectCompletion(page, { lockView: 'error', sessionReady: false, splashRemoved: true, initializing: false });
  const dialog = page.getByRole('dialog', { name: '程序锁定' });
  await expect(dialog.getByRole('alert')).toHaveText('无法读取本机锁定状态');
  await expect(page.locator('#app-splash')).toHaveCount(0);
  await page.evaluate(() => { (window as any).__appLockFixture.failReads = false; });
  await dialog.getByRole('button', { name: '重新读取' }).click();
  await expect(dialog).toHaveCount(0);
  await page.clock.runFor(21000);
  expect((await reveals(page)).length).toBe(1);
  expect((await completions(page)).length).toBe(1);
});

for (const theme of ['titanium-light', 'navy-slate']) {
  test(`${theme}: the real splash markup stays above the lock shield and matches the theme`, async ({ page }) => {
    await open(page, 'startup=locked&read-delay=1500', theme);
    const splash = page.locator('#app-splash');
    await expect(splash.getByText('智域协同', { exact: true })).toBeVisible();
    expect(await splash.locator('img').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
    expect(await splash.evaluate((node) => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)')).toBe(true);
    await page.screenshot({ path: `tests/theme/screenshots/startup-loading-${theme}.png` });
    await page.clock.runFor(1700);
    await expectCompletion(page, { lockView: 'locked', sessionReady: true, splashRemoved: true, initializing: false });
    await expect(splash).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '程序锁定' }).getByLabel('解锁密码', { exact: true })).toBeVisible();
    await page.screenshot({ path: `tests/theme/screenshots/startup-unlock-${theme}.png` });
  });
}
