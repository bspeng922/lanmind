import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`${theme}: Wiki pending saves keep their original workspace and user`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/tests/theme/index.html?view=workspace-isolation&theme=${theme}`);
    const body = page.getByRole('textbox', { name: 'Markdown 正文', exact: true });
    const readBody = async () => (await body.evaluate((el: HTMLElement) => {
      if ('value' in el && typeof (el as HTMLTextAreaElement).value === 'string') {
        return (el as HTMLTextAreaElement).value.trim();
      }
      return (el.innerText ?? el.textContent ?? '').trim();
    }));
    await body.fill('Only workspace A can see this');
    await page.getByRole('button', { name: 'Workspace B', exact: true }).click();
    await expect.poll(readBody).toBe('');
    await body.fill('Only workspace B can see this');
    await page.getByRole('button', { name: 'Workspace A', exact: true }).click();
    await expect.poll(readBody).toBe('Only workspace A can see this');
    await page.getByRole('button', { name: 'User Bob in A', exact: true }).click();
    await expect.poll(readBody).toBe('');
    await page.getByRole('button', { name: 'Workspace B', exact: true }).click();
    await expect.poll(readBody).toBe('Only workspace B can see this');
    expect(errors).toEqual([]);
  });

  test(`${theme}: an old AI stream cannot write after A-B-A switching`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/tests/theme/index.html?view=workspace-isolation&theme=${theme}`);
    await page.getByRole('button', { name: 'AI module', exact: true }).click();
    const composer = page.getByRole('textbox', { name: '输入消息', exact: true });
    await composer.fill('A private prompt'); await composer.press('Enter');
    await expect(page.getByText('A private prompt', { exact: true }).last()).toBeVisible();
    await page.getByRole('button', { name: 'Workspace B', exact: true }).click();
    await expect(page.getByText('A private prompt', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Workspace A', exact: true }).click();
    await page.getByRole('button', { name: 'Finish old stream', exact: true }).click();
    await expect(page.getByText('Late reply from A', { exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([key]) => key.startsWith('lanmind:v3:'))))).not.toContain('Late reply from A');
    await page.getByRole('button', { name: 'User Bob in A', exact: true }).click();
    await expect(page.getByText('A private prompt', { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}


test('Web session context follows authorized bootstrap and clears when the session expires', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lanmind-locale-preference', 'zh-CN'));
  let workspaceId = 'A';
  let authorized = true;
  const user = { id: 'alice', nickname: 'Alice', username: 'alice', deviceId: 'test', role: 'user', ip: '', isOnline: true, lastActive: '' };
  await page.route('**/api/**', async route => {
    if (!authorized) { await route.fulfill({ status: 401, json: { error: '请先登录' } }); return; }
    if (new URL(route.request().url()).pathname === '/api/bootstrap') {
      await route.fulfill({ json: { workspaceId, workspaceContext: { workspaceId, userId: user.id, revision: workspaceId === 'A' ? 1 : 2 }, currentUser: user, users: [user], projects: [], readOnly: true } });
    } else await route.fulfill({ json: [] });
  });
  await page.goto('/network.html');
  const scope = () => page.evaluate(async () => {
    const path = '/src/utils/workspaceContext.ts';
    const context = await import(path);
    return context.getWorkspaceContext();
  });
  const refresh = page.getByRole('button', { name: '刷新任务', exact: true });
  await expect(refresh).toBeVisible();
  await expect.poll(scope).toEqual({ workspaceId: 'A', userId: 'alice', revision: 1 });
  workspaceId = 'B';
  await refresh.click();
  await expect.poll(scope).toEqual({ workspaceId: 'B', userId: 'alice', revision: 2 });
  authorized = false;
  await refresh.click();
  await expect(page.getByLabel('访问密码', { exact: true })).toBeVisible();
  await expect.poll(scope).toBeNull();
});
