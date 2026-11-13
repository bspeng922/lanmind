import { expect, test } from '@playwright/test';

for (const form of [
  { tab: 'Skills', open: 'Edit', title: /Configure Skill:/ },
  { tab: 'MCP client', open: 'Add MCP connection', title: 'Add MCP Server' },
  { tab: 'Schedules', open: 'Add schedule', title: 'New Scheduled Task' },
]) {
  test(`${form.tab}: backdrop clicks preserve editing and the parent settings dialog`, async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=ai-agent&locale=en-US');
    await page.getByRole('button', { name: 'Models and Agent settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Models and Agent settings', exact: true });
    await settings.getByRole('button', { name: form.tab, exact: true }).click();
    await settings.getByRole('button', { name: form.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: form.title, exact: true });
    const name = dialog.getByRole('textbox', { name: 'Name', exact: true });
    await name.fill('Unsaved changes');
    await dialog.click({ position: { x: 4, y: 4 } });
    await expect(name).toHaveValue('Unsaved changes');
    await expect(settings).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await settings.click({ position: { x: 4, y: 4 } });
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(settings).toHaveCount(0);
  });
}

test('provider deletion requires explicit dismissal while history allows a backdrop click', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=ai-agent&locale=en-US');
  await page.getByRole('button', { name: 'Models and Agent settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Models and Agent settings', exact: true });
  await settings.locator('div.group').filter({ hasText: 'Local Ollama' }).getByTitle('Delete provider', { exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete Model Provider', exact: true });
  await deletion.click({ position: { x: 4, y: 4 } });
  await expect(deletion).toBeVisible();
  expect(await page.evaluate(() => (window as any).__aiFixture.data.catalog.connections.length)).toBe(2);
  await deletion.getByRole('button', { name: 'Cancel', exact: true }).click();
  await settings.getByRole('button', { name: 'Schedules', exact: true }).click();
  await settings.getByRole('button', { name: 'Add schedule', exact: true }).click();
  const schedule = page.getByRole('dialog', { name: 'New Scheduled Task', exact: true });
  await schedule.getByRole('textbox', { name: 'Name', exact: true }).fill('Review');
  await schedule.getByRole('textbox', { name: 'Prompt', exact: true }).fill('Read current tasks');
  await schedule.getByRole('button', { name: 'Save', exact: true }).click();
  await settings.getByRole('button', { name: /History/ }).click();
  const history = page.getByRole('dialog', { name: 'Execution History', exact: true });
  await expect(history).toBeVisible();
  await history.click({ position: { x: 4, y: 4 } });
  await expect(history).toHaveCount(0);
  await expect(settings).toBeVisible();
});
