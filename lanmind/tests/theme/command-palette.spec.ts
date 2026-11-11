import { expect, test } from '@playwright/test';

test('Open AI in the command palette opens the working AI workspace', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=command-palette&locale=en-US');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByPlaceholder('Search commands').fill('Open AI');
  await palette.getByRole('button', { name: 'Open AI', exact: false }).click();
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'AI Assistant', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
});

test('disabled modules have no command-palette entries', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lanmind-feature-modules-v1', JSON.stringify({ ai: false, wiki: false, optical: false, vault: false, chat: false }));
  });
  await page.goto('/tests/theme/index.html?view=command-palette&locale=en-US');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'AI Assistant', exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  for (const name of ['Open AI', 'Open Wiki', 'Open Chat', 'Open Optical Transfer']) {
    await expect(palette.getByRole('button', { name, exact: false })).toHaveCount(0);
  }
  await expect(palette.getByRole('button', { name: 'Open Work', exact: false })).toBeVisible();
});
