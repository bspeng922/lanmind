import { expect, test, type Page } from '@playwright/test';

const modal = (page: Page) => page.locator('.task-detail-panel');
const title = (page: Page) => modal(page).getByRole('textbox', { name: '任务标题', exact: true });
const save = (page: Page, create = false) => modal(page).getByRole('button', { name: create ? '创建任务' : '保存更改', exact: true });
const payloads = (page: Page) => page.evaluate(() => (window as any).__taskFormFixture.payloads);

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 1024, 800, 390]) {
    for (const create of [true, false]) {
      test(`${theme}: ${create ? 'create' : 'edit'} form fits ${width}px and keeps properties accessible`, async ({ page }, info) => {
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/tests/theme/index.html?view=task&theme=${theme}${create ? '&create' : ''}&long-labels`);
        await expect(title(page)).toBeFocused();
        await title(page).fill('长任务标题：整理跨区域项目资料与协作交付计划 '.repeat(5));
        expect(await modal(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        if (create) {
          await expect(modal(page).locator('.task-create-advanced')).toBeHidden();
          await expect(modal(page)).toHaveCSS('max-width', '820px');
          await modal(page).getByRole('button', { name: '更多设置' }).click();
          await expect(modal(page).getByRole('button', { name: '选择任务开始日期' })).toBeVisible();
        } else if (width < 960) {
          await modal(page).getByRole('tab', { name: '任务属性', exact: true }).click();
          await expect(modal(page).locator('.task-detail-content')).toBeHidden();
        } else {
          await expect(modal(page).locator('.task-mobile-tabs')).toBeHidden();
          const positions = await modal(page).evaluate((node) => ({ content: node.querySelector('.task-detail-content')!.getBoundingClientRect().right, properties: node.querySelector('.task-properties-panel')!.getBoundingClientRect().left }));
          expect(positions.content).toBeCloseTo(positions.properties, 0);
        }
        const date = modal(page).getByRole('button', { name: '选择任务到期日期', exact: true });
        await expect(date).toContainText('2026-09-14');
        expect(await date.evaluate((node) => { const label = node.querySelector<HTMLElement>('.filter-select-value > span:last-child')!; return label.scrollWidth <= label.clientWidth; })).toBe(true);
        await modal(page).getByRole('button', { name: '选择任务优先级' }).click();
        const menu = page.getByRole('listbox', { name: '选择任务优先级' });
        await expect(menu).toBeVisible();
        expect(await menu.evaluate((node) => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; })).toBe(true);
        await page.keyboard.press('Escape');
        await expect(modal(page)).toBeVisible();
        await expect(save(page, create)).toBeInViewport();
        if (!create && width < 960) {
          await modal(page).getByRole('tab', { name: '详情', exact: true }).click();
          await expect(title(page)).toHaveValue(/长任务标题/);
        }
        expect(errors).toEqual([]);
        await page.screenshot({ path: info.outputPath('task-editor.png') });
      });
    }
  }
}

for (const create of [true, false]) test(`English ${create ? 'create' : 'edit'} form fits a narrow window`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tests/theme/index.html?view=task&locale=en-US&long-labels${create ? '&create' : ''}`);
  await expect(modal(page).getByRole('textbox', { name: 'Task title', exact: true })).toBeVisible();
  if (create) await modal(page).getByRole('button', { name: 'More settings' }).click();
  else await modal(page).getByRole('tab', { name: 'Task properties', exact: true }).click();
  await expect(modal(page).getByRole('button', { name: 'Choose task assignee' })).toBeVisible();
  expect(await modal(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await expect(modal(page).getByRole('button', { name: create ? 'Create task' : 'Save changes', exact: true })).toBeInViewport();
});

test('mobile tabs, collapsed settings, and discussion preserve drafts until explicit save', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/theme/index.html?view=task&theme=light');
  await title(page).fill('保留全部草稿');
  await modal(page).getByRole('textbox', { name: '任务 Markdown 内容' }).fill('正文草稿\n\n- [ ] 核对资料');
  await modal(page).getByRole('textbox', { name: '评论内容' }).fill('尚未发送的评论');
  await modal(page).getByRole('tab', { name: '任务动态', exact: true }).click();
  await modal(page).getByRole('tab', { name: /^评论/, exact: false }).click();
  await expect(modal(page).getByRole('textbox', { name: '评论内容' })).toHaveValue('尚未发送的评论');
  await modal(page).getByRole('tab', { name: '任务属性', exact: true }).click();
  await modal(page).getByRole('button', { name: '选择任务优先级' }).click();
  await page.getByRole('option').filter({ hasText: 'P2' }).click();
  await modal(page).getByRole('button', { name: '时间、提醒与重复' }).click();
  await modal(page).getByRole('button', { name: '选择到期小时' }).click();
  await page.getByRole('option', { name: '09 时', exact: true }).click();
  await modal(page).getByRole('button', { name: '时间、提醒与重复' }).click();
  await modal(page).getByRole('tab', { name: '详情', exact: true }).click();
  await expect(title(page)).toHaveValue('保留全部草稿');
  expect(await payloads(page)).toEqual([]);
  await save(page).click();
  await expect(modal(page)).toHaveCount(0);
  expect((await payloads(page))[0]).toMatchObject({ title: '保留全部草稿', priority: 'P2', dueDate: '2026-09-14T09:00' });
});

test('cancel discards drafts and failed saves retain changes for retry', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task&create&theme=light');
  await title(page).fill('取消的草稿');
  await modal(page).getByRole('button', { name: '取消', exact: true }).click();
  expect(await payloads(page)).toEqual([]);
  await page.getByRole('button', { name: 'Reopen task form' }).click();
  await expect(title(page)).toHaveValue('');
  await title(page).fill('失败后重试');
  await page.evaluate(() => { (window as any).__taskFormFixture.failSave = true; });
  await save(page, true).click();
  await expect(modal(page).getByRole('alert')).toHaveText('Fixture save failed');
  await expect(title(page)).toHaveValue('失败后重试');
  await page.evaluate(() => { (window as any).__taskFormFixture.failSave = false; });
  await save(page, true).click();
  await expect(modal(page)).toHaveCount(0);
  expect((await payloads(page))[0].title).toBe('失败后重试');
});

test('date validation opens hidden properties and state changes update progress', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-19T12:00:00+08:00'));
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/tests/theme/index.html?view=task&theme=light');
  await modal(page).getByRole('tab', { name: '任务属性', exact: true }).click();
  await modal(page).getByRole('button', { name: '选择任务状态' }).click();
  await page.getByRole('option', { name: '已完成', exact: true }).click();
  await expect(modal(page).getByRole('slider', { name: '完成进度' })).toHaveValue('100');
  await modal(page).getByRole('button', { name: '选择任务开始日期' }).click();
  const picker = page.getByRole('dialog', { name: '选择任务开始日期', exact: true });
  await picker.getByRole('button', { name: '今天', exact: true }).click();
  await modal(page).getByRole('tab', { name: '详情', exact: true }).click();
  await save(page).click();
  await expect(modal(page).getByRole('alert')).toBeVisible();
  await expect(modal(page).getByRole('tab', { name: '任务属性', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(modal(page).getByRole('button', { name: '选择任务开始日期' })).toBeFocused();
  expect(await payloads(page)).toEqual([]);
});

test('Markdown, checklist, images and child tasks survive saving and reopening', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task&theme=light');
  const description = modal(page).getByRole('textbox', { name: '任务 Markdown 内容' });
  await description.fill('保留正文\n\n- [ ] 检查资料');
  await modal(page).getByRole('button', { name: '检查事项', exact: true }).click();
  await modal(page).getByRole('textbox', { name: '检查事项：检查资料', exact: true }).fill('检查新资料');
  await modal(page).getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(description).toHaveValue('保留正文\n\n- [ ] 检查新资料');
  await modal(page).getByLabel('添加任务附件', { exact: true }).setInputFiles({ name: '资料.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG2kAAAAASUVORK5CYII=', 'base64') });
  await modal(page).getByRole('button', { name: '插入附件图片', exact: true }).click();
  await modal(page).getByRole('button', { name: '资料.png', exact: true }).click();
  await modal(page).getByRole('button', { name: '预览', exact: true }).click();
  await expect(modal(page).locator('article img')).toBeVisible();
  await modal(page).getByRole('button', { name: '添加子任务', exact: true }).click();
  await modal(page).getByRole('textbox', { name: '子任务 1 名称', exact: true }).fill('子任务草稿');
  await save(page).click();
  const [saved] = await payloads(page);
  expect(saved.childTasks[0].title).toBe('子任务草稿');
  expect(saved.attachments[0].name).toBe('资料.png');
  expect(saved.description).toContain('检查新资料');
  await page.getByRole('button', { name: 'Reopen task form' }).click();
  await expect(modal(page).getByRole('button', { name: '预览 资料.png', exact: true })).toBeVisible();
  await modal(page).getByRole('button', { name: '预览', exact: true }).click();
  await expect(modal(page).locator('article img')).toBeVisible();
});

test('long tags fit and cancelling tag creation with Escape keeps the form open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/theme/index.html?view=task&create&theme=dark');
  const tags = modal(page).getByRole('region', { name: '任务标签', exact: true });
  await tags.getByRole('button', { name: '选择标签' }).click();
  await tags.getByRole('button', { name: '选择标签：验收', exact: true }).click();
  await tags.getByRole('button', { name: '创建标签', exact: true }).click();
  const input = tags.getByRole('textbox', { name: '新标签名称' });
  await input.fill('用于跨区域协作与验收的很长的任务标签'.repeat(3));
  await input.press('Enter');
  expect(await tags.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await tags.getByRole('button', { name: '创建标签', exact: true }).click();
  await input.fill('未提交的标签');
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
  expect(await payloads(page)).toEqual([]);
});

