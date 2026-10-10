import { expect, test, type Page } from '@playwright/test';

const taskView = (page: Page) => page.locator('main').first().locator(':scope > div').last();
const personalKey = 'lanmind_task_layout:local-user@desktop:all';
const projectKey = 'lanmind_task_layout:local-user@desktop:theme-project';
async function open(page: Page, project = false, theme = 'titanium-light') {
  await page.clock.setFixedTime(new Date('2026-09-14T12:00:00'));
  await page.goto(`/tests/theme/index.html?view=task-layout-multi&theme=${theme}`);
  if (project) await page.locator('[data-project-drag-id="theme-project"]').click();
  await expect(taskView(page)).toContainText('今日产品待办');
}
async function filters(page: Page, project = false) {
  const name = project ? '项目排序和过滤' : '排序和过滤';
  const panel = page.getByRole('dialog', { name: project ? '项目排序和过滤' : '任务排序和过滤', exact: true });
  if (!await panel.isVisible()) await page.getByRole('button', { name, exact: true }).click();
  return panel;
}
async function choose(page: Page, field: string, names: string[], project = false) {
  const panel = await filters(page, project);
  const name = (project ? '项目' : '任务') + field;
  const button = panel.getByRole('button', { name, exact: true });
  if (field === '顺序') {
    const target = names[0];
    const text = await button.innerText();
    if (!text.includes(target)) {
      await button.click();
    }
    return;
  }
  await button.click();
  const menu = page.getByRole('listbox', { name, exact: true });
  for (const name of names) await menu.getByRole('option', { name, exact: true }).click();
  await page.keyboard.press('Escape');
}
async function view(page: Page, name: string, project = false) {
  await (project ? page.locator('.project-toolbar h2') : taskView(page).locator('h2').first()).click();
  if (project) {
    await page.getByRole('button', { name: '项目布局', exact: true }).click();
    await page.getByRole('dialog', { name: '项目布局设置' }).getByRole('button', { name, exact: true }).click();
    await page.locator('.project-toolbar h2').click();
  } else await page.getByRole('button', { name: name === '列表' ? /全部任务/ : name === '日历' ? '日历视图' : name === '看板' ? '看板视图' : '时间线', exact: name !== '列表' }).click();
}

for (const project of [false, true]) {
  test(`${project ? 'project' : 'personal'} multi-select filters persist across all views and reload`, async ({ page }) => {
    await open(page, project);
    await choose(page, '优先级', ['P1 紧急', 'P2 重要'], project);
    await choose(page, '状态', ['未开始', '进行中'], project);
    await choose(page, '日期', ['今天', '明天'], project);
    await choose(page, '标签', ['#产品', '#交付'], project);
    await expect((await filters(page, project)).getByRole('switch')).toBeDisabled();
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), project ? projectKey : personalKey)).toMatchObject({ priorityFilter: ['P1', 'P2'], statusFilter: ['todo', 'in_progress'], dateFilter: ['today', 'tomorrow'], tagFilter: ['产品', '交付'] });
    for (const name of ['看板', '日历', '时间线', '列表']) {
      await view(page, name, project);
      await expect(taskView(page).getByText('今日产品待办', { exact: true }).first()).toBeVisible();
      await expect(taskView(page).getByText('今日交付进行中', { exact: true }).first()).toBeVisible();
      await expect(taskView(page).getByText('完全未排期', { exact: true })).toHaveCount(0);
      await expect(taskView(page).getByText('完成产品任务', { exact: true })).toHaveCount(0);
      const panel = await filters(page, project);
      await expect(panel.getByRole('button', { name: (project ? '项目' : '任务') + '优先级', exact: true })).toContainText('P2');
      if (project) await expect(page.getByRole('button', { name: '排序和过滤', exact: true })).toHaveCount(0);
    }
    await page.reload();
    if (project) await page.locator('[data-project-drag-id="theme-project"]').click();
    const panel = await filters(page, project);
    await expect(panel.getByRole('button', { name: (project ? '项目' : '任务') + '日期', exact: true })).toContainText('明天');
  });
}

