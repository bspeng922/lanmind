import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chooseWikiEditorMode, openWikiSource } from './wikiEditorHelpers';

const JSZip = createRequire(import.meta.url)('jszip') as typeof import('jszip');

const body = (page: Page) => page.getByRole('textbox', { name: 'Markdown body', exact: true });
const live = (page: Page) => ({ click: () => chooseWikiEditorMode(page, 'live') });
test.setTimeout(90_000);
const doc = (page: Page) => page.evaluate(async () => {
  const path = '/src/components/wiki/wikiStore.ts';
  const { getWikiStorageKey } = await import(path);
  const state = JSON.parse(localStorage.getItem(getWikiStorageKey('A'))!);
  return state.documents.find((document: any) => document.id === state.selectedId);
});

for (const theme of ['light', 'dark']) {
  test(`${theme}: live Markdown renders inline and switching modes does not publish or normalize the document`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/tests/theme/wiki.html?view=workspace-isolation&theme=${theme}&locale=en-US`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.wiki-markdown-editor')).toHaveAttribute('data-editor-mode', 'live');
    await openWikiSource(page);
    const markdown = '## 规划\n\n**重点**与==高亮==\n\n- [ ] 待办\n\n<u>下划线</u>\n';
    await body(page).fill(markdown);
    await body(page).press('Control+s');
    expect((await doc(page)).content).toBe(markdown);
    await live(page).click();
    await expect(page.locator('.vditor-ir h2')).toContainText('规划');
    await expect(page.locator('.vditor-ir strong')).toContainText('重点');
    await expect(page.locator('.vditor-ir mark')).toContainText('高亮');
    await openWikiSource(page);
    await expect(body(page)).toHaveValue(markdown);
    await live(page).click();
    await openWikiSource(page);
    await expect(body(page)).toHaveValue(markdown);
    await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
    expect((await doc(page)).content).toBe(markdown);
    expect(errors).toEqual([]);
  });

  test(`${theme}: inline typing, task toggles, undo and read-only locking use the live document`, async ({ page }) => {
    await page.goto(`/tests/theme/wiki.html?view=workspace-isolation&theme=${theme}&locale=en-US`, { waitUntil: 'domcontentloaded' });
    await openWikiSource(page);
    await body(page).fill('## 标题\n\n- [ ] task\n\n正文\n');
    await live(page).click();
    const checkbox = page.locator('.vditor-ir input[type=checkbox]');
    await checkbox.check();
    await body(page).press('Control+s');
    expect((await doc(page)).content).toMatch(/\[[xX]\]\s+task/);
    const paragraph = page.locator('.vditor-ir p').last();
    await paragraph.click();
    await body(page).press('Control+End');
    await body(page).pressSequentially(' appended');
    await expect(body(page)).toContainText('appended');
    await openWikiSource(page);
    await expect(body(page)).toHaveValue(/appended/);
    await live(page).click();
    await body(page).press('Control+z');
    await expect(body(page)).not.toContainText('appended');
    await openWikiSource(page);
    await expect(body(page)).not.toHaveValue(/appended/);
    await live(page).click();
    await body(page).press('Control+Shift+z');
    await expect(body(page)).toContainText('appended');
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Enable read-only lock', exact: true }).click();
    await expect(body(page)).toHaveAttribute('contenteditable', 'false');
    const before = (await doc(page)).content;
    await checkbox.click({ force: true });
    expect((await doc(page)).content).toBe(before);
    await expect(checkbox).toBeChecked();
  });
}

test('source undo and redo survive round trips through inline editing', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?locale=en-US&theme=light');
  await openWikiSource(page);
  const baseline = 'Source baseline\n';
  const edited = baseline + ' source edit';
  await body(page).fill(baseline);
  await body(page).press('Control+s');
  await live(page).click();
  await openWikiSource(page);
  await body(page).press('Control+End');
  await body(page).pressSequentially(' source edit');
  await expect(body(page)).toHaveValue(edited);
  await live(page).click();
  await openWikiSource(page);
  await body(page).press('Control+z');
  await expect(body(page)).toHaveValue(baseline);
  await live(page).click();
  await openWikiSource(page);
  await body(page).press('Control+Shift+z');
  await expect(body(page)).toHaveValue(edited);
  await body(page).press('Control+s');
  expect((await doc(page)).content).toBe(edited);
});

test('pasted images and dropped attachments are inserted once and persist with asset paths', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?view=workspace-isolation&theme=light&locale=en-US', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.wiki-markdown-editor')).toHaveAttribute('data-editor-ready', 'true', { timeout: 20000 });
  await body(page).focus();
  await body(page).evaluate(element => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))], 'paste.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.vditor-ir img')).toHaveCount(1);
  await expect(page.locator('.vditor-ir img')).toHaveAttribute('src', /^blob:/);
  await body(page).evaluate(element => {
    const data = new DataTransfer();
    data.items.add(new File(['one'], 'one.txt', { type: 'text/plain' }));
    data.items.add(new File(['two'], 'two.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.vditor-ir')).toContainText('two.txt');
  await body(page).press('Control+s');
  const markdown = (await doc(page)).content;
  expect(markdown.match(/!\[paste.png\]/g)).toHaveLength(1);
  expect(markdown).toContain('assets/');
  expect(markdown).not.toContain('blob:');
  expect(markdown).not.toContain('data:image');
  const wordDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export as Word (.docx)', exact: true }).click();
  const exported = await wordDownload;
  const word = await JSZip.loadAsync(await readFile((await exported.path())!));
  expect(Object.keys(word.files).filter(path => /^word\/media\/.+\.png$/.test(path))).toHaveLength(1);
  expect(await word.file('word/document.xml')!.async('string')).not.toContain('blob:');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.vditor-ir img')).toHaveAttribute('src', /^blob:/);
});

test('editor resources are local and the Markdown source remains usable after an initialization failure', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (/https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:1421')) external.push(request.url()); });
  await page.route('**/vendor/vditor/dist/js/lute/**', route => route.abort());
  await page.goto('/tests/theme/wiki.html?view=workspace-isolation&theme=light&locale=en-US', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('The editor could not load.', { exact: false })).toBeVisible({ timeout: 20000 });
  await body(page).fill('recoverable fallback');
  await body(page).press('End');
  await body(page).pressSequentially(' appended');
  await body(page).press('Control+z');
  await expect(body(page)).not.toHaveValue('recoverable fallback appended');
  await body(page).press('Control+Shift+z');
  await expect(body(page)).toHaveValue('recoverable fallback appended');
  await body(page).press('Control+s');
  expect((await doc(page)).content).toBe('recoverable fallback appended');
  expect(external).toEqual([]);
});

test('Chinese composition commits once and preserves the last character on immediate save', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?view=workspace-isolation&theme=light&locale=en-US', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.wiki-markdown-editor')).toHaveAttribute('data-editor-ready', 'true', { timeout: 20000 });
  await body(page).focus();
  await body(page).dispatchEvent('compositionstart', { data: '' });
  await page.keyboard.insertText('中文输入');
  // Blur/save must not serialize the intermediate composition DOM.
  await body(page).press('Control+s');
  expect((await doc(page)).content).not.toContain('中文输入');
  await body(page).dispatchEvent('compositionend', { data: '中文输入' });
  await body(page).press('Control+s');
  expect((await doc(page)).content).toContain('中文输入');
  await openWikiSource(page);
  expect(await body(page).inputValue()).toContain('中文输入');
});

test('live lists, formatting, tables and code survive a source round trip', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?view=workspace-isolation&theme=light&locale=en-US', { waitUntil: 'domcontentloaded' });
  await openWikiSource(page);
  await body(page).fill('- first\n');
  await live(page).click();
  await page.locator('.vditor-ir li').click();
  await body(page).press('End');
  await body(page).press('Enter');
  await page.keyboard.insertText('second');
  await expect(page.locator('.vditor-ir li')).toHaveCount(2);
  await body(page).press('Control+s');
  expect((await doc(page)).content).toContain('second');
  await openWikiSource(page);
  const markdown = '| A | B |\n| --- | --- |\n| one | two |\n\n```typescript\nconst value = 1;\n```\n\n重点';
  await body(page).fill(markdown);
  await live(page).click();
  await expect(page.locator('.vditor-ir table td')).toHaveCount(2);
  await expect(page.locator('.vditor-ir code')).toContainText('const value = 1;');
  await page.locator('.vditor-ir p').last().evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await page.locator('[data-type="wiki-highlight"]').click();
  await expect(page.locator('.vditor-ir mark')).toContainText('重点');
  await expect(page.locator('[data-type="wiki-highlight"] svg')).toHaveCSS('stroke-width', '1.8px');
  await body(page).press('Control+s');
  const saved = (await doc(page)).content;
  expect(saved).toContain('==重点==');
  expect(saved).toContain('const value = 1;');
  await openWikiSource(page);
  await expect(body(page)).toHaveValue(saved);
});

test('inline editing respects the desktop script policy and keeps diagram fences offline', async ({ page }) => {
  const external: string[] = [];
  const violations: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:1421')) external.push(request.url()); });
  await page.goto('/tests/theme/wiki.html?view=workspace-isolation&theme=dark&locale=en-US', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.wiki-markdown-editor')).toHaveAttribute('data-editor-ready', 'true', { timeout: 20000 });
  // The dev HTML needs Vite's inline refresh preamble. Apply the desktop policy
  // afterwards, then mount a fresh editor in another workspace under that policy.
  await page.evaluate(() => {
    const meta = document.createElement('meta');
    meta.httpEquiv = 'Content-Security-Policy';
    meta.content = "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'";
    document.head.appendChild(meta);
  });
  page.on('console', message => { if (message.text().includes('Content Security Policy')) violations.push(message.text()); });
  await page.getByRole('button', { name: 'Workspace B', exact: true }).click();
  await openWikiSource(page);
  await body(page).fill('```plantuml\nAlice -> Bob: offline\n```\n\n```mermaid\ngraph TD; A-->B;\n```');
  await live(page).click();
  await expect(page.locator('.vditor-ir')).toContainText('Alice -> Bob: offline');
  await expect(page.locator('.vditor-ir')).toContainText('graph TD; A-->B;');
  await expect(page.locator('.vditor-ir object, .vditor-ir iframe')).toHaveCount(0);
  expect(external).toEqual([]);
  expect(violations).toEqual([]);
});

test('an attachment finishing after a workspace switch cannot enter either editor', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?view=workspace-isolation&theme=light&locale=en-US', { waitUntil: 'domcontentloaded' });
  await openWikiSource(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args: Parameters<typeof original>) {
      const request = original.apply(this, args);
      if (this.name === 'assets') Object.defineProperty(request, 'onsuccess', {
        set(listener: (event: Event) => void) {
          request.addEventListener('success', event => {
            (window as any).__finishWikiAsset = () => listener.call(request, event);
          });
        },
      });
      return request;
    };
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'old-workspace.txt', mimeType: 'text/plain', buffer: Buffer.from('old workspace') });
  await page.waitForFunction(() => typeof (window as any).__finishWikiAsset === 'function');
  await page.getByRole('button', { name: 'Workspace B', exact: true }).click();
  await openWikiSource(page);
  await page.evaluate(() => (window as any).__finishWikiAsset());
  await expect(body(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Workspace A', exact: true }).click();
  await openWikiSource(page);
  await expect(body(page)).toHaveValue('');
});

test('large live documents save exactly the Markdown produced by the native parser after typing and structural edits', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?view=workspace-isolation&theme=light&locale=en-US', { waitUntil: 'domcontentloaded' });
  await openWikiSource(page);
  const markdown = Array.from({ length: 100 }, (_, index) => `## Section ${index}\n\n${'A paragraph with **formatting** and 中文内容. '.repeat(12)}\n`).join('\n') +
    '\n- first\n- second\n\n| A | B |\n| --- | --- |\n| one | two |\n\n```typescript\nconst value = 1;\n```\n\nEnd of the document.\n';
  expect(markdown.length).toBeGreaterThan(45_000);
  await body(page).evaluate((element, value) => {
    (element as HTMLTextAreaElement).value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, markdown);
  await live(page).click();
  await body(page).press('Control+End');
  await page.keyboard.insertText(' edited');
  await body(page).press('Control+s');
  await page.keyboard.insertText(' text');
  await body(page).press('Control+s');
  const nativeMarkdown = () => page.locator('.vditor-ir > pre').evaluate(element => {
    const lute = Lute.New();
    lute.SetMark(true);
    lute.SetVditorIR(true);
    (lute as Lute & { SetSoftBreak2HardBreak(enabled: boolean): void }).SetSoftBreak2HardBreak(true);
    return lute.VditorIRDOM2Md(element.innerHTML).replace(/\u00a0/g, ' ');
  });
  expect((await doc(page)).content).toBe(await nativeMarkdown());
  await body(page).press('Enter');
  await page.keyboard.insertText('new paragraph');
  await body(page).press('Control+s');
  const expected = await nativeMarkdown();
  expect((await doc(page)).content).toBe(expected);
  expect(expected).toContain('edited text');
  expect(expected).toContain('new paragraph');
  await openWikiSource(page);
  await expect(body(page)).toHaveValue(expected);
});
