import { expect, test, type Page } from '@playwright/test';

const layoutPanel = (page: Page) => page.getByRole('dialog', { name: '项目布局设置' });
const filterPanel = (page: Page) => page.getByRole('dialog', { name: '项目排序和过滤' });
const moreMenu = (page: Page) => page.getByRole('menu', { name: '项目更多操作' });
const projectRow = (page: Page, id = 'theme-project') => page.locator(`[data-project-drag-id="${id}"]`);
const taskView = (page: Page) => page.locator('main').first().locator(':scope > div').last();
const layoutKey = 'lanmind_task_layout:local-user@desktop:theme-project';

async function openProject(page: Page, theme = 'titanium-light') {
  await page.clock.setFixedTime(new Date('2026-09-14T12:00:00Z'));
  await page.goto(`/tests/theme/index.html?view=project-layout&theme=${theme}`);
  await projectRow(page).click();
  await expect(page.locator('.project-toolbar h2')).toHaveText('协作工作台');
}

async function select(page: Page, field: string, option: string) {
  if (!await filterPanel(page).isVisible()) await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  await filterPanel(page).getByRole('button', { name: field, exact: true }).click();
  await page.getByRole('listbox', { name: field }).getByRole('option', { name: option, exact: true }).click();
}

async function chooseView(page: Page, view: string) {
  if (!await layoutPanel(page).isVisible()) await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await layoutPanel(page).getByRole('button', { name: view, exact: true }).click();
}

