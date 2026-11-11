import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Follow Vite's static import graph. Deferred engines and workers are excluded. */
export async function measureEntry(manifest, entry, directory) {
  if (!manifest[entry]?.isEntry) throw new Error(`Missing bundle entry: ${entry}`);
  const visited = new Set();
  let files = 0;
  let bytes = 0;
  let gzip = 0;
  async function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk?.file) throw new Error(`Missing bundle chunk: ${key}`);
    if (chunk.file.endsWith('.js')) {
      const code = await readFile(path.join(directory, chunk.file));
      files++;
      bytes += code.length;
      gzip += gzipSync(code).length;
    }
    for (const imported of chunk.imports || []) await visit(imported);
  }
  await visit(entry);
  if (!files) throw new Error(`No JavaScript found for ${entry}`);
  return { files, bytes, gzip };
}

export function checkBudgets(result, budgets) {
  if (Object.keys(result).sort().join() !== Object.keys(budgets).sort().join()) {
    throw new Error('Bundle entries and budgets do not match');
  }
  for (const [entry, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(budgets[entry]) || budgets[entry] <= 0) throw new Error(`Invalid bundle budget: ${entry}`);
    if (value.gzip > budgets[entry]) throw new Error(`${entry} initial JS gzip ${value.gzip} exceeds ${budgets[entry]}`);
  }
}

export async function measureBuilds(buildRoot = root) {
  const manifest = JSON.parse(await readFile(path.join(buildRoot, 'dist/.vite/manifest.json'), 'utf8'));
  const receiver = JSON.parse(await readFile(path.join(buildRoot, 'dist-receiver/.vite/manifest.json'), 'utf8'));
  return {
    'index.html': await measureEntry(manifest, 'index.html', path.join(buildRoot, 'dist')),
    'network.html': await measureEntry(manifest, 'network.html', path.join(buildRoot, 'dist')),
    // Pair the standalone manifest with its own relocated assets, even after a receiver-only rebuild.
    'receiver/index.html': await measureEntry(receiver, 'receiver/index.html', path.join(buildRoot, 'dist-receiver/receiver')),
  };
}

async function main() {
  const result = await measureBuilds();
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes('--check')) {
    checkBudgets(result, JSON.parse(await readFile(path.join(root, 'bundle-budgets.json'), 'utf8')));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
