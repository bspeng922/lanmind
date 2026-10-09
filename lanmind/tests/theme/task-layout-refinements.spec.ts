import { expect, test } from '@playwright/test';

for (const locale of ['zh-CN', 'en-US']) {
  for (const width of [1440, 390]) {
    for (const create of [false, true]) {
      test(`${locale}: ${create ? 'new' : 'edit'} task keeps long dropdowns on one line at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`/tests/theme/index.html?view=task&locale=${locale}&long-labels${create ? '&create' : ''}`);
        const modal = page.locator('.task-detail-panel');
        const fields = modal.locator('.task-detail-date-fields .theme-date-picker-trigger');
        await expect(fields).toHaveCount(2);
        const dates = await fields.evaluateAll((nodes) => nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          const value = node.querySelector<HTMLElement>('.filter-select-value > span:last-child')!;
          return { left: rect.left, top: rect.top, bottom: rect.bottom, height: rect.height, complete: value.scrollWidth <= value.clientWidth + 1 };
        }));
        expect(dates[1].left).toBeCloseTo(dates[0].left, 1);
        expect(dates[1].top).toBeGreaterThan(dates[0].bottom);
        expect(dates.every((date) => date.complete && date.height === 32)).toBe(true);
        await expect(fields.last()).toContainText('2026-09-14');
        if (!create) await expect(fields.first()).toContainText('2026-09-01');

        const assignee = modal.getByRole('button', { name: locale === 'zh-CN' ? '选择任务负责人' : 'Choose task assignee', exact: true });
        await expect(assignee).toHaveAttribute('title', /Alexandra Chen/);
        const geometry = await assignee.evaluate((node) => {
          const label = node.querySelector<HTMLElement>('.filter-select-value > span:last-child')!;
          return { height: node.getBoundingClientRect().height, whiteSpace: getComputedStyle(label).whiteSpace, overflow: getComputedStyle(label).textOverflow, truncated: label.scrollWidth > label.clientWidth };
        });
        expect(geometry).toEqual({ height: 32, whiteSpace: 'nowrap', overflow: 'ellipsis', truncated: true });
        await assignee.click();
        const options = page.getByRole('listbox').getByRole('option');
        expect(await options.evaluateAll((nodes) => nodes.every((node) => node.getBoundingClientRect().height === 30 && getComputedStyle(node.querySelector('.filter-select-option-label > span:last-child')!).whiteSpace === 'nowrap'))).toBe(true);
        await page.screenshot({ path: info.outputPath('assignee.png') });
        await page.keyboard.press('Escape');

        const priority = modal.getByRole('button', { name: locale === 'zh-CN' ? '选择任务优先级' : 'Choose task priority', exact: true });
        await priority.click();
        const priorityOptions = page.getByRole('listbox').getByRole('option');
        const colors = await priorityOptions.locator('svg').evaluateAll((nodes) => nodes.filter((node) => node.classList.contains('filter-select-flag')).map((node) => getComputedStyle(node).color));
        expect(new Set(colors).size).toBe(4);
        await priorityOptions.last().click();
        await expect(priority).toContainText('P4');
        await expect(priority.locator('.filter-select-dot')).toHaveCount(0);
        await expect(priority.locator('.filter-select-flag')).toHaveCount(1);
        expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        await fields.first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath('task-dates.png') });
      });
    }

    test(`${locale}: abandoned kanban stays to the right and is reachable at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/tests/theme/index.html?view=project-layout&locale=${locale}`);
      await page.locator('[data-project-drag-id="theme-project"]').click();
      if (width < 1000) {
        await page.getByRole('button', { name: locale === 'zh-CN' ? '收起左侧导航' : 'Collapse navigation', exact: true }).click();
        await page.getByTitle(locale === 'zh-CN' ? '收起右侧节点列表' : 'Collapse nodes panel', { exact: true }).click();
      }
      await page.getByRole('button', { name: locale === 'zh-CN' ? '项目排序和过滤' : 'Project sorting and filters', exact: true }).click();
      await page.locator('.project-layout-row[data-field="statusFilter"] button').click();
      await page.getByRole('listbox').getByRole('option').last().click();
      await page.getByRole('button', { name: locale === 'zh-CN' ? '项目布局' : 'Project layout', exact: true }).click();
      await page.locator('.project-layout-views button').nth(1).click();
      await page.locator('.project-toolbar h2').click();
      const board = page.locator('.kanban-board');
      await expect(board.locator('[data-kanban-status]')).toHaveCount(5);
      const positions = await board.evaluate((node) => {
        const viewport = node.getBoundingClientRect();
        return { left: viewport.left, right: viewport.right, scrollLeft: node.scrollLeft, overflow: node.scrollWidth > node.clientWidth, columns: [...node.children].map((child) => { const rect = child.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top }; }) };
      });
      expect(positions.scrollLeft).toBe(0);
      expect(positions.overflow).toBe(true);
      expect(positions.columns.every((column) => Math.abs(column.top - positions.columns[0].top) < 1)).toBe(true);
      const visibleColumns = width >= 1024 ? 4 : 1;
      expect(positions.columns[visibleColumns - 1].right).toBeLessThanOrEqual(positions.right);
      expect(positions.columns[visibleColumns].left).toBeGreaterThanOrEqual(positions.right - 1);
      await page.screenshot({ path: info.outputPath('first-columns.png') });
      await board.evaluate((node) => { node.scrollLeft = node.scrollWidth; });
      await expect(board.getByText('归档暂缓事项', { exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath('abandoned.png') });
    });
  }
}