test('layout filters stay consistent across all four project views', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openProject(page);
  await expect(page.locator('.sidebar-project-view')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '按优先级筛选', exact: true })).toHaveCount(0);
  await expect(taskView(page).getByText('完成联调验证', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await expect(layoutPanel(page).getByRole('switch')).toHaveCount(0);
  await expect(layoutPanel(page).getByText('排序', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  await expect(layoutPanel(page)).not.toBeVisible();
  await expect(filterPanel(page).getByRole('group', { name: '项目视图' })).toHaveCount(0);
  await filterPanel(page).getByRole('switch').click();
  await expect(taskView(page).getByText('完成联调验证', { exact: true })).toBeVisible();
  await filterPanel(page).getByRole('switch').click();
  await select(page, '项目状态', '已完成');
  for (const view of ['列表', '看板', '日历', '时间线']) {
    await chooseView(page, view);
    await expect(taskView(page).getByText('完成联调验证', { exact: true }).first()).toBeVisible();
    await expect(taskView(page).getByText('整理项目资料', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '项目文件', exact: true })).toBeVisible();
    await expect(layoutPanel(page)).toBeVisible();
  }
  await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  await filterPanel(page).getByRole('button', { name: '全部重置', exact: true }).click();
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await expect(layoutPanel(page).getByRole('button', { name: '时间线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await select(page, '项目优先级', 'P1 紧急重要');
  await select(page, '项目日期', '今天');
  await select(page, '项目标签', '#验收');
  await expect(taskView(page).getByText('整理项目资料', { exact: true }).first()).toBeVisible();
  await expect(taskView(page).getByText('检查明亮主题', { exact: true })).toHaveCount(0);
  await select(page, '项目日期', '明天');
  await expect(taskView(page).getByText('整理项目资料', { exact: true })).toHaveCount(0);
  await filterPanel(page).getByRole('button', { name: '全部重置', exact: true }).click();
  await select(page, '项目状态', '已放弃');
  await select(page, '项目日期', '未排期');
  await chooseView(page, '看板');
  await expect(page.locator('[data-kanban-status="abandoned"]')).toContainText('归档暂缓事项');
  await page.keyboard.press('Escape');
  await expect(layoutPanel(page)).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('grouping, sorting and personal pins persist independently per project', async ({ page }) => {
  await openProject(page);
  await page.locator('main .theme-glow-card').filter({ hasText: '确认交付时间' }).getByRole('button', { name: '置顶任务', exact: true }).click();
  await expect(taskView(page).getByText('置顶任务', { exact: true })).toBeVisible();
  await expect(taskView(page).getByRole('separator', { name: '置顶任务与其他任务分隔线' })).toBeVisible();
  await expect(taskView(page).getByText('其他任务', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await select(page, '项目排序', '优先级');
  const titles = page.locator('main .theme-glow-card .text-sm.font-medium');
  await expect(titles).toHaveText(['确认交付时间', '整理项目资料', '检查明亮主题']);
  await select(page, '项目分组', '状态');
  await expect(taskView(page)).toContainText('置顶');
  await chooseView(page, '时间线');
  await select(page, '项目优先级', 'P1 紧急重要');
  await page.keyboard.press('Escape');
  await projectRow(page, 'admin-project').click();
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await expect(layoutPanel(page).getByRole('button', { name: '列表', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  await expect(filterPanel(page).getByRole('button', { name: '项目优先级', exact: true })).toHaveText('全部');
  await select(page, '项目排序', '标题');
  await page.keyboard.press('Escape');
  await projectRow(page).click();
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await expect(layoutPanel(page).getByRole('button', { name: '时间线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  await expect(filterPanel(page).getByRole('button', { name: '项目分组', exact: true })).toBeDisabled();
  await page.reload();
  await projectRow(page).click();
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await expect(layoutPanel(page).getByRole('button', { name: '时间线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
  await expect(filterPanel(page).getByRole('button', { name: '项目优先级', exact: true })).toContainText('P1');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), layoutKey)).toMatchObject({ view: 'timeline', groupMode: 'status', sortMode: 'priority', priorityFilter: 'P1' });
});

test('files and more menu open management and transfer directly', async ({ page }) => {
  await openProject(page);
  await page.getByRole('button', { name: '项目文件', exact: true }).click();
  await expect(page.locator('.project-files-panel')).toContainText('项目说明.md');
  await page.locator('.project-files-panel').getByRole('button', { name: '关闭文件面板', exact: true }).click();
  await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
  await moreMenu(page).getByRole('menuitem', { name: '项目权限与属性管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '局域网项目权限与属性管理', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '转让项目', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除项目', exact: true })).toHaveCount(0);
  await page.getByPlaceholder('如: 2026年二季度营销复盘及 PPT...').fill('协作工作台更新');
  await page.getByRole('button', { name: '保存项目设置', exact: true }).click();
  await expect(page.locator('.project-toolbar h2')).toHaveText('协作工作台更新');
  await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
  await moreMenu(page).getByRole('menuitem', { name: '转让项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '转让项目', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '确认转让', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '选择新项目创建者', exact: true }).click();
  await page.getByRole('option', { name: /协作成员/ }).click();
  await dialog.getByRole('button', { name: '确认转让', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
  await expect(moreMenu(page).getByRole('menuitem', { name: '转让项目', exact: true })).toBeDisabled();
  await expect(moreMenu(page).getByRole('menuitem', { name: '项目权限与属性管理', exact: true })).toBeDisabled();
});

test('delete requires confirmation and returns to the task list', async ({ page }) => {
  await openProject(page);
  await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
  await moreMenu(page).getByRole('menuitem', { name: '删除项目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除项目确认', exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: '局域网项目权限与属性管理', exact: true })).toHaveCount(0);
  const confirm = dialog.getByRole('button', { name: '确认删除', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox').fill('错误名称');
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
  await moreMenu(page).getByRole('menuitem', { name: '删除项目', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toBeEmpty();
  await dialog.getByRole('textbox').fill('协作工作台');
  await confirm.click();
  await expect(dialog).not.toBeVisible();
  await expect(projectRow(page)).toHaveCount(0);
  await expect(page.locator('.project-toolbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '排序和过滤', exact: true })).toBeVisible();
});

for (const theme of ['titanium-light', 'navy-slate']) {
  test(`${theme}: progress and project confirmation dialogs use clear themed surfaces`, async ({ page }, info) => {
    await openProject(page, theme);
    const progress = page.getByRole('progressbar').first();
    await expect(progress).toBeVisible();
    expect(await progress.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe('none');
    await page.screenshot({ path: info.outputPath('progress.png') });
    await page.setViewportSize({ width: 390, height: 700 });
    await page.getByRole('button', { name: '收起左侧导航', exact: true }).click();
    await page.getByTitle('收起右侧节点列表', { exact: true }).click();
    for (const action of ['转让项目', '删除项目']) {
      await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
      await moreMenu(page).getByRole('menuitem', { name: action, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: action === '删除项目' ? '删除项目确认' : action, exact: true });
      await expect(dialog).toBeVisible();
      expect(await dialog.locator('form').evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && node.scrollWidth <= node.clientWidth;
      })).toBe(true);
      if (action === '转让项目') {
        await dialog.getByRole('button', { name: '选择新项目创建者', exact: true }).click();
        const listbox = page.getByRole('listbox', { name: '选择新项目创建者', exact: true });
        await expect(listbox).toBeVisible();
        expect(await listbox.evaluate((node) => { const rect = node.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth; })).toBe(true);
        await page.getByRole('option', { name: /协作成员/ }).click();
      }
      await page.screenshot({ path: info.outputPath(`${action}.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
    }
  });
}

test('more menu respects creator, project admin and member roles', async ({ page }) => {
  await openProject(page);
  for (const [id, manageEnabled] of [['admin-project', true], ['member-project', false]] as const) {
    await projectRow(page, id).click();
    await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
    const manage = moreMenu(page).getByRole('menuitem', { name: '项目权限与属性管理', exact: true });
    if (manageEnabled) await expect(manage).toBeEnabled();
    else await expect(manage).toBeDisabled();
    if (manageEnabled) {
      await page.keyboard.press('ArrowDown');
      await expect(manage).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(manage).toBeFocused();
    }
    await expect(moreMenu(page).getByRole('menuitem', { name: '删除项目', exact: true })).toBeDisabled();
    await expect(moreMenu(page).getByRole('menuitem', { name: '转让项目', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(moreMenu(page)).not.toBeVisible();
    await page.getByRole('button', { name: '项目布局', exact: true }).click();
    await expect(layoutPanel(page)).toBeVisible();
    await page.locator('.project-toolbar h2').click();
    await expect(layoutPanel(page)).not.toBeVisible();
  }
});

test('global task views use the compact sorting and filtering panel', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-14T12:00:00Z'));
  await page.goto('/tests/theme/index.html?view=task-filters&theme=titanium-light');
  await page.getByRole('button', { name: /全部任务/ }).click();
  const trigger = page.getByRole('button', { name: '排序和过滤', exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const panel = page.getByRole('dialog', { name: '任务排序和过滤', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('group', { name: '项目视图' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '按优先级筛选', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '项目布局', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '任务排序', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '任务优先级', exact: true }).click();
  await page.getByRole('listbox', { name: '任务优先级', exact: true }).getByRole('option', { name: 'P1 紧急重要', exact: true }).click();
  await expect(taskView(page).getByText('整理项目资料', { exact: true })).toBeVisible();
  await expect(taskView(page).getByText('检查明亮主题', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '任务排序', exact: true }).click();
  await page.getByRole('listbox', { name: '任务排序', exact: true }).getByRole('option', { name: '到期日期', exact: true }).click();
  await expect(taskView(page).locator('.theme-glow-card .text-sm.font-medium')).toHaveText(['整理项目资料', '准备下次交付']);
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await page.getByRole('button', { name: /今日安排/ }).click();
  await expect(page.locator('.task-list-toolbar h2')).toHaveText('今日安排');
  await expect(taskView(page).locator('.theme-glow-card .text-sm.font-medium')).toHaveText(['整理项目资料']);
  await page.getByRole('button', { name: /近期节点/ }).click();
  await expect(page.locator('.task-list-toolbar h2')).toHaveText('近期节点');
  await expect(taskView(page).locator('.theme-glow-card .text-sm.font-medium')).toHaveText(['准备下次交付']);
  await page.reload();
  await trigger.click();
  await expect(panel.getByRole('button', { name: '任务优先级', exact: true })).toContainText('P1');
  await expect(panel.getByRole('button', { name: '任务排序', exact: true })).toHaveText('到期日期');
  await panel.getByRole('button', { name: '全部重置', exact: true }).click();
  await expect(trigger).toHaveAttribute('data-active', 'true');
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('data-active', 'false');
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: /近期节点/ }).click();
  await expect(taskView(page).getByText('交付检查已完成', { exact: true })).toHaveCount(0);
  await trigger.click();
  await panel.getByRole('switch').click();
  await expect(taskView(page).getByText('交付检查已完成', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '任务标签', exact: true }).click();
  await page.getByRole('listbox', { name: '任务标签', exact: true }).getByRole('option', { name: '#交付', exact: true }).click();
  await panel.getByRole('button', { name: '任务状态', exact: true }).click();
  await page.getByRole('listbox', { name: '任务状态', exact: true }).getByRole('option', { name: '已完成', exact: true }).click();
  await expect(taskView(page).locator('.theme-glow-card .text-sm.font-medium')).toHaveText(['交付检查已完成']);
  await panel.getByRole('button', { name: '全部重置', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /全部任务/ }).click();
  await trigger.click();
  await panel.getByRole('button', { name: '任务日期', exact: true }).click();
  await page.getByRole('listbox', { name: '任务日期', exact: true }).getByRole('option', { name: '未排期', exact: true }).click();
  await expect(taskView(page).locator('.theme-glow-card .text-sm.font-medium')).toHaveText(['待排期评估']);
  await panel.getByRole('button', { name: '任务分组', exact: true }).click();
  await page.getByRole('listbox', { name: '任务分组', exact: true }).getByRole('option', { name: '负责人', exact: true }).click();
  await expect(taskView(page).getByText('测试管理员', { exact: true })).toBeVisible();
  await page.locator('.task-list-toolbar h2').click();
  await expect(panel).not.toBeVisible();
});

for (const theme of ['titanium-light', 'navy-slate']) {
  for (const width of [1440, 800, 390]) {
    test(`${theme}: task filter panel fits ${width}px viewport`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 700 : 900 });
      await page.clock.setFixedTime(new Date('2026-09-14T12:00:00Z'));
      await page.goto(`/tests/theme/index.html?view=task-filters&theme=${theme}`);
      if (width < 1000) {
        await page.getByRole('button', { name: '收起左侧导航', exact: true }).click();
        await page.getByTitle('收起右侧节点列表', { exact: true }).click();
      }
      const trigger = page.getByRole('button', { name: '排序和过滤', exact: true });
      await trigger.click();
      const panel = page.getByRole('dialog', { name: '任务排序和过滤', exact: true });
      const box = await panel.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(width === 390 ? 700 : 900);
      await panel.getByRole('button', { name: '任务优先级', exact: true }).click();
      await page.getByRole('option', { name: 'P1 紧急重要', exact: true }).click();
      await panel.getByRole('button', { name: '任务标签', exact: true }).click();
      await page.getByRole('option', { name: '#验收', exact: true }).click();
      await expect(taskView(page).getByText('整理项目资料', { exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath('task-filters.png') });
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await expect(panel).not.toBeVisible();
    });
  }
}

for (const theme of ['titanium-light', 'navy-slate']) {
  for (const width of [1440, 800, 390]) {
    test(`${theme}: project layout fits ${width}px viewport`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 700 : 900 });
      await openProject(page, theme);
      if (width < 1000) {
        await page.getByRole('button', { name: '收起左侧导航', exact: true }).click();
        await page.getByTitle('收起右侧节点列表', { exact: true }).click();
      }
      const controls = page.locator('.project-toolbar > div').last().getByRole('button');
      await expect(controls).toHaveCount(5);
      const positions = await Promise.all((await controls.all()).map((button) => button.boundingBox()));
      expect(positions[0]!.x + positions[0]!.width).toBeLessThanOrEqual(positions[1]!.x);
      expect(positions[1]!.x + positions[1]!.width).toBeLessThanOrEqual(positions[2]!.x);
      expect(positions[2]!.x + positions[2]!.width).toBeLessThanOrEqual(positions[3]!.x);
      expect(positions[3]!.x + positions[3]!.width).toBeLessThanOrEqual(width);
      expect(positions[3]!.x + positions[3]!.width).toBeLessThanOrEqual(positions[4]!.x);
      expect(positions[4]!.x + positions[4]!.width).toBeLessThanOrEqual(width);
      await page.getByRole('button', { name: '项目布局', exact: true }).click();
      const box = await layoutPanel(page).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath('project-layout.png') });
      await page.getByRole('button', { name: '项目排序和过滤', exact: true }).click();
      await expect(layoutPanel(page)).not.toBeVisible();
      await filterPanel(page).getByRole('button', { name: '项目标签', exact: true }).click();
      const options = page.getByRole('listbox', { name: '项目标签', exact: true });
      await expect(options).toBeVisible();
      await options.getByRole('option', { name: '#验收', exact: true }).click();
      await expect(filterPanel(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: '项目排序和过滤', exact: true })).toBeFocused();
      await page.getByRole('button', { name: '更多项目操作', exact: true }).click();
      await expect(moreMenu(page)).toBeVisible();
      await page.screenshot({ path: info.outputPath('project-more.png') });
    });
  }
}
