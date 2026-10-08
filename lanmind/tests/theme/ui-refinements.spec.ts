import { expect, test, type Page } from '@playwright/test';

async function openProject(page: Page, theme = 'titanium-light') {
  await page.clock.setFixedTime(new Date('2026-09-14T12:00:00Z'));
  await page.goto(`/tests/theme/index.html?view=ui-refinements&theme=${theme}`);
  await page.locator('[data-project-drag-id="theme-project"]').click();
}

async function chooseView(page: Page, view: string) {
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await page.getByRole('dialog', { name: '项目布局设置' }).getByRole('button', { name: view, exact: true }).click();
  await page.locator('.project-toolbar h2').click();
}

test('filter dropdowns extend outside the panel without adding panel scrollbars', async ({ page }) => {
  await openProject(page);
  await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '项目排序和过滤' });
  const before = await panel.evaluate((node) => ({ height: node.clientHeight, scrollHeight: node.scrollHeight }));
  await panel.getByRole('button', { name: '项目标签', exact: true }).click();
  const dropdown = page.getByRole('listbox', { name: '项目标签', exact: true });
  await expect(dropdown).toBeVisible();
  expect(await dropdown.evaluate((node) => node.parentElement === document.body)).toBe(true);
  expect(await dropdown.evaluate((node) => getComputedStyle(node).scrollbarWidth)).toBe('none');
  expect(await panel.evaluate((node) => ({ height: node.clientHeight, scrollHeight: node.scrollHeight }))).toEqual(before);
  const rect = await dropdown.boundingBox();
  const panelRect = await panel.boundingBox();
  expect(rect!.y < panelRect!.y || rect!.y + rect!.height > panelRect!.y + panelRect!.height).toBe(true);
  await dropdown.getByRole('option', { name: '#验收', exact: true }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: '项目标签', exact: true })).toContainText('#验收');
  await page.locator('.project-toolbar h2').click();
  await expect(panel).not.toBeVisible();
  await page.getByRole('button', { name: /全部任务/ }).click();
  await page.getByRole('button', { name: '排序和过滤', exact: true }).click();
  const global = page.getByRole('dialog', { name: '任务排序和过滤' });
  await global.getByRole('button', { name: '任务排序', exact: true }).click();
  await page.getByRole('listbox', { name: '任务排序' }).getByRole('option', { name: '到期日期', exact: true }).click();
  await expect(global).toBeVisible();
});

for (const theme of ['titanium-light', 'navy-slate']) {
  test(`${theme}: compact project calendar keeps tasks and overflow entry inside each date`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1120, height: 720 });
    await openProject(page, theme);
    await chooseView(page, '日历');
    const calendar = page.locator('.calendar-view');
    await expect(calendar).toHaveAttribute('data-compact', 'true');
    const day = page.locator('[data-calendar-date="2026-09-14"]');
    const more = day.getByRole('button', { name: /的全部 15 项任务/ });
    await expect(more).toBeVisible();
    expect(await day.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return [...node.querySelectorAll('.calendar-task, .calendar-more')].every((item) => {
        const child = item.getBoundingClientRect();
        return child.top >= rect.top && child.bottom <= rect.bottom + 1 && child.right <= rect.right + 1;
      });
    })).toBe(true);
    await page.screenshot({ path: info.outputPath('compact-calendar.png') });
    await more.click();
    await expect(calendar.getByText('共 15 项', { exact: true })).toBeVisible();
    await expect(calendar.getByText('父任务下的子任务', { exact: true })).toHaveCount(0);
    await page.getByTitle('关闭当天任务', { exact: true }).click();
    await page.setViewportSize({ width: 1120, height: 620 });
    await expect(more).toBeVisible();
    expect(await more.evaluate((node) => node.getBoundingClientRect().bottom <= node.closest('.calendar-day')!.getBoundingClientRect().bottom + 1)).toBe(true);
  });
}

test('subtasks stay under their parent across filters, pins and project views', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lanmind_task_pins:local-user@desktop', '["child-refinement"]'));
  await openProject(page);
  const activeView = page.locator('main > div').last();
  await expect(activeView.getByText('父任务下的子任务', { exact: true })).toHaveCount(0);
  const parent = page.locator('.theme-glow-card').filter({ hasText: '整理项目资料' });
  await parent.getByRole('button', { name: '展开子任务', exact: true }).click();
  await expect(parent.getByRole('button', { name: '父任务下的子任务', exact: true })).toBeVisible();
  await parent.getByRole('button', { name: '收起子任务', exact: true }).click();
  for (const view of ['看板', '日历', '时间线', '列表']) {
    await chooseView(page, view);
    await expect(activeView.getByText('父任务下的子任务', { exact: true })).toHaveCount(0);
  }
  const search = page.getByPlaceholder('搜索任务、标签或责任人...');
  await search.fill('父任务下的子任务');
  await expect(activeView.getByText('父任务下的子任务', { exact: true })).toHaveCount(0);
});

