import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, query = '') {
  await page.clock.install({ time: new Date('2026-10-08T12:00:00Z') });
  await page.goto(`/tests/theme/index.html?view=app-lock&theme=titanium-light${query}`);
  await expect(page.getByRole('switch', { name: '自动锁定界面' })).toBeEnabled();
}
async function enable(page: Page) {
  await page.getByRole('switch', { name: '自动锁定界面' }).click();
  await page.getByLabel('设置解锁密码', { exact: true }).fill('correct password');
  await page.getByLabel('确认新解锁密码', { exact: true }).fill('correct password');
  await page.getByRole('button', { name: '保存锁定设置' }).click();
  await expect(page.getByRole('status')).toHaveText('锁定设置已保存');
}
async function unlock(page: Page) {
  const dialog = page.getByRole('dialog', { name: '程序锁定' });
  await dialog.getByLabel('解锁密码', { exact: true }).fill('correct password');
  await dialog.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test('lock settings validate minutes, password and confirmation before saving', async ({ page }) => {
  await open(page);
  const save = page.getByRole('button', { name: '保存锁定设置' });
  const minutes = page.getByLabel('无操作锁定时间（分钟）');
  await page.getByRole('switch', { name: '自动锁定界面' }).click();
  await save.click();
  await expect(page.getByRole('alert')).toHaveText('启用自动锁定前请设置解锁密码');
  await page.getByLabel('设置解锁密码', { exact: true }).fill('short');
  await save.click();
  await expect(page.getByRole('alert')).toContainText('8 到 128');
  await page.getByLabel('设置解锁密码', { exact: true }).fill('correct password');
  await page.getByLabel('确认新解锁密码', { exact: true }).fill('different password');
  await save.click();
  await expect(page.getByRole('alert')).toHaveText('两次输入的新密码不一致');
  for (const value of ['0', '1441', '1.5', '']) {
    await minutes.fill(value); await save.click();
    await expect(page.getByRole('alert')).toContainText('1 到 1440');
  }
  expect(await page.evaluate(() => (window as any).__appLockFixture.saves.length)).toBe(0);
});

test('failed save keeps inputs; disabling and changing settings require the current password', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).__appLockFixture.failNextSave = true; });
  await page.getByRole('switch', { name: '自动锁定界面' }).click();
  await page.getByLabel('设置解锁密码', { exact: true }).fill('correct password');
  await page.getByLabel('确认新解锁密码', { exact: true }).fill('correct password');
  const save = page.getByRole('button', { name: '保存锁定设置' });
  await save.click();
  await expect(page.getByRole('alert')).toHaveText('保存失败，请重试');
  await expect(page.getByLabel('设置解锁密码', { exact: true })).toHaveValue('correct password');
  await save.click();
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByLabel('确认新解锁密码', { exact: true })).toHaveValue('');
  await page.getByRole('switch', { name: '自动锁定界面' }).click();
  const verification = page.getByRole('dialog', { name: '关闭自动锁定', exact: true });
  await expect(verification).toBeVisible();
  await expect(page.getByRole('switch', { name: '自动锁定界面' })).toBeChecked();
  await verification.getByLabel('当前解锁密码', { exact: true }).fill('wrong password');
  await verification.getByRole('button', { name: '验证并继续' }).click();
  await expect(verification.getByRole('alert')).toHaveText('当前解锁密码不正确');
  await expect(page.getByRole('switch', { name: '自动锁定界面' })).toBeChecked();
  await verification.getByLabel('当前解锁密码', { exact: true }).fill('correct password');
  await verification.getByRole('button', { name: '验证并继续' }).click();
  await expect(verification).not.toBeVisible();
  await expect(page.getByRole('status')).toBeVisible();
  await page.clock.runFor(180_000);
  await expect(page.getByRole('dialog', { name: '程序锁定' })).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('switch', { name: '自动锁定界面' })).not.toBeChecked();
});

