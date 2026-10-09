import { expect, test, type Page } from '@playwright/test';

async function openTimeline(page: Page, theme = 'titanium-light', now = '2026-09-30T12:00:00') {
  await page.clock.setFixedTime(new Date(now));
  await page.goto(`/tests/theme/index.html?view=timeline&theme=${theme}`);
  await page.locator('[data-project-drag-id="theme-project"]').click();
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await page.getByRole('dialog', { name: '项目布局设置' }).getByRole('button', { name: '时间线', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.timeline-view')).toBeVisible();
}

test('personal timeline sorts and filters tasks using preferences shared with the list and calendar', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-14T12:00:00'));
  await page.goto('/tests/theme/index.html?view=project-layout&theme=titanium-light');
  await page.getByRole('button', { name: '时间线', exact: true }).click();
  const timeline = page.locator('.timeline-view');
  const rows = timeline.locator('.timeline-grid > div > button[title]');
  await expect(timeline).toContainText('本期 3 项');
  await expect(timeline.getByRole('button', { name: '完成联调验证', exact: true })).toHaveCount(0);
  await expect(timeline.getByRole('button', { name: '归档暂缓事项', exact: true })).toHaveCount(0);
  await timeline.getByRole('button', { name: '排序和过滤', exact: true }).click();
  const panel = page.getByRole('dialog', { name: '任务排序和过滤', exact: true });
  await panel.getByRole('switch', { name: '显示已完成的任务' }).click();
  await expect(timeline).toContainText('本期 4 项');
  await panel.getByRole('button', { name: '任务排序', exact: true }).click();
  await page.getByRole('listbox', { name: '任务排序' }).getByRole('option', { name: '标题', exact: true }).click();
  await expect(rows).toHaveText(['检查明亮主题', '确认交付时间', '完成联调验证', '整理项目资料']);
  await panel.getByRole('button', { name: '任务优先级', exact: true }).click();
  await page.getByRole('listbox', { name: '任务优先级' }).getByRole('option', { name: 'P1 紧急', exact: true }).click();
  await expect(rows).toHaveText(['整理项目资料']);
  await expect(timeline).toContainText('本期 1 项');

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '收起左侧导航', exact: true }).click();
  await page.getByTitle('收起右侧节点列表', { exact: true }).click();
  await timeline.getByRole('button', { name: '排序和过滤', exact: true }).click();
  await expect.poll(() => panel.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
  })).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole('button', { name: '日历视图', exact: true }).click();
  await page.getByRole('button', { name: '排序和过滤', exact: true }).click();
  await expect(panel.getByRole('switch', { name: '显示已完成的任务' })).toHaveAttribute('aria-checked', 'true');
  await expect(panel.getByRole('button', { name: '任务优先级', exact: true })).toContainText('P1');
  await page.getByRole('button', { name: /全部任务/ }).click();
  await page.getByRole('button', { name: '排序和过滤', exact: true }).click();
  await expect(panel.getByRole('button', { name: '任务排序', exact: true })).toContainText('标题');
  await expect(panel.getByRole('button', { name: '任务优先级', exact: true })).toContainText('P1');

  await page.locator('[data-project-drag-id="theme-project"]').click();
  await page.getByRole('button', { name: '项目布局', exact: true }).click();
  await page.getByRole('dialog', { name: '项目布局设置' }).getByRole('button', { name: '时间线', exact: true }).click();
  await expect(timeline.getByRole('button', { name: '排序和过滤', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '项目排序和过滤', exact: true })).toBeVisible();
  await expect(timeline).toContainText('本期 3 项');
});

