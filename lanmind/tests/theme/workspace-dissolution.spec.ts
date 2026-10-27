import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`${theme}: dissolution requires exact name, cancellation preserves parent settings, and success switches workspace`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=workspace-dissolution&theme=${theme}&locale=zh-CN`);
    const trigger = page.getByRole('button', { name: '解散工作区', exact: true });
    await trigger.click();
    const dialog = page.getByRole('alertdialog', { name: '解散工作区' });
    const input = dialog.getByRole('textbox');
    const confirm = dialog.getByRole('button', { name: '解散工作区', exact: true });
    await expect(input).toBeFocused();
    await expect(confirm).toBeDisabled();
    await input.fill('Design');
    await expect(confirm).toBeDisabled();
    await input.fill('Design Team ');
    await expect(confirm).toBeDisabled();
    await input.fill('Design Team');
    await expect(confirm).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: '工作区', exact: true })).toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId('dissolution-calls')).toHaveText('0');
    await trigger.click();
    await expect(input).toHaveValue('');
    await input.fill('Design Team');
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('active-workspace')).toHaveText('My Workspace');
    await expect(page.getByTestId('dissolution-calls')).toHaveText('1');
    await expect(page.getByTestId('dissolution-request')).toHaveText(JSON.stringify({ workspaceId: 'workspace-a', userId: 'alice', confirmationName: 'Design Team' }));
  });
}

for (const role of ['admin', 'member']) {
  test(`${role} cannot see workspace dissolution`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=workspace-dissolution&role=${role}&locale=zh-CN`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('button', { name: '解散工作区', exact: true })).toHaveCount(0);
  });
}

test('failed dissolution keeps confirmation and allows retry', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=workspace-dissolution&fail=1&locale=en-US');
  await page.getByRole('button', { name: 'Dissolve Workspace', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('textbox').fill('Design Team');
  await dialog.getByRole('button', { name: 'Dissolve Workspace', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Unable to dissolve workspace. Try again.');
  await expect(dialog.getByRole('textbox')).toHaveValue('Design Team');
  await expect(page.getByTestId('active-workspace')).toHaveText('Design Team');
  await page.getByRole('button', { name: 'Allow retry', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await dialog.getByRole('button', { name: 'Dissolve Workspace', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('dissolution-calls')).toHaveText('2');
  await expect(page.getByTestId('active-workspace')).toHaveText('My Workspace');
});

test('pending dissolution prevents duplicate submission and dismissal', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=workspace-dissolution&defer=1&locale=en-US');
  await page.getByRole('button', { name: 'Dissolve Workspace', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('textbox').fill('Design Team');
  await dialog.getByRole('button', { name: 'Dissolve Workspace', exact: true }).click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(dialog.getByRole('button', { name: 'Dissolving…' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('dissolution-calls')).toHaveText('1');
  await page.getByRole('button', { name: 'Finish request', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(dialog).toHaveCount(0);
});

test('English narrow layout keeps confirmation controls within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto('/tests/theme/index.html?view=workspace-dissolution&locale=en-US&theme=dark');
  await page.getByRole('button', { name: 'Dissolve Workspace', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Dissolve Workspace', exact: true })).toBeInViewport();
});