test('people and projects are searchable, choices stay available, clear preserves sorting', async ({ page }) => {
  await open(page);
  await choose(page, '排序', ['标题']);
  await choose(page, '负责人', ['我 · 测试管理员']);
  await choose(page, '项目', ['协作工作台', '第二协作项目']);
  await expect(taskView(page).getByText('明日另一项目', { exact: true })).toBeVisible();
  await expect(taskView(page).getByText('今日交付进行中', { exact: true })).toHaveCount(0);
  const panel = await filters(page);
  await panel.getByRole('button', { name: '任务负责人', exact: true }).click();
  const menu = page.getByRole('listbox', { name: '任务负责人', exact: true });
  await menu.getByRole('textbox', { name: '搜索选项' }).fill('协作');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu.getByRole('option', { name: '协作成员', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(taskView(page).getByText('今日交付进行中', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '清空筛选', exact: true }).click();
  await expect(panel.getByRole('button', { name: '任务排序', exact: true })).toContainText('标题');
  await expect(panel.getByRole('button', { name: '任务负责人', exact: true })).toContainText('全部');
  await expect(taskView(page).getByText('明日无项目任务', { exact: true })).toBeVisible();
});

test('calendar filters the displayed recurring occurrences and exposes undated tasks', async ({ page }) => {
  await open(page);
  await choose(page, '日期', ['今天', '明天']);
  await view(page, '日历');
  const calendar = page.locator('.calendar-view');
  for (const date of ['2026-09-14', '2026-09-15']) await expect(calendar.locator(`[data-calendar-date="${date}"]`).getByText('每日循环产品检查', { exact: true })).toBeVisible();
  await expect(calendar.locator('[data-calendar-date="2026-09-16"]').getByText('每日循环产品检查', { exact: true })).toHaveCount(0);
  await choose(page, '日期', ['全部']);
  await calendar.locator('h2').click();
  await calendar.getByRole('button', { name: '无截止日期 2', exact: true }).click();
  await expect(calendar.locator('.calendar-undated')).toContainText('只有开始日期');
  await choose(page, '日期', ['未排期']);
  await expect(calendar.locator('.calendar-undated')).toContainText('完全未排期');
  await expect(calendar.getByText('只有开始日期', { exact: true })).toHaveCount(0);
});

test('legacy preferences recover, grouping hides in non-list views and project scopes are independent', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ priorityFilter: 'P2', statusFilter: 'in_progress', sortMode: 'updatedAt', groupMode: 'status' })), personalKey);
  await page.clock.setFixedTime(new Date('2026-09-14T12:00:00'));
  await page.goto('/tests/theme/index.html?view=task-layout-multi');
  await expect(taskView(page).getByText('今日交付进行中', { exact: true })).toBeVisible();
  await view(page, '时间线');
  const panel = await filters(page);
  await expect(panel.getByRole('button', { name: '任务分组', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '任务顺序', exact: true })).toContainText('降序');
  await page.locator('[data-project-drag-id="theme-project"]').click();
  await expect((await filters(page, true)).getByRole('button', { name: '项目优先级', exact: true })).toContainText('全部');
  await choose(page, '优先级', ['P1 紧急'], true);
  await page.locator('[data-project-drag-id="other-project"]').click();
  await expect((await filters(page, true)).getByRole('button', { name: '项目优先级', exact: true })).toContainText('全部');
  await page.locator('[data-project-drag-id="theme-project"]').click();
  await expect((await filters(page, true)).getByRole('button', { name: '项目优先级', exact: true })).toContainText('P1');
});

test('kanban changing status removes filtered cards and explains the disappearance', async ({ page }) => {
  await open(page);
  await choose(page, '状态', ['未开始']);
  await view(page, '看板');
  const card = page.locator('.kanban-view .theme-glow-card').filter({ hasText: '今日产品待办' });
  const start = await card.boundingBox();
  const target = await page.locator('[data-kanban-status="in_progress"]').boundingBox();
  await page.mouse.move(start!.x + 30, start!.y + 20);
  await page.mouse.down();
  await page.mouse.move(target!.x + 50, target!.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: '任务状态已更新' })).toBeVisible();
});

test('shared descending priority sorts within calendar days, timeline rows and kanban columns', async ({ page }) => {
  await open(page);
  await choose(page, '排序', ['优先级']);
  await choose(page, '顺序', ['降序']);
  await view(page, '日历');
  await expect(page.locator('[data-calendar-date="2026-09-14"] .calendar-task').first()).toContainText('今日交付进行中');
  await page.locator('[data-calendar-date="2026-09-14"]').getByRole('button', { name: '查看 2026-09-14 的任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '2026-09-14 的任务', exact: true });
  await expect(dialog.getByText('今日交付进行中', { exact: true })).toBeVisible();
  await page.getByTitle('关闭当天任务', { exact: true }).click();
  await view(page, '时间线');
  await expect(page.locator('.timeline-grid > div > button[title]').first()).toHaveText('今日交付进行中');
  await view(page, '看板');
  await expect(page.locator('[data-kanban-status="todo"] .theme-glow-card').first()).toContainText('完全未排期');
  await view(page, '列表');
  await expect(taskView(page).locator('.theme-glow-card').first()).toContainText('完全未排期');
});

test('today filters refresh after resuming on the next local day', async ({ page }) => {
  await open(page);
  await choose(page, '日期', ['今天']);
  await taskView(page).locator('h2').first().click();
  await expect(taskView(page).getByText('明日另一项目', { exact: true })).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-09-15T00:01:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(taskView(page).getByText('明日另一项目', { exact: true })).toBeVisible();
  await expect(taskView(page).getByText('今日产品待办', { exact: true })).toHaveCount(0);
});

for (const theme of ['titanium-light', 'navy-slate']) test(`${theme}: narrow multi-select and keyboard selection stay usable`, async ({ page }) => {
  await open(page, false, theme);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '收起左侧导航', exact: true }).click();
  await page.getByTitle('收起右侧节点列表', { exact: true }).click();
  await view(page, '时间线');
  const panel = await filters(page);
  const trigger = panel.getByRole('button', { name: '任务优先级', exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  const menu = page.getByRole('listbox', { name: '任务优先级', exact: true });
  await expect(menu).toHaveAttribute('aria-multiselectable', 'true');
  await expect(menu.getByRole('option', { name: 'P1 紧急', exact: true })).toHaveAttribute('aria-selected', 'true');
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(panel).toBeVisible();
});
