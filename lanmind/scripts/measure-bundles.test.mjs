import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { checkBudgets, measureEntry } from './measure-bundles.mjs';

test('bundle measurement follows transitive static imports once and excludes deferred chunks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lanmind-bundles-'));
  try {
    const code = 'export const value = 1;';
    await Promise.all(['entry.js', 'shared.js', 'nested.js'].map(file => writeFile(path.join(directory, file), code)));
    const manifest = {
      'index.html': { isEntry: true, file: 'entry.js', imports: ['shared', 'nested'], dynamicImports: ['lazy'] },
      shared: { file: 'shared.js', imports: ['nested'] },
      nested: { file: 'nested.js' },
      lazy: { file: 'not-loaded.js' },
    };
    assert.deepEqual(await measureEntry(manifest, 'index.html', directory), {
      files: 3, bytes: Buffer.byteLength(code) * 3, gzip: gzipSync(code).length * 3,
    });
    await assert.rejects(measureEntry(manifest, 'missing.html', directory), /Missing bundle entry/);
    manifest.shared.imports.push('missing');
    await assert.rejects(measureEntry(manifest, 'index.html', directory), /Missing bundle chunk/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('bundle budgets reject unknown entries, invalid limits and oversized bundles', () => {
  const result = { 'index.html': { gzip: 100 } };
  checkBudgets(result, { 'index.html': 100 });
  assert.throws(() => checkBudgets(result, {}), /do not match/);
  assert.throws(() => checkBudgets(result, { 'index.html': null }), /Invalid bundle budget/);
  assert.throws(() => checkBudgets(result, { 'index.html': 99 }), /exceeds/);
});
