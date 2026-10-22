import { expect, test } from '@playwright/test';

const richCard = (page: import('@playwright/test').Page) => page.locator('[data-task-id="full"]');

async function expectNoOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('.task-list-view,.task-list-card,.project-toolbar,.task-list-toolbar,.task-card-heading,.task-card-preview,.task-card-properties,.task-card-summary,.task-card-expanded')]
    .filter((node) => node.getBoundingClientRect().width > 0 && node.scrollWidth > node.clientWidth + 1).map((node) => node.className));
  expect(overflow).toEqual([]);
}

async function expectDetailsAtBottomRight(page: import('@playwright/test').Page) {
  const misplaced = await page.locator('.task-card-preview').evaluateAll((previews) => previews.filter((preview) => {
    const bounds = preview.getBoundingClientRect();
    const button = preview.querySelector('.task-card-expand')!.getBoundingClientRect();
    return Math.abs(button.right - bounds.right) > 1 || Math.abs(button.bottom - bounds.bottom) > 1;
  }).map((preview) => preview.closest('[data-task-id]')!.getAttribute('data-task-id')));
  expect(misplaced).toEqual([]);
}

test('compact cards keep key fields visible and open complete content through explicit controls', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-21T12:00:00'));
  await page.goto('/tests/theme/index.html?view=task-cards&theme=light');
  const card = richCard(page);
  await expect(card).toContainText('LAN-12');
  await expect(card).toContainText('待验收');
  await expect(card.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '0');
  await expect(card.locator('.task-card-properties')).toContainText('负责人');
  await expect(card.locator('.task-card-schedule time').last()).toHaveAttribute('datetime', '2026-10-21T18:00');
  await expect(card.locator('.task-card-schedule')).toContainText('18:00');
  await expect(card.locator('.task-card-overdue')).toHaveCount(0);
  await expect(card.locator('.task-card-description')).toContainText('安装');
  await expect(card.locator('.task-card-description')).not.toContainText('https://');
  await expect(card.locator('.task-card-description')).not.toContainText('核对安装');
  await expect(card.locator('.task-card-audit')).toHaveCount(0);
  await expect(card.locator('.task-card-detail-properties')).toHaveCount(0);
  await card.getByRole('button', { name: '查看提醒时间', exact: true }).click();
  await expect(card.locator('.task-card-detail-properties')).toContainText('2026-10-21 17:30');
  await expect(card.locator('.task-card-audit')).toContainText('协作成员');
  await card.getByRole('button', { name: '显示全部标签' }).click();
  await expect(card.locator('.task-card-tags')).toContainText('#桌面端');
  await expect(card.locator('.task-card-full-description')).not.toContainText('核对安装');
  await expect(card.getByLabel('子任务：发布前检查')).toContainText('LAN-14');
  await expect(card.getByLabel('子任务：发布前检查')).toContainText('2026-10-21 17:00');
  await card.locator('label').filter({ has: page.getByRole('checkbox', { name: '标记完成检查事项：核对安装' }) }).click();
  await expect(card.getByRole('checkbox', { name: '标记完成检查事项：核对安装' })).toBeChecked();
  await expect(card.locator('.task-card-supplement')).toContainText('检查事项:2/2');
  await card.locator('label').filter({ has: page.getByRole('checkbox', { name: '标记完成子任务：独立子任务' }) }).click();
  await expect(card.getByRole('checkbox', { name: '标记完成子任务：独立子任务' })).toBeChecked();
  await expect(card.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '0');
  const attachments = page.locator('[data-task-id="files-only"]');
  await expect(attachments).toContainText('进度未设置');
  await expect(attachments).toContainText('未排期');
  await attachments.getByRole('button', { name: '1个附件', exact: true }).click();
  await expect(attachments.getByRole('button', { name: '发布说明.txt' })).toBeVisible();
  await expect(attachments.getByRole('button', { name: '下载', exact: true })).toBeVisible();
  await expect(attachments.locator('.task-card-attachment')).toContainText('TXT');
  const shared = page.locator('[data-task-id="shared-personal"]');
  await shared.getByRole('button', { name: '共享给 1 人' }).click();
  await expect(shared.locator('[data-task-section="sharing"]')).toContainText('协作成员');
  await expect(shared).toContainText('未设截止时间');
});

