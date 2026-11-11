import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'America/Los_Angeles' });

for (const [due, expected] of [
  ['2026-09-14', '2026-09-15'],
  ['2026-03-08T09:30', '2026-03-09T09:30'],
  ['2026-12-31T23:45', '2027-01-01T23:45'],
]) {
  test(`postpones ${due} by one local calendar day and keeps its time`, async ({ page }) => {
    await page.goto(`/tests/theme/index.html?view=calendar-popover&due=${encodeURIComponent(due)}`);
    await page.getByRole('button', { name: '+1d', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__calendarPostpone?.updates.dueDate)).toBe(expected);
  });
}

test('date picker opens at its trigger, closes, and repositions after moving the trigger', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=controls');
  const trigger = page.locator('.theme-date-picker-trigger');
  const popup = page.locator('.theme-date-picker-menu');
  await trigger.click();
  await expect(popup).toBeVisible();
  const initial = await popup.boundingBox();
  expect(initial!.x).toBeGreaterThan(0);
  expect(initial!.y).toBeGreaterThan(0);
  await expect(popup).toHaveCSS('transition-duration', '0s');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
  await trigger.evaluate(node => { node.style.transform = 'translateX(75px)'; });
  await trigger.click();
  await expect(popup).toBeVisible();
  const moved = await popup.boundingBox();
  expect(moved!.x - initial!.x).toBeCloseTo(75, 0);
  await popup.getByRole('button', { name: '清除', exact: true }).click();
  await expect(popup).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
