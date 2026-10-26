import { test, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 15_000 });

test.describe('Generate High-Definition UI Preview Screenshots', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('capture 09_wiki_knowledge_base.png', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=wiki-preview&theme=dark&locale=zh-CN');
    // Ensure document and tree are visible
    await expect(page.getByText('智域协同技术架构与产品白皮书').first()).toBeVisible();

    await page.getByRole('group', { name: '页面模式', exact: true }).getByRole('button', { name: '编辑', exact: true }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: '../docs/images/09_wiki_knowledge_base.png' });
  });

  test('capture 10_ai_agent_workspace.png', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=ai-agent&theme=dark&locale=zh-CN');
    await page.waitForTimeout(1000);
    const promptInput = page.locator('textarea');
    await expect(promptInput).toBeVisible();

    await promptInput.fill('请排查项目交付风险并给出任务排期调整建议');
    await page.getByRole('button', { name: '发送', exact: true }).click();

    const askCard = page.getByRole('region', { name: '需要你确认', exact: true });
    await expect(askCard).toBeVisible();

    const checkbox = askCard.getByRole('checkbox', { name: '调整优先级', exact: true });
    if (await checkbox.isVisible()) {
      await checkbox.check();
    }

    await page.waitForTimeout(600);
    await page.screenshot({ path: '../docs/images/10_ai_agent_workspace.png' });
  });

  test('capture 11_workspace_settings.png', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=workspace-settings-preview&theme=dark&locale=zh-CN');
    await expect(page.getByText('工作区设置与组织架构')).toBeVisible();

    // Switch to Users and Org tab
    const orgTab = page.getByRole('button', { name: /用户与组织/i });
    if (await orgTab.isVisible()) {
      await orgTab.click();
    }
    await expect(page.getByText('研发中心')).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: '../docs/images/11_workspace_settings.png' });
  });

  test('capture 02_tasks_list.png with modern task cards', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=task-cards&theme=dark&locale=zh-CN');
    const card = page.locator('[data-task-id="full"]');
    await expect(card).toBeVisible();

    const detailsBtn = card.getByRole('button', { name: /详情/ });
    if (await detailsBtn.isVisible()) {
      await detailsBtn.click();
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: '../docs/images/02_tasks_list.png' });
  });

  test('capture 12_task_recycle_bin.png', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=task-deletion&theme=dark&locale=zh-CN');
    const card = page.locator('.task-list-card[data-task-id="task-0"]');
    await card.getByRole('button', { name: '更多操作', exact: true }).click();
    await page.getByRole('menuitem', { name: '删除任务', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: '删除任务', exact: true });
    await expect(dialog).toContainText('保留 30 天');
    await dialog.locator('label').click();
    await dialog.getByRole('button', { name: '移入回收站', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: '任务回收站', exact: true }).click();
    await expect(page.locator('.task-recycle-view')).toBeVisible();
    await expect(page.locator('.recycle-list')).toHaveAttribute('aria-busy', 'false');

    await page.waitForTimeout(600);
    await page.screenshot({ path: '../docs/images/12_task_recycle_bin.png' });
  });

  test('capture 01_kanban_view.png', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=app&theme=dark&locale=zh-CN');
    const kanbanBtn = page.locator('.sidebar-nav-item', { hasText: '看板视图' });
    await expect(kanbanBtn).toBeVisible();
    await kanbanBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: '../docs/images/01_kanban_view.png' });
  });

  test('capture 03_calendar_view.png', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=app&theme=dark&locale=zh-CN');
    const calBtn = page.locator('.sidebar-nav-item', { hasText: '日历视图' });
    await expect(calBtn).toBeVisible();
    await calBtn.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: '../docs/images/03_calendar_view.png' });
  });

  test('capture 04_report_studio.png', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=report&theme=dark&locale=zh-CN');
    await expect(page.getByText('工作汇报').first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: '../docs/images/04_report_studio.png' });
  });

  test('capture 05_llm_settings.png', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=settings&tab=models&theme=dark&locale=zh-CN');
    await expect(page.getByText('系统设置').first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: '../docs/images/05_llm_settings.png' });
  });

  test('capture 07_lan_chat.png', async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=chat&theme=dark&locale=zh-CN');
    await expect(page.getByText('局域网聊天').first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: '../docs/images/07_lan_chat.png' });
  });
});
