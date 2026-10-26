import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

test.setTimeout(90_000);

test('Wiki waits for attachment sync; a fresh anonymous browser can see images and download attachments', async ({ page, browser }) => {
  const assets = new Map<string, { body: Buffer; contentType: string }>();
  let releaseUpload!: () => void;
  const hold = new Promise<void>(resolve => { releaseUpload = resolve; });
  await page.route('**/api/wiki/assets/**', async route => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1)!);
    assets.set(key, { body: route.request().postDataBuffer()!, contentType: route.request().headers()['content-type'] });
    await hold;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/tests/theme/share.html');
  const content = await page.evaluate(async () => {
    const path = '/src/components/wiki/wikiAssetHelper.ts';
    const { wikiFilesMarkdown } = await import(path);
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 30;
    canvas.getContext('2d')!.fillRect(0, 0, 40, 30);
    const png = await (await fetch(canvas.toDataURL())).blob();
    return wikiFilesMarkdown([new File([png], '共享图片.png', { type: 'image/png' }), new File(['LAN attachment bytes'], '共享附件.txt', { type: 'text/plain' })]);
  });
  await page.getByLabel('Fixture content').fill(content);
  await page.getByRole('button', { name: 'Share Wiki', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Copy Link', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('LAN Web Link', { exact: true })).toHaveValue('');
  releaseUpload();
  await expect(dialog.getByRole('button', { name: 'Copy Link', exact: true })).toBeEnabled();
  const link = await dialog.getByLabel('LAN Web Link', { exact: true }).inputValue();
  expect(link).toContain('workspace=A&wiki=wiki-1');
  expect(assets.size).toBe(2);

  // Chromium download requests bypass page routing, so serve the shared assets over real HTTP.
  const host = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    if (url.pathname.startsWith('/assets/')) {
      const asset = assets.get(decodeURIComponent(url.pathname.split('/').at(-1)!));
      if (!asset) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': asset.contentType }); response.end(asset.body);
    } else {
      try {
        const upstream = await fetch('http://127.0.0.1:1421' + request.url);
        response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream' });
        response.end(Buffer.from(await upstream.arrayBuffer()));
      } catch { response.writeHead(502).end(); }
    }
  });
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  const address = host.address() as { port: number };
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:1421' });
  try {
    const reader = await context.newPage();
    await reader.addInitScript(() => localStorage.setItem('lanmind-locale-preference', 'en-US'));
    await reader.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/public/wiki')) {
        expect(url.searchParams.get('workspace')).toBe('A');
        const doc = { id: 'wiki-1', title: 'LAN guide', content, workspaceId: 'A', tags: [], updatedAt: '2026-10-26T00:00:00Z' };
        await route.fulfill({ json: url.pathname.endsWith('/wiki') ? { documents: [doc] } : doc });
      } else await route.fulfill({ status: 401, json: {} });
    });
    // Use the production network entry, with a new profile and no cookies or IndexedDB.
    await reader.goto(link.replace('http://127.0.0.1:1421/?', `http://127.0.0.1:${address.port}/network.html?`));
    await expect(reader.getByRole('heading', { name: 'LAN guide', exact: true })).toBeVisible();
    await expect.poll(() => reader.locator('article img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(40);
    const attachment = reader.getByRole('link', { name: '📎 共享附件.txt', exact: true });
    await expect(attachment).toHaveAttribute('download', '共享附件.txt');
    const pending = reader.waitForEvent('download', { timeout: 15_000 });
    await attachment.click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('共享附件.txt');
    expect((await readFile((await download.path())!)).toString()).toBe('LAN attachment bytes');
    await expect(reader.getByRole('textbox', { name: 'Access password', exact: true })).toHaveCount(0);
  } finally {
    await context.close();
    host.closeAllConnections();
    await new Promise<void>((resolve, reject) => host.close(error => error ? reject(error) : resolve()));
  }
});

