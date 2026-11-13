import { expect, test, type Locator } from '@playwright/test';

const compositionEvents = [
  { name: 'native composition', isComposing: true, keyCode: 13 },
  { name: 'WebKit confirming key', isComposing: false, keyCode: 229 },
];

async function confirmComposition(field: Locator, event: typeof compositionEvents[number]) {
  await field.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: event.isComposing, keyCode: event.keyCode });
}

for (const event of compositionEvents) {
  test(`${event.name}: confirming a chat candidate preserves the draft until a separate Enter`, async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=chat&screenshot=success&locale=en-US');
    await page.evaluate(() => { (window as any).isTauri = true; });
    const composer = page.locator('textarea').last();
    await composer.fill('A composed message');
    await confirmComposition(composer, event);
    await expect(composer).toHaveValue('A composed message');
    expect(await page.evaluate(() => (window as any).__screenshotFixture.sends)).toBe(0);
    await composer.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as any).__screenshotFixture.sends)).toBe(1);
    await expect(composer).toHaveValue('');
  });

  test(`${event.name}: command search does not activate a command while composing`, async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=command-palette&locale=en-US');
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    const search = palette.getByRole('textbox', { name: 'Search commands', exact: true });
    await search.fill('Open AI');
    await confirmComposition(search, event);
    await expect(palette).toBeVisible();
    await expect(search).toHaveValue('Open AI');
    await search.press('Enter');
    await expect(palette).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
  });

  test(`${event.name}: a task tag candidate is not committed early`, async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=task&locale=en-US&create');
    await page.getByRole('button', { name: 'Create tag', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'New tag name', exact: true });
    await input.fill('Composed tag');
    await confirmComposition(input, event);
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Composed tag');
    await expect(page.getByRole('button', { name: 'Remove tag: Composed tag', exact: true })).toHaveCount(0);
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove tag: Composed tag', exact: true })).toBeVisible();
  });

  test(`${event.name}: confirming a title keeps focus in the title field`, async ({ page }) => {
    await page.goto('/tests/theme/index.html?view=task&locale=en-US&create');
    const title = page.getByRole('textbox', { name: 'Task title', exact: true });
    await title.fill('Composed title');
    await confirmComposition(title, event);
    await expect(title).toBeFocused();
    await title.press('Enter');
    await expect(page.locator('.task-description-input')).toBeFocused();
  });
}

for (const fallback of [false, true]) {
  test(`task title grows and shrinks with ${fallback ? 'legacy sizing' : 'native field sizing'}`, async ({ page }) => {
    if (fallback) {
      await page.addInitScript(() => {
        const supports = CSS.supports.bind(CSS);
        CSS.supports = ((property: string, value?: string) => property === 'field-sizing' ? false :
          value === undefined ? supports(property) : supports(property, value)) as typeof CSS.supports;
      });
    }
    await page.goto('/tests/theme/index.html?view=task&locale=en-US&create');
    const title = page.getByRole('textbox', { name: 'Task title', exact: true });
    await title.fill('A long title that wraps across several lines. '.repeat(12));
    await expect.poll(() => title.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(70);
    expect(await title.evaluate(node => node.getBoundingClientRect().height)).toBeLessThanOrEqual(145);
    expect(await title.evaluate(node => Boolean((node as HTMLElement).style.height))).toBe(fallback);
    await title.fill('Short title');
    await expect.poll(() => title.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(60);
  });
}

test('a command button keeps native Enter activation after keyboard focus moves to it', async ({ page }) => {
  await page.goto('/tests/theme/index.html?view=command-palette&locale=en-US');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('button', { name: 'Open AI', exact: false }).press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
});

test('outline navigation immediately follows changes to the system motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    (window as any).__outlineScrolls = [];
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function(options?: boolean | ScrollIntoViewOptions) {
      if (typeof options === 'object') (window as any).__outlineScrolls.push(options.behavior);
      return scroll.call(this, options);
    };
  });
  await page.goto('/tests/theme/index.html?view=markdown');
  const heading = page.locator('aside').getByRole('button', { name: '实施步骤', exact: true });
  await heading.click();
  expect(await page.evaluate(() => (window as any).__outlineScrolls.at(-1))).toBe('smooth');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await heading.click();
  expect(await page.evaluate(() => (window as any).__outlineScrolls.at(-1))).toBe('auto');
});

test('form fields remain visibly focused in forced colors mode', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/tests/theme/index.html?view=controls&theme=light');
  await page.keyboard.press('Tab');
  const input = page.getByRole('textbox', { name: '测试输入框', exact: true });
  await input.focus();
  const appearance = await input.evaluate(node => {
    const style = getComputedStyle(node);
    return { outline: style.outlineStyle, width: style.outlineWidth, scrollbar: style.scrollbarColor };
  });
  expect(appearance).toEqual({ outline: 'solid', width: '2px', scrollbar: 'auto' });
});

test('expanded diagrams use native dialog focus, form dismissal and disposal', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', { value: undefined, configurable: true });
  });
  await page.goto('/tests/theme/rich.html');
  await page.waitForFunction(() => typeof (window as any).setRichContent === 'function');
  await page.evaluate(() => (window as any).setRichContent('```mermaid\nflowchart TD\nA --> B\n```'));
  const figure = page.getByTestId('ai').locator('[data-rich-state="ready"]');
  await expect(figure).toBeVisible();
  const expand = figure.getByRole('button').nth(2);
  await expand.click();
  const dialog = page.getByRole('dialog', { name: /mermaid/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button')).toBeFocused();
  expect(await dialog.evaluate(node => node.matches(':modal'))).toBe(true);
  await dialog.getByRole('button').click();
  await expect(dialog).toHaveCount(0);
  await expect(expand).toBeFocused();
  await expand.click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as any).setRichContent('The diagram was removed.'));
  await expect(dialog).toHaveCount(0);
});
