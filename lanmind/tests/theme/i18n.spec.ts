import { expect, test, type Page } from '@playwright/test';

async function switchLanguage(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

for (const theme of ['titanium-light', 'navy-slate']) {
  test(`${theme}: switch languages immediately, persist and synchronize browser tabs`, async ({ page, context }) => {
    await page.goto(`/tests/theme/index.html?view=settings&theme=${theme}&locale=zh-CN`);
    await switchLanguage(page, '界面语言', 'English');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Settings categories' })).toBeVisible();
    const second = await context.newPage();
    await second.goto(`/tests/theme/index.html?view=settings&theme=${theme}`);
    await expect(second.locator('html')).toHaveAttribute('lang', 'en-US');
    await switchLanguage(second, 'Interface language', '简体中文');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('heading', { name: '系统设置', exact: true })).toBeVisible();
  });
}

test('English settings and dropdown options fit a smaller window', async ({ page }, info) => {
  await page.setViewportSize({ width: 780, height: 600 });
  await page.goto('/tests/theme/index.html?view=settings&locale=en-US');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Interface language', exact: true }).click();
  const options = page.getByRole('listbox', { name: 'Interface language' });
  await expect(options.getByRole('option', { name: 'Follow system' })).toBeVisible();
  expect(await options.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
  })).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.settings-navigation button span').evaluateAll((labels) => labels.every((label) => label.scrollWidth <= label.clientWidth + 1))).toBe(true);
  await page.screenshot({ path: info.outputPath('settings-en.png') });
});

test('English standalone surfaces retain user content and show translated actions', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const view of ['task', 'project', 'report', 'calendar-window', 'notification', 'quick-add', 'chat']) {
    await page.setViewportSize(view === 'notification' ? { width: 420, height: 280 } : view === 'quick-add' ? { width: 700, height: 300 } : { width: 1100, height: 800 });
    await page.goto(`/tests/theme/index.html?view=${view}&locale=en-US`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.locator('body')).not.toContainText(/\b(?:common|settings|tasks|reports|calendar):[a-z]/);
    if (view === 'notification') {
      await page.getByRole('button', { name: /Snooze/ }).click();
      await expect(page.getByRole('button', { name: 'In 15 minutes', exact: true })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath(`${view}-en.png`) });
    await expect(page.locator('body')).not.toContainText('[object Object]');
  }
  await page.goto('/tests/theme/index.html?view=ui-refinements&locale=en-US');
  await page.locator('[data-project-drag-id="theme-project"]').click();
  await expect(page.locator('.project-task-count')).toContainText('Tasks: 15');
  await expect(page.locator('.project-completed-count')).toHaveText('1 completed');
  expect(errors).toEqual([]);
});

test('web login uses the selected language without changing the password', async ({ page }) => {
  await page.route('**/api/bootstrap', (route) => route.fulfill({ status: 401, json: { error: '请先登录' } }));
  await page.goto('/network.html');
  const button = page.locator('.language-select button').first();
  await button.click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  const input = page.locator('input[type="password"]');
  await input.fill('A password unchanged');
  await switchLanguage(page, 'Interface language', '简体中文');
  await expect(input).toHaveValue('A password unchanged');
});
