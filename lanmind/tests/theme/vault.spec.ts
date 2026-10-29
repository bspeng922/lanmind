import { expect, test, type Page } from '@playwright/test';
const master = 'my test master password';
async function createVault(page: Page) {
  await page.goto('/tests/theme/vault.html?locale=en-US&theme=light');
  await page.getByLabel('Master password', { exact: true }).fill(master);
  await page.getByLabel('Confirm password', { exact: true }).fill(master);
  await page.getByRole('button', { name: 'Create vault', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Password Vault', exact: true })).toBeVisible();
}
async function createLogin(page: Page, name = 'Example account') {
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New record', exact: true });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByLabel('Username', { exact: true }).fill('alice');
  await dialog.getByLabel('Password', { exact: true }).fill('private-site-password');
  await dialog.getByLabel('Notes', { exact: true }).fill('find by confidential notes');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
test('create, clone, copy, search notes and lock without persisting secrets in browser storage', async ({ page }, info) => {
  await createVault(page); await createLogin(page);
  await page.screenshot({ path: info.outputPath('vault-light.png') });
  await expect(page.getByText('private-site-password', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal: Password', exact: true }).click();
  await expect(page.getByText('private-site-password', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy: Username', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Copied.');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('button', { name: 'Clone', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New record', exact: true });
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Example account (copy)');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByLabel('Search names, usernames, sites and notes').fill('confidential');
  await expect(page.getByRole('button', { name: 'Example account alice', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await expect(page.getByLabel('Master password', { exact: true })).toBeVisible();
  await expect(page.getByText('private-site-password', { exact: true })).toHaveCount(0);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('private-site-password'); expect(stored).not.toContain(master);
  await page.getByLabel('Master password', { exact: true }).fill(master); await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Example account (copy) alice', exact: true })).toBeVisible();
});
test('folders and trash restoration retain records', async ({ page }) => {
  await createVault(page);
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  const folder = page.getByRole('dialog', { name: 'New folder', exact: true });
  await folder.getByLabel('Name', { exact: true }).fill('Personal'); await folder.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Personal', exact: true }).click(); await createLogin(page, 'Folder login');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Trash', exact: true }).click(); await page.getByRole('button', { name: 'Folder login alice', exact: true }).click();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await page.getByRole('button', { name: 'Personal', exact: true }).click(); await expect(page.getByRole('button', { name: 'Folder login alice', exact: true })).toBeVisible();
});
test('nested generator dialog preserves editor and fills generated password', async ({ page }) => {
  await createVault(page); await page.getByRole('button', { name: 'New record', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New record', exact: true }); await editor.getByLabel('Name', { exact: true }).fill('Generated login');
  await editor.getByRole('button', { name: 'Password generator', exact: true }).click();
  const generator = page.getByRole('dialog', { name: 'Password generator', exact: true });
  await generator.getByRole('button', { name: 'Generate again', exact: true }).click(); await generator.getByRole('button', { name: 'Use this password', exact: true }).click();
  await expect(editor).toBeVisible(); await expect(editor.getByLabel('Password', { exact: true })).toHaveValue('R7!vQ9@kN4#tP8$xW2%z');
  await editor.getByRole('button', { name: 'Password generator', exact: true }).click(); await page.keyboard.press('Escape'); await expect(generator).toHaveCount(0); await expect(editor).toBeVisible();
});
test('Chinese labels and narrow layout remain usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 760, height: 850 }); await page.goto('/tests/theme/vault.html?theme=dark');
  await page.getByLabel('主密码', { exact: true }).fill(master); await page.getByLabel('确认密码', { exact: true }).fill(master); await page.getByRole('button', { name: '创建密码库', exact: true }).click();
  await page.getByRole('button', { name: '新建记录', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '新建记录', exact: true });
  await dialog.getByLabel('名称', { exact: true }).fill('测试记录'); await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '测试记录', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('vault-narrow-dark.png') });
});
