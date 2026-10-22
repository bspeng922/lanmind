import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  for (const create of [true, false]) {
    test(`${theme}: ${create ? 'create' : 'edit'} task opens, updates tags and reopens without crashing`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/tests/theme/index.html?view=task&theme=${theme}&closed${create ? '&create' : ''}`);

      const dialog = page.getByRole('dialog', { name: create ? '创建任务' : '编辑任务', exact: true });
      await expect(dialog).toHaveCount(0);
      await page.getByRole('button', { name: 'Reopen task form' }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByPlaceholder('请输入任务标题...')).toHaveValue(create ? '' : '整理项目资料');
      const tags = dialog.getByRole('region', { name: '任务标签', exact: true });
      const selected = tags.getByLabel('已选标签', { exact: true });
      await expect(selected.getByText(create ? '#日常' : '#验收', { exact: true })).toBeVisible();

      await tags.getByRole('button', { name: '创建标签', exact: true }).click();
      const input = tags.getByRole('textbox', { name: '新标签名称', exact: true });
      await input.fill('弹窗回归验证');
      await input.press('Enter');
      await expect(selected.getByText('#弹窗回归验证', { exact: true })).toBeVisible();
      await selected.getByRole('button', { name: '移除标签：弹窗回归验证', exact: true }).click();
      await expect(selected.getByText('#弹窗回归验证', { exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: create ? '创建任务' : '保存更改', exact: true })).toBeEnabled();
      await dialog.getByRole('textbox', { name: '任务标题', exact: true }).fill('尚未保存的标题');
      await dialog.getByRole('button', { name: create ? '取消' : '关闭', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await page.getByRole('button', { name: 'Reopen task form' }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: '任务标题', exact: true })).toHaveValue(create ? '' : '整理项目资料');
      expect(errors).toEqual([]);
    });
  }

  test(`${theme}: task preview opens and updates tags without crashing`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/tests/theme/index.html?view=task-peek&theme=${theme}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const tags = dialog.getByRole('region', { name: '任务标签', exact: true });
    const selected = tags.getByLabel('已选标签', { exact: true });
    await expect(selected.getByText('#验收', { exact: true })).toBeVisible();
    await selected.getByRole('button', { name: '移除标签：验收', exact: true }).click();
    await expect(selected.getByText('#验收', { exact: true })).toHaveCount(0);
    await tags.getByRole('button', { name: '选择标签：验收', exact: true }).click();
    await expect(selected.getByText('#验收', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
