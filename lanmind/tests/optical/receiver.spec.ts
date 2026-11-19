import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import initQr, { QrRenderer } from '@raptorqr/fast-qr-wasm';
import { initializeRaptor } from '../../src/optical/core/fec';
import { prepareTransfer } from '../../src/optical/core/prepare';
import { buildTransferPackets } from '../../src/optical/sender';

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

test('offline receiver decodes and saves a Zstd-compressed transfer', async ({ page, context }) => {
  const [qrBytes, raptorBytes] = await Promise.all([
    readFile(new URL('../../node_modules/@raptorqr/fast-qr-wasm/src/wasm/raptorqr_fast_qr_wasm_bg.wasm', import.meta.url)),
    readFile(new URL('../../node_modules/@raptorqr/raptorq-wasm/src/wasm/raptorqr_raptorq_wasm_bg.wasm', import.meta.url)),
  ]);
  await initializeRaptor(raptorBytes);
  const qr = await initQr({ module_or_path: qrBytes });
  const renderer = new QrRenderer();
  const bytes = Buffer.from('LanMind offline receiver content\n'.repeat(256));
  const transfer = await prepareTransfer(new Blob([bytes]), { fileName: 'offline.txt' });
  expect(transfer.blocks[0].compression).toBe(1);
  const packets = await buildTransferPackets(transfer, undefined, 0);
  const uniquePackets = new Map(packets.map((packet) => [Buffer.from(packet).toString('base64'), packet]));
  expect(uniquePackets.size).toBe(3);
  const matrices = [...uniquePackets.values()].map((packet) => {
    const size = renderer.render_matrix(packet, 30, 1);
    return { size, modules: Array.from(new Uint8Array(qr.memory.buffer, renderer.matrix_ptr(), size * size)) };
  });
  renderer.free();

  await page.addInitScript(() => {
    localStorage.setItem('lanmind-locale-preference', 'en-US');
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto('/receiver/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#root')).toBeVisible();
  const image = await page.evaluate((frames) => {
    const scale = 4;
    const cell = (frames[0].size + 8) * scale;
    const canvas = document.createElement('canvas');
    canvas.width = cell * 2;
    canvas.height = cell * 2;
    const drawing = canvas.getContext('2d')!;
    drawing.fillStyle = '#fff';
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.fillStyle = '#000';
    for (const [index, { size, modules }] of frames.entries()) {
      const x = (index % 2) * cell;
      const y = Math.floor(index / 2) * cell;
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          if (modules[row * size + column]) drawing.fillRect(x + (column + 4) * scale, y + (row + 4) * scale, scale, scale);
        }
      }
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, matrices);
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({
    name: 'frames.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64'),
  });
  const save = page.getByRole('button', { name: /verify and save/i });
  await expect(save).toBeEnabled();
  const downloaded = page.waitForEvent('download');
  await save.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('offline.txt');
  expect(await readFile((await download.path())!)).toEqual(bytes);
});
