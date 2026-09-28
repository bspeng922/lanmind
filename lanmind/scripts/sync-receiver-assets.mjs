import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await copyFile(path.join(root, 'receiver/sw.js'), path.join(root, 'public/receiver/sw.js'));
await copyFile(path.join(root, 'src-tauri/icons/128x128.png'), path.join(root, 'public/receiver/icon-128.png'));