test('task and project more menus close on outside clicks and Escape', async ({ page }) => {
  await openProject(page);
  await page.getByRole('button', { name: '更多操作', exact: true }).first().click();
  const taskMenu = page.getByRole('menu', { name: /整理项目资料更多操作/ });
  await expect(taskMenu).toBeVisible();
  await page.locator('.project-toolbar h2').click();
  await expect(taskMenu).not.toBeVisible();
  await page.getByRole('button', { name: '更多操作', exact: true }).first().click();
  await page.keyboard.press('Escape');
  await expect(taskMenu).not.toBeVisible();
  await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
  await expect(page.getByRole('menu', { name: '项目更多操作' })).toBeVisible();
  await page.locator('.theme-glow-card').first().click({ position: { x: 15, y: 10 } });
  await expect(page.getByRole('menu', { name: '项目更多操作' })).not.toBeVisible();
});

test('network password eye reveals the saved password after reopening without saving it again', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=network-settings&theme=titanium-light');
  await page.getByRole('button', { name: '随机生成 16 位密码' }).click();
  const input = page.getByLabel('网络伺服访问密码', { exact: true });
  const password = await input.inputValue();
  await expect.poll(() => page.evaluate(() => (window as any).__networkFixture.saves.length)).toBe(1);
  await page.reload();
  await expect(input).toBeEmpty();
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(input).toHaveValue(password);
  await expect(input).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '隐藏密码', exact: true }).click();
  await expect(input).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(input).toHaveValue(password);
  await page.getByRole('switch', { name: '启用网络伺服' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__networkFixture.saves.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__networkFixture.saves[0].password)).toBeUndefined();
});

test('legacy password explains the missing stored value without replacing the password', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=network-settings&legacy=1');
  await page.getByRole('button', { name: '显示密码', exact: true }).click();
  await expect(page.getByText('旧版密码只保存了校验值，无法显示。重新设置一次密码后即可查看。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('网络伺服访问密码', { exact: true })).toBeEmpty();
  expect(await page.evaluate(() => (window as any).__networkFixture.saves.length)).toBe(0);
});

test('project header owns the counts and icon-only creation across views', async ({ page }) => {
  await openProject(page);
  const header = page.locator('.project-toolbar');
  await expect(header.locator('.project-task-count')).toContainText('共 15 项');
  await expect(header.locator('.project-completed-count')).toHaveText('已完成 1');
  await expect(page.locator('.task-list-toolbar')).toHaveCount(0);
  const create = header.getByRole('button', { name: '新建任务', exact: true });
  await expect(create).toBeVisible();
  await expect(create).toHaveText('');
  await create.click();
  const editor = page.getByRole('dialog', { name: '创建任务' });
  await expect(editor.getByRole('button', { name: '选择任务归属项目', exact: true })).toContainText('协作工作台');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  await page.getByRole('dialog', { name: '项目排序和过滤' }).getByRole('switch').click();
  await expect(header.locator('.project-task-count')).toContainText('共 16 项');
  await page.locator('.project-toolbar h2').click();
  for (const view of ['看板', '日历', '时间线', '列表']) {
    await chooseView(page, view);
    await expect(create).toBeVisible();
    await expect(header.locator('.project-completed-count')).toHaveText('已完成 1');
  }
  await page.setViewportSize({ width: 390, height: 700 });
  await page.getByRole('button', { name: '收起左侧导航', exact: true }).click();
  await page.getByTitle('收起右侧节点列表', { exact: true }).click();
  await expect.poll(() => header.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  const buttonRect = await create.boundingBox();
  expect(buttonRect!.width).toBe(32);
  expect(buttonRect!.height).toBe(32);
  await page.getByRole('button', { name: /全部任务/ }).click();
  await expect(page.locator('.task-list-toolbar').getByRole('button', { name: '新建任务', exact: true })).toHaveText('');
  await expect(page.getByRole('button', { name: '快捷创建任务', exact: true })).toHaveText('');
});