test('one minute idle locks; wrong password and Escape cannot unlock; correct password restores the draft', async ({ page }) => {
  await open(page); await enable(page);
  await page.getByLabel('任务草稿').fill('保留尚未保存的 Markdown 草稿');
  await page.clock.runFor(59_000);
  const dialog = page.getByRole('dialog', { name: '程序锁定' });
  await expect(dialog).not.toBeVisible();
  await page.clock.runFor(2_000);
  await expect(dialog).toBeVisible();
  expect(await page.getByLabel('任务草稿').evaluate((node) => Boolean(node.closest('[inert]')))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('解锁密码', { exact: true }).fill('incorrect password');
  await dialog.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('解锁密码不正确');
  await expect(dialog).toBeVisible();
  await unlock(page);
  await expect(page.getByLabel('任务草稿')).toHaveValue('保留尚未保存的 Markdown 草稿');
  await page.getByLabel('任务草稿').fill('可以继续编辑');
});

test('mouse and keyboard activity reset the idle timer', async ({ page }) => {
  await open(page); await enable(page);
  await page.clock.runFor(45_000);
  await page.mouse.move(50, 50);
  await page.clock.runFor(45_000);
  await expect(page.getByRole('dialog', { name: '程序锁定' })).not.toBeVisible();
  await page.getByLabel('任务草稿').focus();
  await page.keyboard.type('继续输入');
  await page.clock.runFor(45_000);
  await expect(page.getByRole('dialog', { name: '程序锁定' })).not.toBeVisible();
  await page.clock.runFor(16_000);
  await expect(page.getByRole('dialog', { name: '程序锁定' })).toBeVisible();
});

test('native lock protects portal menus and rejects a stale unlocked reply', async ({ page }) => {
  await open(page); await enable(page);
  await page.getByRole('button', { name: '测试优先级', exact: true }).click();
  await expect(page.getByRole('listbox', { name: '测试优先级', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).__appLockFixture.lock());
  await expect(page.getByRole('dialog', { name: '程序锁定' })).toBeVisible();
  expect(await page.locator('[role="listbox"]').evaluate((node) => Boolean(node.closest('[inert]')))).toBe(true);
  await page.evaluate(() => (window as any).__appLockFixture.emitStale());
  await expect(page.getByRole('dialog', { name: '程序锁定' })).toBeVisible();
  await unlock(page);
  expect(await page.getByLabel('任务草稿').evaluate((node) => Boolean(node.closest('[inert]')))).toBe(false);
});

test('enabled setting survives restart and the password can be changed with verification', async ({ page }) => {
  await open(page); await enable(page);
  await page.reload();
  await expect(page.getByRole('dialog', { name: '程序锁定' })).toBeVisible();
  await unlock(page);
  await page.getByLabel('新解锁密码（留空保留原密码）', { exact: true }).fill('updated password');
  await page.getByLabel('确认新解锁密码', { exact: true }).fill('updated password');
  await page.getByRole('button', { name: '保存锁定设置' }).click();
  const verification = page.getByRole('dialog', { name: '验证当前解锁密码', exact: true });
  await verification.getByLabel('当前解锁密码', { exact: true }).fill('correct password');
  await verification.getByRole('button', { name: '验证并继续' }).click();
  await expect(verification).not.toBeVisible();
  await expect(page.getByRole('status')).toBeVisible();
  await page.getByRole('button', { name: '立即锁定' }).click();
  const dialog = page.getByRole('dialog', { name: '程序锁定' });
  await dialog.getByLabel('解锁密码', { exact: true }).fill('correct password');
  await dialog.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('解锁密码不正确');
  await dialog.getByLabel('解锁密码', { exact: true }).fill('updated password');
  await dialog.getByRole('button', { name: '显示解锁密码' }).click();
  await expect(dialog.getByLabel('解锁密码', { exact: true })).toHaveAttribute('type', 'text');
  await dialog.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('auxiliary windows require unlocking in the main window', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=app-lock&startup=locked&aux=true');
  const dialog = page.getByRole('dialog', { name: '程序锁定' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('请在主界面输入密码解锁。')).toBeVisible();
  await expect(dialog.getByLabel('解锁密码', { exact: true })).toHaveCount(0);
  expect(await page.getByLabel('任务草稿').evaluate((node) => Boolean(node.closest('[inert]')))).toBe(true);
});

test('an IPC read failure shields the interface until a successful retry', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).__appLockFixture.failReads = true; });
  await page.clock.runFor(1_000);
  const dialog = page.getByRole('dialog', { name: '程序锁定' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText('无法读取本机锁定状态');
  await page.evaluate(() => { (window as any).__appLockFixture.failReads = false; });
  await dialog.getByRole('button', { name: '重新读取' }).click();
  await expect(dialog).not.toBeVisible();
});

test('startup read failures stay shielded without a lock-check page, then recover without flashing an error', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T12:00:00Z') });
  await page.goto('/tests/theme/index.html?view=app-lock&initial-read-error');
  const dialog = page.getByRole('dialog', { name: '程序锁定' });
  await expect(page.locator('[data-app-lock-initializing]')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('正在读取锁定状态')).toHaveCount(0);
  await page.clock.runFor(4_000);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await page.getByLabel('任务草稿').evaluate((node) => Boolean(node.closest('[inert]')))).toBe(true);
  await page.evaluate(() => { (window as any).__appLockFixture.failReads = false; });
  await page.clock.runFor(1_000);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-app-lock-initializing]')).toHaveCount(0);
});

