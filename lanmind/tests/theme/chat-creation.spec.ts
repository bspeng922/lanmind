import { expect, test } from '@playwright/test';

for (const role of ['owner', 'admin']) {
  for (const embedded of [false, true]) {
    test(`${role} creates the first group in an empty workspace (${embedded ? 'page' : 'modal'})`, async ({ page }) => {
      await page.goto(`/tests/theme/index.html?view=chat-creation&locale=en-US&role=${role}${embedded ? '&embedded' : ''}`);
      const launch = page.getByRole('button', { name: 'Create group', exact: true }).first();
      await expect(launch).toBeVisible();
      await expect(page.locator('.chat-group-item')).toHaveCount(0);
      await launch.click();
      const form = page.locator('#create-group-form');
      await expect(form).toBeVisible();
      await form.getByPlaceholder('e.g. Frontend and AI Team').fill('First workspace group');
      await form.getByText('Teammate', { exact: true }).click();
      await expect(form.getByRole('checkbox', { name: 'Select member: Teammate', exact: true })).toBeChecked();
      await page.locator('button[form="create-group-form"]').click();
      await expect(form).toHaveCount(0);
      await expect(page.getByText('First workspace group', { exact: true }).first()).toBeVisible();
    });
  }
}

for (const role of ['member', 'guest', 'pending', 'other-workspace']) {
  test(`${role} does not receive workspace manager group-creation privileges`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=chat-creation&locale=en-US&role=${role}&embedded`);
    await expect(page.getByText('No groups', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create group', exact: true })).toHaveCount(0);
  });
}