test('recurrence validation reveals collapsed settings and focuses the due date', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task&create&theme=light');
  await title(page).fill('重复任务');
  await modal(page).getByRole('button', { name: '更多设置' }).click();
  await modal(page).getByRole('button', { name: '选择循环频率' }).click();
  await page.getByRole('option', { name: '每周', exact: true }).click();
  await modal(page).getByRole('button', { name: '更多设置' }).click();
  await modal(page).getByRole('button', { name: '清除日期', exact: true }).click();
  await save(page, true).click();
  await expect(modal(page).getByRole('alert')).toBeVisible();
  await expect(modal(page).getByRole('button', { name: '更多设置' })).toHaveAttribute('aria-expanded', 'true');
  await expect(modal(page).getByRole('button', { name: '选择任务到期日期' })).toBeFocused();
  expect(await payloads(page)).toEqual([]);
});

test('keyboard focus stays within the dialog and mobile sections support arrow keys', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/theme/index.html?view=task&theme=light');
  await save(page).focus();
  await page.keyboard.press('Tab');
  await expect(modal(page).getByRole('button', { name: '上一个任务', exact: true })).not.toBeFocused();
  expect(await modal(page).evaluate((node) => node.contains(document.activeElement))).toBe(true);
  const details = modal(page).getByRole('tab', { name: '详情', exact: true });
  await details.focus();
  await page.keyboard.press('ArrowRight');
  await expect(modal(page).getByRole('tab', { name: '任务属性', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(details).toBeFocused();
});

test('long titles grow when the window narrows', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task&theme=light');
  await title(page).fill('跨区域任务创建与编辑布局检查'.repeat(2));
  const wideHeight = await title(page).evaluate((node) => node.clientHeight);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => title(page).evaluate((node) => node.clientHeight)).toBeGreaterThan(wideHeight);
  expect(await title(page).evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true);
});
