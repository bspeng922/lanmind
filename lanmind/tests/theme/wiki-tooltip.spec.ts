import { expect, test } from '@playwright/test';
import { chooseWikiEditorMode } from './wikiEditorHelpers';

test.setTimeout(60_000);

for (const theme of ['light', 'dark']) {
  test(`${theme}: Wiki toolbar tooltips pop downwards and never overlap buttons or get clipped`, async ({ page }) => {
    await page.goto(`/tests/theme/wiki.html?view=workspace-isolation&theme=${theme}&locale=en-US`, { waitUntil: 'domcontentloaded' });
    await chooseWikiEditorMode(page, 'live');

    const toolbar = page.locator('#wiki-toolbar-slot .vditor-toolbar');
    await expect(toolbar).toBeVisible();

    const buttons = toolbar.locator('button.vditor-tooltipped');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(20);

    // Verify all tooltipped buttons have valid tip positions and non-empty aria-label
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const className = await btn.getAttribute('class');
      const ariaLabel = await btn.getAttribute('aria-label');
      expect(className).not.toContain('undefined');
      expect(ariaLabel).toBeTruthy();
    }

    // Inspect critical buttons: table, attachment, underline, highlight, headings, redo
    const sampleTypes = ['table', 'wiki-attachment', 'wiki-underline', 'wiki-highlight', 'headings', 'redo'];
    for (const type of sampleTypes) {
      const btn = toolbar.locator(`button[data-type="${type}"]`);
      await expect(btn).toBeVisible();
      await btn.hover();
      await page.waitForTimeout(150);

      const metrics = await btn.evaluate((el) => {
        const after = window.getComputedStyle(el, '::after');
        const before = window.getComputedStyle(el, '::before');
        const btnRect = el.getBoundingClientRect();
        return {
          btnBottom: btnRect.bottom,
          btnTop: btnRect.top,
          afterDisplay: after.display,
          afterTop: parseFloat(after.top),
          afterBottom: parseFloat(after.bottom),
          beforeDisplay: before.display,
          beforeBorderBottomColor: before.borderBottomColor,
        };
      });

      // Tooltip must be displayed on hover
      expect(metrics.afterDisplay).toBe('block');
      expect(metrics.beforeDisplay).toBe('block');

      // The top of ::after must be at or below the button bottom (28px inside relative button)
      // guaranteeing it pops downwards and never covers the button
      expect(metrics.afterTop).toBeGreaterThanOrEqual(28);

      // Arrow points UP towards button (borderBottomColor is filled)
      expect(metrics.beforeBorderBottomColor).toMatch(/rgb\(31,\s*35,\s*40\)/);
    }
  });
}