test('failed Wiki sync is shown and can be retried by reopening sharing', async ({ page }) => {
  let failed = true;
  await page.route('**/api/wiki/assets/**', route => route.fulfill({ status: failed ? 500 : 200, json: {} }));
  await page.goto('/tests/theme/share.html');
  const content = await page.evaluate(async () => {
    const path = '/src/components/wiki/wikiAssetHelper.ts';
    return (await import(path)).wikiFilesMarkdown([new File(['retry'], 'retry.txt', { type: 'text/plain' })]);
  });
  await page.getByLabel('Fixture content').fill(content);
  await page.getByRole('button', { name: 'Share Wiki', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not prepare');
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Copy Link', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  failed = false;
  await page.getByRole('button', { name: 'Share Wiki', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Copy Link', exact: true })).toBeEnabled();
});

test('HTML attachments remain readable while missing-asset SPA fallbacks are rejected', async ({ page }) => {
  await page.route('**/assets/report.html', route => route.fulfill({ contentType: 'text/html', headers: { 'Content-Disposition': 'inline; filename="report.html"' }, body: '<h1>Report</h1>' }));
  await page.route('**/assets/missing.png', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('/tests/theme/share.html');
  const result = await page.evaluate(async () => {
    const path = '/src/components/wiki/wikiAssetStore.ts';
    const { getWikiAssetBlob, syncWikiDocumentAssets } = await import(path);
    await syncWikiDocumentAssets('[Report](assets/report.html)');
    const report = await getWikiAssetBlob('assets/report.html');
    const missing = await getWikiAssetBlob('assets/missing.png');
    let rejected = false;
    try { await syncWikiDocumentAssets('![Missing](assets/missing.png)'); } catch { rejected = true; }
    return { report: await report?.text(), missing: missing === null, rejected };
  });
  expect(result).toEqual({ report: '<h1>Report</h1>', missing: true, rejected: true });
});

test('conversation sharing creates a token and supports HTTP clipboard fallback', async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ai', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ action: 'conversation.share', payload: { id: 'conversation-1' } });
    await hold; await route.fulfill({ json: { shareId: 'random-share-token' } });
  });
  await page.goto('/tests/theme/share.html');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    document.execCommand = command => { (window as any).__copyCommand = command; return true; };
  });
  await page.getByRole('button', { name: 'Share AI', exact: true }).click();
  const copy = page.getByRole('dialog').getByRole('button', { name: 'Copy Link', exact: true }).first();
  await expect(copy).toBeDisabled(); release();
  await expect(copy).toBeEnabled();
  await expect(page.getByRole('dialog').getByRole('textbox').first()).toHaveValue(/workspace=A&share=random-share-token#\/ai\/conversation-1$/);
  await copy.click();
  expect(await page.evaluate(() => (window as any).__copyCommand)).toBe('copy');
});

test('anonymous conversation link renders read-only content and handles invalid or old links', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lanmind-locale-preference', 'en-US'));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/public/ai/token') {
      expect(url.searchParams.get('workspace')).toBe('A');
      await route.fulfill({ json: { id: 'conversation-1', title: 'Shared discussion', sharedAt: '2026-10-26', messages: [
        { id: 'user', role: 'user', content: 'How do I share?', createdAt: '2026-10-26' },
        { id: 'assistant', role: 'assistant', content: '**Share the link**\n\n<script>window.__unsafe=true</script>', createdAt: '2026-10-26' },
      ] } });
    } else await route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/network.html?workspace=A&share=token#/ai/conversation-1');
  await expect(page.getByRole('heading', { name: 'Shared discussion', exact: true })).toBeVisible();
  await expect(page.getByText('How do I share?', { exact: true })).toBeVisible();
  await expect(page.locator('strong')).toContainText('Share the link');
  expect(await page.evaluate(() => (window as any).__unsafe)).toBeUndefined();
  await expect(page.locator('textarea')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/ai/wrong-conversation'; });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shared discussion', exact: true })).toHaveCount(0);
  await page.goto('/network.html?workspace=A#/ai/conversation-1');
  await expect(page.getByRole('alert')).toBeVisible();
});