test('ordinary tasks expose audit records and retain keyboard focus when toggling details', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-cards&theme=light');
  const plain = page.locator('[data-task-id="plain"]');
  await expect(plain.locator('.task-card-summary')).toHaveCount(0);
  await expect(plain.locator('.task-card-audit')).toHaveCount(0);
  const trigger = plain.getByRole('button', { name: '展开任务详情', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(plain.locator('.task-card-audit')).toBeVisible();
  await expect(plain.getByRole('button', { name: '收起任务详情', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(plain.locator('.task-card-expanded')).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('read-only cards keep details accessible and disable parent, child and checklist changes', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-cards&theme=light&read-only');
  const card = richCard(page);
  await expect(card.locator('.task-card-state')).toBeDisabled();
  await expect(card).toContainText('只读');
  await card.getByRole('button', { name: '展开任务详情', exact: true }).click();
  const checkboxes = card.getByRole('checkbox');
  await expect(checkboxes).toHaveCount(3);
  for (const checkbox of await checkboxes.all()) await expect(checkbox).toBeDisabled();
  await expect(card.getByRole('button', { name: '编辑任务', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: '置顶任务', exact: true }).click();
  await expect(card.getByRole('button', { name: '取消置顶任务', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: '更多操作', exact: true }).click();
  await expect(card.getByRole('menuitem', { name: '编辑任务', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await card.getByRole('button', { name: '发布前检查', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '任务详情' })).toBeVisible();
});

test('title counts follow filters and custom completion states without duplicate display bars', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-cards&theme=light');
  await expect(page.locator('.task-list-density,.task-list-display-bar,[data-density]')).toHaveCount(0);
  await expect(page.locator('.task-list-count')).toContainText('显示 4 / 5 项');
  await page.locator('.task-list-toolbar input').fill('发布前');
  await expect(page.locator('.task-list-count')).toContainText('显示 1 / 5 项');
  await page.getByRole('button', { name: '协作项目', exact: true }).click();
  await expect(page.locator('.project-task-count')).toContainText('显示 3 / 4 项');
  await expect(page.locator('.project-completed-count')).toContainText('已完成 1');
  await expect(richCard(page).locator('.task-card-project')).toHaveCount(0);
  await page.locator('.project-toolbar input').fill('发布前');
  await expect(page.locator('.project-task-count')).toContainText('显示 1 / 4 项');
  await richCard(page).locator('.task-card-state').click();
  await expect(richCard(page)).toHaveCount(0);
  await expect(page.locator('.project-task-count')).toContainText('显示 0 / 4 项');
  await expect(page.locator('.project-completed-count')).toContainText('已完成 2');
});

test('pin and edit buttons appear before More and retain their actions', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=task-cards&theme=light');
  const card = richCard(page);
  const actions = card.locator('.task-card-actions button');
  await expect(actions).toHaveCount(3);
  await expect(actions.nth(0)).toHaveAccessibleName('置顶任务');
  await expect(actions.nth(1)).toHaveAccessibleName('编辑任务');
  await expect(actions.nth(2)).toHaveAccessibleName('更多操作');
  await expect(actions.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await card.getByRole('button', { name: '更多操作', exact: true }).click();
  await expect(card.getByRole('menuitem', { name: '置顶任务', exact: true })).toHaveCount(0);
  await expect(card.getByRole('menuitem', { name: '编辑任务', exact: true })).toHaveCount(0);
  await card.getByRole('button', { name: '置顶任务', exact: true }).click();
  await expect(card.getByRole('menu')).toHaveCount(0);
  await expect(card.getByRole('button', { name: '取消置顶任务', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(card.getByRole('button', { name: '取消置顶任务', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: '取消置顶任务', exact: true }).click();
  await expect(card.getByRole('button', { name: '置顶任务', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await card.getByRole('button', { name: '更多操作', exact: true }).click();
  await card.getByRole('button', { name: '编辑任务', exact: true }).click();
  await expect(card.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '任务详情' })).toBeVisible();
});

test('task actions stay inside the scrolling list near its lower edge', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 420 });
  await page.goto('/tests/theme/index.html?view=task-cards&theme=light');
  const plain = page.locator('[data-task-id="plain"]');
  await plain.getByRole('button', { name: '更多操作', exact: true }).click();
  const menu = plain.getByRole('menu');
  await expect(menu).toBeVisible();
  const bounds = await menu.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const list = node.closest('.task-list-scroll')!.getBoundingClientRect();
    return rect.top >= list.top && rect.bottom <= list.bottom + 1 && rect.left >= 0 && rect.right <= innerWidth;
  });
  expect(bounds).toBe(true);
  await menu.getByRole('menuitem', { name: '删除任务', exact: true }).scrollIntoViewIfNeeded();
  await expect(menu.getByRole('menuitem', { name: '删除任务', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(plain.getByRole('button', { name: '更多操作', exact: true })).toBeFocused();
});

for (const locale of ['zh-CN', 'en-US']) for (const theme of ['light', 'dark']) for (const width of [1440, 1024, 800, 390]) {
  test(`${locale} ${theme}: compact cards and expanded content fit both scopes at ${width}px`, async ({ page }, info) => {
    await page.clock.setFixedTime(new Date('2026-10-21T12:00:00'));
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/tests/theme/index.html?view=task-cards&theme=${theme}&locale=${locale}`);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (let scope = 0; scope < 2; scope++) {
      await page.locator('nav > button').nth(scope).click();
      const card = richCard(page);
      await expect(card.locator('.task-card-description')).toBeVisible();
      await expect(card.locator('.task-card-properties')).toBeVisible();
      await expect(card.locator('.task-card-schedule')).toBeVisible();
      await expect(card.locator('.task-card-audit')).toHaveCount(0);
      await expect(page.locator(scope ? '.project-task-count' : '.task-list-count')).toBeVisible();
      if (width === 1440) {
        expect((await card.boundingBox())!.height).toBeLessThanOrEqual(110);
        expect((await page.locator('[data-task-id="plain"]').boundingBox())!.height).toBeLessThanOrEqual(80);
      }
      await expectDetailsAtBottomRight(page);
      await expectNoOverflow(page);
      await card.locator('.task-card-expand').click();
      await expect(card.locator('.task-card-audit')).toBeVisible();
      await expectNoOverflow(page);
      await card.locator('.task-card-expand').click();
      await expect(card.locator('.task-card-expanded')).toBeHidden();
    }
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('task-cards.png') });
  });
}
