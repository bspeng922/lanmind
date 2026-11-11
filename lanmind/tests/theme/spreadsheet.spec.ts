import { expect, test } from '@playwright/test';

test('spreadsheet worker keeps wide sheets bounded and handles sheet changes', async ({ page }) => {
  const errors: string[] = [];
  const workers: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  await page.goto('/tests/theme/index.html?view=excel-large');
  const grid = page.locator('[data-spreadsheet-grid]');
  await expect(grid.getByRole('cell', { name: 'Wide-1', exact: true })).toBeVisible();
  expect(workers.some(url => url.includes('spreadsheet.worker'))).toBe(true);
  expect(await grid.getByRole('columnheader').count()).toBeLessThan(25);
  await grid.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(grid.getByRole('columnheader', { name: 'AMJ', exact: true })).toBeVisible();
  await expect(grid.getByRole('cell', { name: 'Wide-1024', exact: true })).toBeVisible();
  await grid.getByRole('cell', { name: 'Wide-1024', exact: true }).click();
  await expect(page.getByText('AMJ1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Tall', exact: true }).click();
  await expect(grid.getByRole('cell', { name: 'Tall-1', exact: true })).toBeVisible();
  await expect(grid.locator('tbody tr')).toHaveCount(1000);
  await grid.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(grid.getByRole('cell', { name: 'Tall-1000', exact: true })).toBeVisible();
  await expect(grid.getByRole('cell', { name: 'Tall-1001', exact: true })).toHaveCount(0);

  // Hold real worker requests to reproduce switching back before the first reply.
  await page.evaluate(() => {
    const original = Worker.prototype.postMessage as any;
    const pending: { worker: Worker; args: any[] }[] = [];
    (window as any).__sheetRequests = pending;
    (Worker.prototype as any).postMessage = function (...args: any[]) {
      pending.push({ worker: this, args });
    };
    (window as any).__releaseSheets = () => Promise.all(pending.splice(0).map(({ worker, args }) => new Promise<void>(resolve => {
      const received = (event: MessageEvent) => {
        if (event.data.id !== args[0].id) return;
        worker.removeEventListener('message', received);
        resolve();
      };
      worker.addEventListener('message', received);
      original.apply(worker, args);
    })));
  });
  await page.getByRole('button', { name: 'Wide', exact: true }).click();
  await page.getByRole('button', { name: 'Tall', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__sheetRequests.length)).toBe(2);
  await page.evaluate(() => (window as any).__releaseSheets());
  await expect(grid.locator('tbody tr')).toHaveCount(1000);
  await expect(grid.getByRole('cell', { name: 'Wide-1', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
