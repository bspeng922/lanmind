import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'dist-receiver/receiver');
const target = path.join(root, 'dist/receiver');
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true, force: true });
