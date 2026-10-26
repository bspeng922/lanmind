import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { openWikiSource } from './wikiEditorHelpers';

const require = createRequire(import.meta.url);
const JSZip = require('jszip') as typeof import('jszip');
const mammoth = require('mammoth') as typeof import('mammoth');

test.setTimeout(90_000);

test('Word and PDF downloads contain real documents, Chinese text, tables and pictures', async ({ page }, testInfo) => {
  await page.goto('/tests/theme/wiki.html?locale=en-US&theme=dark');
  await openWikiSource(page);
  await page.getByRole('textbox', { name: 'Page title', exact: true }).fill('中文导出测试');
  const body = page.getByRole('textbox', { name: 'Markdown body', exact: true });
  await body.fill('## 格式验证\n\n**加粗文字**和中文内容\n\n| 名称 | 内容 |\n| --- | --- |\n| 表格 | 测试 |\n\n[测试链接](https://example.com)\n\n' + Array.from({ length: 36 }, (_, i) => `段落 ${i + 1}：用于验证长文档分页，不应裁断中文行。`).join('\n\n'));
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 100;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#2563eb'; ctx.fillRect(0, 0, 240, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await body.press('Control+Home');
  await page.locator('input[type=file]').setInputFiles({ name: '中文图片.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(body).toHaveValue(/assets\//);
  await page.evaluate(() => { window.print = () => { throw new Error('System print must not be used'); }; });
  for (const format of ['Word (.docx)', 'PDF']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: `Export as ${format}`, exact: true }).click();
    const download = await pending;
    const path = testInfo.outputPath(download.suggestedFilename()); await download.saveAs(path);
    const bytes = await readFile(path);
    if (format.startsWith('Word')) {
      expect(download.suggestedFilename()).toBe('中文导出测试.docx');
      const zip = await JSZip.loadAsync(bytes);
      expect(zip.file('[Content_Types].xml')).toBeTruthy();
      const xml = await zip.file('word/document.xml')!.async('string');
      expect(xml).toContain('<w:tbl>'); expect(xml).toContain('<w:b/>');
      expect(Object.keys(zip.files).some(name => name.startsWith('word/media/') && name.endsWith('.png'))).toBe(true);
      const parsed = await mammoth.extractRawText({ buffer: bytes });
      expect(parsed.value).toContain('中文导出测试'); expect(parsed.value).toContain('格式验证'); expect(parsed.value).toContain('段落 36');
    } else {
      expect(download.suggestedFilename()).toBe('中文导出测试.pdf');
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
      const pdf = await loading.promise;
      expect(pdf.numPages).toBeGreaterThanOrEqual(2);
      expect((await pdf.getMetadata()).info).toMatchObject({ Title: '中文导出测试' });
      for (let i = 1; i <= pdf.numPages; i++) {
        const pdfPage = await pdf.getPage(i);
        expect((await pdfPage.getOperatorList()).fnArray.length).toBeGreaterThan(0);
        const viewport = pdfPage.getViewport({ scale: 1 });
        const canvas = require('@napi-rs/canvas').createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
        await writeFile(testInfo.outputPath(`pdf-page-${i}.png`), canvas.toBuffer('image/png'));
      }
      await loading.destroy();
    }
  }
});

test('desktop export writes binary bytes and canceling a save does not create a file', async ({ page }) => {
  await page.goto('/tests/theme/wiki.html?locale=en-US');
  const result = await page.evaluate(async () => {
    const calls: { command: string; args: any }[] = [];
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string, args: any) => {
      calls.push({ command, args });
      if (command === 'plugin:dialog|save') return calls.filter(call => call.command === command).length === 1 ? 'C:\\exports\\note.docx' : null;
      return null;
    } };
    const path = '/src/components/wiki/wikiExport.ts';
    const { exportWikiWord, exportWikiPdf } = await import(path);
    const doc = { title: 'Desktop', content: '## 正文', updatedAt: '2026-10-26T00:00:00Z' } as any;
    const word = await exportWikiWord(doc); const pdf = await exportWikiPdf(doc);
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).isTauri;
    const write = calls.find(call => call.command === 'plugin:fs|write_file');
    return { word, pdf, commands: calls.map(call => call.command), writeBytes: write ? Array.from(new Uint8Array(write.args)) : [] };
  });
  expect(result.word).toBe(true); expect(result.pdf).toBe(false);
  expect(result.commands.filter(command => command === 'plugin:fs|write_file')).toHaveLength(1);
  expect(result.writeBytes.slice(0, 2)).toEqual([80, 75]);
});

test('an unavailable image reports an export error without creating an incomplete document', async ({ page }) => {
  await page.route('**/assets/missing.png', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/tests/theme/wiki.html?locale=en-US');
  await openWikiSource(page);
  await page.getByRole('textbox', { name: 'Markdown body', exact: true }).fill('![Missing image](assets/missing.png)');
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export as Word (.docx)', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Export failed');
  expect(downloads).toHaveLength(0);
});
