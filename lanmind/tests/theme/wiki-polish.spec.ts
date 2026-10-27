import { expect, test, type Page } from '@playwright/test';
import { chooseWikiEditorMode, openWikiSource } from './wikiEditorHelpers';

test.setTimeout(90_000);
const editor = (page: Page) => page.getByRole('textbox', { name: 'Markdown body', exact: true });
const modal = (page: Page) => page.getByRole('dialog', { name: 'AI polish', exact: true });
const open = async (page: Page, text: string, theme = 'light', mode = '1') => {
  await page.goto(`/tests/theme/wiki.html?view=workspace-isolation&polish=${mode}&theme=${theme}&locale=en-US`, { waitUntil: 'domcontentloaded' });
  await openWikiSource(page);
  await editor(page).fill(text);
};
const generate = async (page: Page) => {
  const before = await page.evaluate(async () => { const path = '/tests/theme/wikiPolishFixture.ts'; return (await import(path)).polishFixture.requests.length; });
  await modal(page).getByRole('button', { name: /Start polishing|Regenerate/, exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const path = '/tests/theme/wikiPolishFixture.ts';
    return (await import(path)).polishFixture.requests.length;
  })).toBe(before + 1);
};
const emit = (page: Page, type: string, text = '', code?: string, index?: number) => page.evaluate(async args => {
  const path = '/tests/theme/wikiPolishFixture.ts';
  (await import(path)).emitPolish(args.type, args.text, args.code, args.index);
}, { type, text, code, index });
const request = (page: Page) => page.evaluate(async () => {
  const path = '/tests/theme/wikiPolishFixture.ts';
  return (await import(path)).polishFixture.requests.at(-1);
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: full article uses selected model and requirements, compares, applies, undoes and restores history`, async ({ page }, testInfo) => {
    const original = '# Guide\n\nUnpublished draft.\n\n```ts\nconst x = 1;\n```';
    const polished = original.replace('Unpublished draft.', 'A clear, unpublished draft.');
    await open(page, original, theme);
    await page.getByRole('button', { name: 'AI polish', exact: true }).click();
    await modal(page).getByRole('button', { name: 'Polish model', exact: true }).click();
    const popup = page.getByRole('listbox', { name: 'Polish model' });
    await expect(popup).toHaveCSS('transition', 'none');
    await popup.getByRole('option', { name: 'GPU model', exact: true }).click();
    await modal(page).getByLabel('Editing requirements (optional)').fill('Keep technical terms.');
    await generate(page);
    expect(await request(page)).toMatchObject({ content: original, instructions: 'Keep technical terms.', modelRef: { connectionId: 'gpu', modelEntryId: 'gpu-model' } });
    await emit(page, 'delta', 'A partial response');
    await expect(modal(page).getByRole('button', { name: 'Apply to draft' })).toBeDisabled();
    await expect(editor(page)).toHaveValue(original);
    await emit(page, 'done', polished);
    await expect(modal(page).getByRole('region', { name: 'AI result' })).toContainText('clear');
    expect(await modal(page).locator('ins').count()).toBeGreaterThan(0);
    await modal(page).getByRole('button', { name: 'Reading preview' }).click();
    await expect(modal(page).getByRole('region', { name: 'AI result' }).getByRole('heading', { name: 'Guide' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`wiki-polish-${theme}.png`) });
    await modal(page).getByRole('button', { name: 'Apply to draft' }).click();
    await expect(modal(page)).toHaveCount(0);
    await expect(editor(page)).toHaveValue(polished);
    await editor(page).press('Control+z');
    await expect(editor(page)).toHaveValue(original);
    await editor(page).press('Control+Shift+z');
    await expect(editor(page)).toHaveValue(polished);
    await editor(page).press('Control+s');
    const snapshots = await page.evaluate(async () => {
      const historyPath = '/src/components/wiki/wikiHistoryStore.ts';
      const storePath = '/src/components/wiki/wikiStore.ts';
      const { getWikiStorageKey } = await import(storePath);
      const data = JSON.parse(localStorage.getItem(getWikiStorageKey('A'))!);
      return (await import(historyPath)).loadWikiRevisions(data.selectedId, 'A');
    });
    expect(snapshots.some((snapshot: any) => snapshot.content === original)).toBe(true);
    await page.reload(); await openWikiSource(page);
    await expect(editor(page)).toHaveValue(polished);
    await page.locator('button[title*="history"]').first().click();
    const history = page.getByRole('dialog', { name: 'Page History', exact: true });
    await history.getByRole('row').filter({ hasText: 'Draft before AI polish' }).getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm Restore', exact: true }).click();
    await expect(editor(page)).toHaveValue(original);
  });
}

test('live local polishing merges a selection across paragraphs without changing surrounding content', async ({ page }) => {
  await open(page, 'Before.\n\nFirst target.\n\nSecond target.\n\nAfter.');
  await chooseWikiEditorMode(page, 'live');
  await page.locator('.vditor-ir [contenteditable="true"]').evaluate(element => {
    const paragraphs = Array.from(element.querySelectorAll('p'));
    const first = paragraphs.find(p => p.textContent.includes('First target.'))!;
    const last = paragraphs.find(p => p.textContent.includes('Second target.'))!;
    const range = document.createRange(); range.setStart(first, 0); range.setEnd(last, last.childNodes.length);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  });
  await page.getByRole('button', { name: 'AI polish', exact: true }).click(); await generate(page);
  expect((await request(page)).content).toContain('First target.\n\nSecond target.');
  await emit(page, 'done', 'Combined paragraph.');
  await modal(page).getByRole('button', { name: 'Apply to draft' }).click();
  await openWikiSource(page);
  expect((await editor(page).inputValue()).trim()).toBe('Before.\n\nCombined paragraph.\n\nAfter.');
});

test('live local polishing preserves whitespace between the replacement and untouched words', async ({ page }) => {
  await open(page, 'Keep old ending.'); await chooseWikiEditorMode(page, 'live');
  await page.locator('.vditor-ir [contenteditable="true"]').evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text: Node | null = null;
    while (walker.nextNode()) { if (walker.currentNode.textContent.includes('old ')) { text = walker.currentNode; break; } }
    if (!text) throw new Error('Selected text was not rendered');
    const start = text.textContent!.indexOf('old ');
    const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + 4);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  });
  await page.getByRole('button', { name: 'AI polish', exact: true }).click(); await generate(page);
  await emit(page, 'done', 'better');
  await modal(page).getByRole('button', { name: 'Apply to draft' }).click();
  await openWikiSource(page);
  expect((await editor(page).inputValue()).trim()).toBe('Keep better ending.');
});

test('editing requirements invalidate the previous result and the model popup owns its Escape', async ({ page }) => {
  await open(page, 'Original');
  await page.getByRole('button', { name: 'AI polish', exact: true }).click();
  await modal(page).getByRole('button', { name: 'Polish model', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
  await generate(page); await emit(page, 'done', 'Improved');
  await modal(page).getByLabel('Editing requirements (optional)').fill('Shorter.');
  await expect(modal(page).getByRole('button', { name: 'Apply to draft' })).toBeDisabled();
  await generate(page);
  expect(await request(page)).toMatchObject({ content: 'Original', instructions: 'Shorter.' });
});

test('narrow windows keep comparisons and primary actions within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'Original');
  await page.getByRole('button', { name: 'AI polish', exact: true }).click(); await generate(page); await emit(page, 'done', 'Improved');
  await expect(modal(page).getByRole('button', { name: 'Apply to draft' })).toBeInViewport();
  expect(await modal(page).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test('selected text replaces the second identical sentence and sends only selection and title', async ({ page }) => {
  const text = 'Same sentence.\n\nSame sentence.\n\nUntouched ending.';
  await open(page, text);
  await page.getByRole('textbox', { name: 'Page title', exact: true }).fill('Context title');
  await editor(page).evaluate((element: HTMLTextAreaElement) => { const start = element.value.lastIndexOf('Same sentence.'); element.focus(); element.setSelectionRange(start, start + 14); });
  await page.getByRole('button', { name: 'AI polish', exact: true }).click();
  await expect(modal(page).getByRole('button', { name: 'Selected text', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await generate(page);
  expect(await request(page)).toMatchObject({ mode: 'selection', content: 'Same sentence.', title: 'Context title' });
  await emit(page, 'done', 'Better sentence.');
  await modal(page).getByRole('button', { name: 'Apply to draft' }).click();
  await expect(editor(page)).toHaveValue('Same sentence.\n\nBetter sentence.\n\nUntouched ending.');
  await editor(page).press('Control+z');
  await expect(editor(page)).toHaveValue(text);
});

test('live editor retains a native selection through the modal and one undo restores it', async ({ page }) => {
  await open(page, 'First paragraph.\n\nSecond paragraph.\n\nLast paragraph.');
  await chooseWikiEditorMode(page, 'live');
  await page.locator('.vditor-ir [contenteditable="true"]').evaluate(element => {
    const paragraph = Array.from(element.querySelectorAll('p')).find(p => p.textContent.includes('Second paragraph.'))!;
    const range = document.createRange(); range.selectNodeContents(paragraph);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  });
  await page.getByRole('button', { name: 'AI polish', exact: true }).click();
  await generate(page);
  expect((await request(page)).mode).toBe('selection');
  await emit(page, 'done', 'Improved paragraph.');
  await modal(page).getByRole('button', { name: 'Apply to draft' }).click();
  await expect(page.locator('.vditor-ir')).toContainText('Improved paragraph.');
  await expect(page.locator('.vditor-ir')).toContainText('First paragraph.');
  await page.locator('.vditor-ir [contenteditable="true"]').press('Control+z');
  await expect(page.locator('.vditor-ir')).toContainText('Second paragraph.');
});

test('stop ignores late output, retry keeps the original, and truncated output cannot be applied', async ({ page }) => {
  await open(page, 'Original article');
  await page.getByRole('button', { name: 'AI polish', exact: true }).click(); await generate(page);
  await emit(page, 'delta', 'Partial text');
  await modal(page).getByRole('button', { name: 'Stop', exact: true }).click();
  await emit(page, 'done', 'Late response', undefined, 0);
  await expect(modal(page).getByRole('button', { name: 'Apply to draft' })).toBeDisabled();
  await expect(modal(page).getByRole('region', { name: 'AI result' })).toContainText('Partial text');
  await generate(page);
  await expect.poll(async () => (await request(page)).content).toBe('Original article');
  await emit(page, 'delta', 'Incomplete'); await emit(page, 'error', '', 'INCOMPLETE_RESULT');
  await expect(modal(page).getByRole('alert')).toContainText('cut off');
  await expect(modal(page).getByRole('button', { name: 'Apply to draft' })).toBeDisabled();
  await expect(editor(page)).toHaveValue('Original article');
});

test('concurrent content changes prevent applying an old result', async ({ page }) => {
  await open(page, 'Original');
  await page.getByRole('button', { name: 'AI polish', exact: true }).click(); await generate(page); await emit(page, 'done', 'Polished');
  await editor(page).evaluate((element: HTMLTextAreaElement) => { element.value = 'Newer draft'; element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); });
  await modal(page).getByRole('button', { name: 'Apply to draft' }).click();
  await expect(modal(page).getByRole('alert')).toContainText('changed');
  await expect(editor(page)).toHaveValue('Newer draft');
});

test('empty catalogs and unchanged output cannot apply, and close cancels pending requests', async ({ page }) => {
  await open(page, 'Original', 'light', 'empty');
  await page.getByRole('button', { name: 'AI polish', exact: true }).click();
  await expect(modal(page).getByRole('button', { name: 'Start polishing' })).toBeDisabled();
  await expect(modal(page)).toContainText('No enabled models');
  await modal(page).getByRole('button', { name: 'Close AI polish' }).click();
  await open(page, 'Original');
  await page.getByRole('button', { name: 'AI polish', exact: true }).click(); await generate(page); await emit(page, 'done', 'Original');
  await expect(modal(page)).toContainText('No changes needed');
  await expect(modal(page).getByRole('button', { name: 'Apply to draft' })).toBeDisabled();
  await generate(page);
  await modal(page).getByRole('button', { name: 'Close AI polish' }).click();
  await expect.poll(() => page.evaluate(async () => { const path = '/tests/theme/wikiPolishFixture.ts'; return (await import(path)).polishFixture.cancellations.length; })).toBeGreaterThan(0);
});

test('fallback textarea supports local polishing and undo when editor assets fail', async ({ page }) => {
  await page.route('**/vendor/vditor/dist/js/icons/ant.js', route => route.abort());
  await open(page, 'Same sentence. Same sentence.');
  await expect(page.locator('.wiki-markdown-editor textarea')).toBeVisible();
  await editor(page).evaluate((element: HTMLTextAreaElement) => { element.focus(); element.setSelectionRange(15, 29); });
  await page.getByRole('button', { name: 'AI polish', exact: true }).click(); await generate(page);
  await emit(page, 'done', 'Better sentence.');
  await modal(page).getByRole('button', { name: 'Apply to draft' }).click();
  await expect(editor(page)).toHaveValue('Same sentence. Better sentence.');
  await editor(page).press('Control+z');
  await expect(editor(page)).toHaveValue('Same sentence. Same sentence.');
});

test('workspace switches cancel requests and old output never reaches the new workspace', async ({ page }) => {
  await open(page, 'Workspace A article');
  await page.getByRole('button', { name: 'AI polish', exact: true }).click(); await generate(page);
  await page.getByRole('button', { name: 'Workspace B', exact: true }).evaluate((element: HTMLButtonElement) => element.click());
  await expect(modal(page)).toHaveCount(0);
  await emit(page, 'done', 'Late workspace A result', undefined, 0);
  await openWikiSource(page);
  await expect(editor(page)).not.toHaveValue('Late workspace A result');
  await expect.poll(() => page.evaluate(async () => { const path = '/tests/theme/wikiPolishFixture.ts'; return (await import(path)).polishFixture.cancellations.length; })).toBe(1);
});

for (const scenario of [
  { name: 'inline formatting', markdown: 'Before **second phrase** after.', selector: 'strong', text: 'second', replacement: 'clearer', expected: 'Before **clearer phrase** after.' },
  { name: 'list items', markdown: '- First item\n- Second item\n- Last item', selector: 'li', text: 'Second item', replacement: 'Clearer item', expected: '- First item\n- Clearer item\n- Last item' },
  { name: 'table cells', markdown: '| First | Second |\n| --- | --- |\n| Keep | Change |', selector: 'td', text: 'Change', replacement: 'Better', expected: '| First | Second |\n| --- | --- |\n| Keep | Better |' },
]) {
  test(`live local polishing preserves surrounding ${scenario.name}`, async ({ page }) => {
    await open(page, scenario.markdown); await chooseWikiEditorMode(page, 'live');
    await page.locator('.vditor-ir [contenteditable="true"]').evaluate((element, args) => {
      const container = Array.from(element.querySelectorAll(args.selector)).find(node => node.textContent.includes(args.text))!;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const start = walker.currentNode.textContent.indexOf(args.text);
        if (start < 0) continue;
        const range = document.createRange(); range.setStart(walker.currentNode, start); range.setEnd(walker.currentNode, start + args.text.length);
        window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range); break;
      }
    }, scenario);
    await page.getByRole('button', { name: 'AI polish', exact: true }).click(); await generate(page);
    expect((await request(page)).content).toBe(scenario.text);
    await emit(page, 'done', scenario.replacement);
    await modal(page).getByRole('button', { name: 'Apply to draft' }).click();
    await openWikiSource(page);
    const actual = await editor(page).inputValue();
    if (scenario.name === 'table cells') { expect(actual).toContain('Keep'); expect(actual).toContain('Better'); expect(actual).not.toContain('Change'); }
    else expect(actual.trim()).toBe(scenario.expected);
  });
}