test('timeline starts around today, clips overlapping tasks, and opens task details', async ({ page }) => {
  await openTimeline(page);
  const timeline = page.locator('.timeline-view');
  await expect(timeline.getByRole('button', { name: '7 天', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(timeline.locator('[data-timeline-date]')).toHaveCount(7);
  await expect(timeline).toContainText('2026-09-29 至 2026-10-05 · 本期 3 项 · 另有 2 项在本期外');
  await expect(timeline.locator('[aria-current="date"]')).toHaveAttribute('data-timeline-date', '2026-09-30');
  await expect(timeline.getByRole('button', { name: '更早的排期', exact: true })).toHaveCount(0);
  await expect(timeline.getByRole('button', { name: '后续交付', exact: true })).toHaveCount(0);
  await expect(timeline.getByRole('button', { name: '待排期评估', exact: true })).toBeVisible();
  const before = timeline.getByRole('button', { name: '查看任务：跨月资料整理', exact: true });
  const after = timeline.getByRole('button', { name: '查看任务：持续联调验证', exact: true });
  await expect(before.getByLabel('开始于本期之前')).toBeVisible();
  await expect(after.getByLabel('延续至本期之后')).toBeVisible();
  const firstDay = await timeline.locator('[data-timeline-date]').first().boundingBox();
  const lastDay = await timeline.locator('[data-timeline-date]').last().boundingBox();
  const beforeBox = await before.boundingBox();
  const afterBox = await after.boundingBox();
  expect(beforeBox!.x).toBeCloseTo(firstDay!.x + 3, 0);
  expect(afterBox!.x + afterBox!.width).toBeCloseTo(lastDay!.x + lastDay!.width - 3, 0);
  await timeline.getByRole('button', { name: '查看任务：今日交付节点', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑任务', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('请输入任务标题...')).toHaveValue('今日交付节点');
});

test('timeline switches between 7 and 14 days, browses periods, and returns to today across a year boundary', async ({ page }) => {
  await openTimeline(page, 'titanium-light', '2027-01-01T12:00:00');
  const timeline = page.locator('.timeline-view');
  await expect(timeline).toContainText('2026-12-31 至 2027-01-06');
  await timeline.getByRole('button', { name: '14 天', exact: true }).click();
  await expect(timeline.locator('[data-timeline-date]')).toHaveCount(14);
  await expect(timeline).toContainText('2026-12-30 至 2027-01-12');
  await timeline.getByRole('button', { name: '后 14 天', exact: true }).click();
  await expect(timeline).toContainText('2027-01-13 至 2027-01-26');
  await timeline.getByRole('button', { name: '7 天', exact: true }).click();
  await expect(timeline).toContainText('2027-01-13 至 2027-01-19');
  await timeline.getByRole('button', { name: '前 7 天', exact: true }).click();
  await expect(timeline).toContainText('2027-01-06 至 2027-01-12');
  await timeline.getByRole('button', { name: '回到今天', exact: true }).click();
  await expect(timeline).toContainText('2026-12-31 至 2027-01-06');
  await expect(timeline.locator('[aria-current="date"]')).toHaveAttribute('data-timeline-date', '2027-01-01');
});

for (const theme of ['titanium-light', 'navy-slate']) {
  test(`${theme}: timeline fits desktop and contains horizontal scrolling on a narrow screen`, async ({ page }) => {
    await openTimeline(page, theme);
    const timeline = page.locator('.timeline-view');
    const scroll = timeline.locator('.timeline-scroll');
    for (const days of [7, 14]) {
      await timeline.getByRole('button', { name: `${days} 天`, exact: true }).click();
      expect(await scroll.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: `tests/theme/screenshots/timeline-${theme}-${days}.png` });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '收起左侧导航', exact: true }).click();
    await page.getByTitle('收起右侧节点列表', { exact: true }).click();
    await scroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    const title = timeline.getByRole('button', { name: '今日交付节点', exact: true });
    await expect.poll(() => title.evaluate((element) => {
      const scrollElement = element.closest('.timeline-scroll')!;
      const scrollBox = scrollElement.getBoundingClientRect();
      const titleBox = element.getBoundingClientRect();
      return document.documentElement.scrollWidth <= innerWidth
        && scrollBox.right <= innerWidth
        && titleBox.left >= scrollBox.left
        && titleBox.right <= scrollBox.right;
    })).toBe(true);
    await page.screenshot({ path: `tests/theme/screenshots/timeline-${theme}-390.png` });
  });
}
