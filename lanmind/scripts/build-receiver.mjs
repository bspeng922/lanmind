import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReceiverServiceWorker } from './receiver-service-worker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await cp(path.join(root, 'src-tauri/icons/128x128.png'), path.join(root, 'public/receiver/icon-128.png'), { force: true });
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.receiver.config.ts'], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

async function findFile(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) { const found = await findFile(full, name); if (found) return found; }
  }
}
async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(full));
    else files.push(full);
  }
  return files;
}

const output = path.join(root, 'dist-receiver');
const webRoot = path.join(output, 'receiver');
await cp(path.join(output, 'assets'), path.join(webRoot, 'assets'), { recursive: true, force: true });
await rm(path.join(output, 'assets'), { recursive: true, force: true });
for (const name of ['manifest.webmanifest', 'zstd.wasm', 'icon-128.png']) {
  const source = path.join(output, name);
  try { await cp(source, path.join(webRoot, name), { force: true }); await rm(source); } catch { /* the public receiver copy may already be in place */ }
}
const index = await findFile(output, 'index.html');
if (!index) throw new Error('receiver build did not produce index.html');
const files = (await listFiles(webRoot)).filter((file) => !file.endsWith('sw.js'));
const source = await readFile(path.join(root, 'receiver/sw.js'), 'utf8');
const assets = await Promise.all(files.map(async file => [
  path.relative(webRoot, file).split(path.sep).join('/'), await readFile(file),
]));
const serviceWorker = createReceiverServiceWorker(source, assets);
await writeFile(path.join(webRoot, 'sw.js'), serviceWorker);
console.log(`receiver precache: ${assets.length + 1} resources`);
