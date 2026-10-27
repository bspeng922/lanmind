import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`${theme}: workspace menu creates and enters, without a join entry`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=workspace-management&theme=${theme}&locale=en-US`);
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Workspace', exact: true });
    await expect(menu.getByText(/join/i)).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'New Workspace', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New Workspace', exact: true });
    const name = dialog.getByRole('textbox', { name: 'Workspace name', exact: true });
    const submit = dialog.getByRole('button', { name: 'Create and Enter', exact: true });
    await expect(name).toBeFocused();
    await expect(submit).toBeDisabled();
    await name.fill('   ');
    await expect(submit).toBeDisabled();
    await name.fill('  New Team  ');
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: /London/i }).click();
    await submit.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('create-calls')).toHaveText('1');
    await expect(page.getByTestId('switch-calls')).toHaveText('1');
    await expect(page.getByTestId('create-request')).toHaveText(JSON.stringify({ name: 'New Team', timezone: 'Europe/London', currentUserId: 'alice' }));
    await expect(page.getByTestId('active-workspace')).toHaveText('New Team');
  });
}

test('failed creation preserves values and can be retried', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=workspace-management&failCreate=1&locale=en-US');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Workspace', exact: true });
  await dialog.getByRole('textbox').fill('New Team');
  await dialog.getByRole('button', { name: 'Create and Enter', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Unable to create workspace. Try again.');
  await expect(dialog.getByRole('textbox')).toHaveValue('New Team');
  await expect(page.getByTestId('switch-calls')).toHaveText('0');
  await page.getByRole('button', { name: 'Allow retry', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await dialog.getByRole('button', { name: 'Create and Enter', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('create-calls')).toHaveText('2');
});

test('retry after an entry failure never creates a duplicate workspace', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=workspace-management&failSwitch=1&nativeSwitchFailure=1&locale=en-US');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Workspace', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New Workspace', exact: true });
  await dialog.getByRole('textbox').fill('New Team');
  await dialog.getByRole('button', { name: 'Create and Enter', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Unable to enter workspace. Try again.');
  await expect(dialog.getByRole('textbox')).toBeDisabled();
  await expect(page.getByTestId('active-workspace')).toHaveText('Design Team');
  await page.getByRole('button', { name: 'Allow retry', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  await dialog.getByRole('button', { name: 'Try Entering Again', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('create-calls')).toHaveText('1');
  await expect(page.getByTestId('switch-calls')).toHaveText('2');
});

test('receiving a workspace shows a notice without switching; the recipient can enter later', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=workspace-management&locale=en-US');
  await page.getByRole('button', { name: 'Receive workspace', exact: true }).click();
  const notice = page.locator('div[role="status"]');
  await expect(notice).toContainText('Research Team');
  await expect(page.getByTestId('active-workspace')).toHaveText('Design Team');
  await expect(page.getByTestId('switch-calls')).toHaveText('0');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.getByRole('menu').getByRole('button', { name: /Research Team/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await notice.getByRole('button', { name: 'Switch Workspace', exact: true }).click();
  await expect(page.getByTestId('active-workspace')).toHaveText('Research Team');
  await expect(notice).toHaveCount(0);
});

for (const role of ['owner', 'admin', 'member', 'guest', 'pending']) {
  test(`${role}: member management is restricted to admitted managers`, async ({ page }) => {
    const query = role === 'pending' ? 'role=admin&pending=1' : `role=${role}`;
    await page.goto(`/tests/theme/index.html?view=workspace-management&${query}&locale=en-US`);
    await page.getByRole('button', { name: 'Workspace', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Workspace Settings', exact: true }).click();
    await page.getByRole('button', { name: /Users & Organization/ }).click();
    const add = page.getByRole('button', { name: 'Add Member', exact: true });
    if (role !== 'owner' && role !== 'admin') {
      await expect(add).toHaveCount(0);
      return;
    }
    await add.click();
    const dialog = page.getByRole('dialog', { name: 'Add Member', exact: true });
    await expect(dialog).toContainText('Offline devices');
    await dialog.getByRole('button', { name: 'Confirm Add', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('member-request')).toHaveText(JSON.stringify({ userId: 'bob', role: 'member', operator: 'alice' }));
  });
}
