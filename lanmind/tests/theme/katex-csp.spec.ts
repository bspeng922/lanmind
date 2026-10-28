import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Tauri appends 'nonce-…' to style-src for every bundled page that has a <style> tag. Once a nonce is present,
// browsers ignore 'unsafe-inline' for style-src, so KaTeX's inline style="" offsets are blocked unless
// style-src-attr allows them explicitly. Blocked offsets stack fraction rows on top of each other.
test('release CSP keeps KaTeX inline style attributes working when Tauri adds a style nonce', async ({ page }) => {
  const config = JSON.parse(await readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const csp: string = config.app.security.csp;
  const directive = (name: string) => csp.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `)) || '';
  expect(directive('style-src-attr')).toContain("'unsafe-inline'");

  await page.goto('/tests/theme/rich.html?theme=light');
  await page.waitForFunction(() => typeof (window as any).setRichContent === 'function');
  const violations: string[] = [];
  await page.exposeFunction('recordViolation', (name: string) => violations.push(name));
  await page.evaluate(policy => {
    document.addEventListener('securitypolicyviolation', event => (window as any).recordViolation(event.violatedDirective));
    const meta = document.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy';
    meta.content = policy; document.head.append(meta);
  }, [directive('style-src').replace(/'unsafe-inline'/, "'unsafe-inline' 'nonce-test'"), directive('style-src-attr')].join('; '));
  await page.evaluate(value => (window as any).setRichContent(value), '\\[\n\\left(\\frac{700}{450}\\right)^4 \\approx 5.8\n\\]\n');
  const article = page.getByTestId('wiki').locator('article');
  await expect(article.locator('.katex').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const separated = await article.evaluate(el => {
    const rows = el.querySelector('.mfrac')!.querySelectorAll(':scope > .vlist-t > .vlist-r:first-child > .vlist > span');
    const denominator = rows[0]?.lastElementChild?.getBoundingClientRect();
    const numerator = rows[2]?.lastElementChild?.getBoundingClientRect();
    return Boolean(numerator && denominator && numerator.bottom < denominator.top);
  });
  expect(violations).toEqual([]);
  expect(separated).toBe(true);
});
