import { expect, test, type Page } from '@playwright/test';

async function openGroup(page: Page, query = '') {
  await page.goto(`/tests/theme/index.html?view=chat&theme=titanium-light${query}`);
  await page.locator('.chat-group-item').filter({ hasText: '项目协作群' }).click();
  await expect(page.getByText('群内项目进展记录', { exact: true })).toBeVisible();
}

test('group menu keeps settings before more and closes on Escape, outside click and conversation change', async ({ page }, info) => {
  await openGroup(page);
  const more = page.getByRole('button', { name: '更多群组操作' });
  expect(await more.evaluate((node) => node.parentElement?.previousElementSibling?.getAttribute('aria-label'))).toBe('群设置');
  await expect(page.getByRole('button', { name: '清空当前会话', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '群设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '群组设置' })).toBeVisible();
  await expect(page.getByRole('button', { name: '转让群组', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除群组', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭群组设置窗口' }).click();
  await more.click();
  const menu = page.getByRole('menu', { name: '群组更多操作' });
  await expect(menu.getByRole('menuitem')).toHaveText(['清空聊天记录', '转让群组', '删除群组']);
  expect(await menu.getByRole('menuitem').first().locator('svg').getAttribute('class')).toContain('lucide-eraser');
  expect(await menu.getByRole('menuitem').last().locator('svg').getAttribute('class')).toContain('lucide-trash2');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: '转让群组' })).toBeFocused();
  await page.screenshot({ path: info.outputPath('group-more-menu.png') });
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(more).toBeFocused();
  await more.click();
  await page.getByText('群内项目进展记录', { exact: true }).click();
  await expect(menu).not.toBeVisible();
  await more.click();
  await page.locator('.chat-node-item').first().click();
  await expect(menu).not.toBeVisible();
  await expect(more).not.toBeVisible();
});

test('clearing group messages preserves other conversations and the group', async ({ page }) => {
  await openGroup(page);
  await page.getByRole('button', { name: '更多群组操作' }).click();
  await page.getByRole('menuitem', { name: '清空聊天记录' }).click();
  await expect(page.getByText('群内项目进展记录', { exact: true })).not.toBeVisible();
  await expect(page.locator('.chat-group-item').filter({ hasText: '项目协作群' })).toBeVisible();
  const messages = await page.evaluate(() => JSON.parse(localStorage.getItem('lan_chat_messages_v2') || '[]'));
  expect(messages.some((message: any) => message.id === 'm-group')).toBe(false);
  expect(messages.some((message: any) => message.id === 'm1')).toBe(true);
});

test('group transfer opens directly and updates ownership without opening settings', async ({ page }) => {
  await openGroup(page);
  await page.getByRole('button', { name: '更多群组操作' }).click();
  await page.getByRole('menuitem', { name: '转让群组' }).click();
  const dialog = page.getByRole('dialog', { name: '转让对话群' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: '群组设置' })).not.toBeVisible();
  await expect(dialog.getByRole('button', { name: '确认转让' })).toBeDisabled();
  await dialog.getByRole('button', { name: '选择新群主' }).click();
  await page.getByRole('option', { name: /协作成员/ }).click();
  await dialog.getByRole('button', { name: '确认转让' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '群设置', exact: true })).not.toBeVisible();
  const group = await page.evaluate(() => JSON.parse(localStorage.getItem('lan_chat_groups_v2') || '[]').find((group: any) => group.id === 'theme-group'));
  expect(group.createdBy).toBe('peer@test');
  expect(group.memberIds).toContain('local-user@desktop');
  await page.getByRole('button', { name: '更多群组操作' }).click();
  await expect(page.getByRole('menu', { name: '群组更多操作' }).getByRole('menuitem')).toHaveText(['清空聊天记录']);
});

test('group deletion requires its exact name and cancellation preserves the group', async ({ page }) => {
  await openGroup(page);
  await page.getByRole('button', { name: '更多群组操作' }).click();
  await page.getByRole('menuitem', { name: '删除群组' }).click();
  const dialog = page.getByRole('dialog', { name: '删除群组确认' });
  const confirm = dialog.getByRole('button', { name: '确认删除' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: '群组设置' })).not.toBeVisible();
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('请输入群组名称以确认删除：').fill('其他群组');
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.chat-group-item').filter({ hasText: '项目协作群' })).toBeVisible();
  await page.getByRole('button', { name: '更多群组操作' }).click();
  await page.getByRole('menuitem', { name: '删除群组' }).click();
  await dialog.getByLabel('请输入群组名称以确认删除：').fill('项目协作群');
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.chat-group-item').filter({ hasText: '项目协作群' })).toHaveCount(0);
});

for (const query of ['&group-role=admin', '&group-role=member', '&readonly-group=1']) {
  test(`group ownership actions stay hidden without permission (${query})`, async ({ page }) => {
    await openGroup(page, query);
    await page.getByRole('button', { name: '更多群组操作' }).click();
    await expect(page.getByRole('menu', { name: '群组更多操作' }).getByRole('menuitem')).toHaveText(['清空聊天记录']);
  });
}
