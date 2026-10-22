import { test, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 10_000 });
const route = '/tests/theme/index.html?view=ai-agent&locale=en-US';

test('workspace suggestions fill the prompt without starting a run', async ({ page }) => {
  await page.goto(route);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('option', { name: 'Workspace Agent', exact: true }).click();
  await page.getByRole('button', { name: "Today's tasks", exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toHaveValue("Show today's tasks.");
  expect(await page.evaluate(() => (window as any).__aiFixture.requests.length)).toBe(0);
});

test('task, member, Wiki and project summary results have readable business cards', async ({ page }) => {
  await page.goto(route);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('option', { name: 'Workspace Agent', exact: true }).click();
  for (const prompt of ['show today', 'show members', 'find wiki', 'project progress']) {
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill(prompt);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  }
  for (const header of await page.locator('.ai-v2-tool > button').all()) await header.click();
  await expect(page.getByRole('link', { name: 'LAN-42 Review plan' })).toHaveAttribute('href', /lanmind:\/\/task\/business-task/);
  await expect(page.locator('.ai-business-card').filter({ hasText: 'Alex' })).toContainText('Project lead');
  await expect(page.getByRole('link', { name: 'Release runbook' })).toHaveAttribute('href', /lanmind:\/\/wiki\/runbook/);
  await expect(page.getByText('Completion: 70%')).toBeVisible();
});

for (const [prompt, expected] of [
  ['edit task', 'Review plan'], ['assign task', 'Alex'], ['set task state', 'In Progress'],
  ['add comment', 'Ready for review'], ['edit comment', 'Ready for review'],
  ['create wiki', 'Release runbook'], ['edit wiki', 'Release checklist'],
]) {
  test(`previews and confirms ${prompt} once`, async ({ page }) => {
    await page.goto(route);
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('option', { name: 'Workspace Agent', exact: true }).click();
    await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill(prompt);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByLabel('Operation preview')).toContainText(expected);
    expect(await page.evaluate(() => (window as any).__aiFixture.writes)).toBe(0);
    await page.getByRole('button', { name: 'Approve operation', exact: true }).click();
    await expect(page.locator('.ai-business-card').last()).toContainText(expected);
    expect(await page.evaluate(() => (window as any).__aiFixture.writes)).toBe(1);
    await page.getByRole('button', { name: 'Regenerate', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__aiFixture.writes)).toBe(1);
  });
}

test('rejecting a Wiki write has no side effects', async ({ page }) => {
  await page.goto(route);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('option', { name: 'Workspace Agent', exact: true }).click();
  await page.getByRole('textbox', { name: 'Prompt', exact: true }).fill('edit wiki');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(page.getByText('Operation rejected.', { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as any).__aiFixture.writes)).toBe(0);
});
