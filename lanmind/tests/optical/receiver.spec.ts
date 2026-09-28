import { expect, test } from '@playwright/test';

test('independent receiver build serves its offline shell and service worker', async ({ page, request }) => {
  await page.goto('/receiver/');
  await expect(page).toHaveTitle(/LanMind/);
  await expect(page.locator('#root')).toBeVisible();
  const manifest = await request.get('/receiver/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  const serviceWorker = await request.get('/receiver/sw.js');
  expect(serviceWorker.ok()).toBeTruthy();
  expect(await serviceWorker.text()).toContain('const PRECACHE = [');
});