test('persistent startup failure remains shielded and offers an explicit retry', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-08T12:00:00Z') });
  await page.goto('/tests/theme/index.html?view=app-lock&initial-read-error');
  await page.clock.runFor(5_000);
  const dialog = page.getByRole('dialog', { name: '程序锁定' });
  await expect(dialog.getByRole('alert')).toHaveText('无法读取本机锁定状态');
  expect(await page.getByLabel('任务草稿').evaluate((node) => Boolean(node.closest('[inert]')))).toBe(true);
  await page.evaluate(() => { (window as any).__appLockFixture.failReads = false; });
  await dialog.getByRole('button', { name: '重新读取' }).click();
  await expect(dialog).not.toBeVisible();
});

test('cancelled verification leaves saved settings unchanged; clearing requires the password and survives restart', async ({ page }) => {
  await open(page); await enable(page);
  await page.getByRole('switch', { name: '自动锁定界面' }).click();
  const disable = page.getByRole('dialog', { name: '关闭自动锁定', exact: true });
  await disable.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('switch', { name: '自动锁定界面' })).toBeChecked();
  await page.getByLabel('无操作锁定时间（分钟）').fill('10');
  await page.getByRole('button', { name: '保存锁定设置' }).click();
  const modify = page.getByRole('dialog', { name: '验证当前解锁密码', exact: true });
  await expect(modify).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modify).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).__appLockFixture.saves.length)).toBe(1);
  await expect(page.getByLabel('无操作锁定时间（分钟）')).toHaveValue('10');
  await page.getByRole('button', { name: '清除解锁密码', exact: true }).click();
  const clear = page.getByRole('dialog', { name: '清除解锁密码', exact: true });
  await expect(clear).toContainText('关闭自动锁定');
  await clear.getByLabel('当前解锁密码', { exact: true }).fill('incorrect');
  await clear.getByRole('button', { name: '验证并继续' }).click();
  await expect(clear.getByRole('alert')).toHaveText('当前解锁密码不正确');
  await clear.getByLabel('当前解锁密码', { exact: true }).fill('correct password');
  await clear.getByRole('button', { name: '验证并继续' }).click();
  await expect(clear).not.toBeVisible();
  await expect(page.getByRole('switch', { name: '自动锁定界面' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: '清除解锁密码', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('dialog', { name: '程序锁定' })).not.toBeVisible();
  await enable(page);
  await page.getByRole('button', { name: '立即锁定' }).click();
  await unlock(page);
});

test('the task list has no drag handles and still opens tasks and child tasks', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=ui-refinements&theme=titanium-light');
  await page.locator('[data-project-drag-id="theme-project"]').click();
  const cards = page.locator('.theme-glow-card');
  await expect(cards.first()).toBeVisible();
  await expect(cards.locator('.lucide-grip-vertical, [draggable="true"], [aria-label="拖动任务"]')).toHaveCount(0);
  const parent = cards.filter({ hasText: '整理项目资料' });
  await parent.getByRole('button', { name: '展开子任务', exact: true }).click();
  await expect(parent.getByRole('button', { name: '父任务下的子任务', exact: true })).toBeVisible();
  await parent.getByRole('button', { name: '更多操作', exact: true }).click();
  await expect(page.getByRole('menu', { name: '整理项目资料更多操作' }).getByRole('button', { name: '复制任务链接' })).toBeVisible();
  await parent.getByTitle('编辑任务', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑任务', exact: true })).toBeVisible();
});

test('Escape on the lock screen preserves an open task editor', async ({ page }) => {
  await open(page); await enable(page);
  await page.getByRole('button', { name: '打开任务编辑器' }).click();
  const editor = page.getByRole('dialog', { name: '编辑任务', exact: true });
  await expect(editor).toBeVisible();
  await page.evaluate(() => (window as any).__appLockFixture.lock());
  await expect(page.getByRole('dialog', { name: '程序锁定' })).toBeVisible();
  await page.keyboard.press('Escape');
  await unlock(page);
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).not.toBeVisible();
});

for (const theme of ['titanium-light', 'navy-slate']) {
  test(`${theme}: startup lock uses an opaque themed surface and supports Enter to unlock`, async ({ page }, info) => {
    await page.goto(`/tests/theme/index.html?view=app-lock&startup=locked&theme=${theme}`);
    const dialog = page.getByRole('dialog', { name: '程序锁定' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-theme', theme);
    expect(await dialog.evaluate((node) => {
      const style = getComputedStyle(node);
      return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.opacity === '1';
    })).toBe(true);
    await page.screenshot({ path: info.outputPath('lock-screen.png') });
    await dialog.getByLabel('解锁密码', { exact: true }).fill('correct password');
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
  });
}
