import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tests = ['src', 'plugins', 'scripts'].flatMap(directory =>
  readdirSync(path.join(root, directory), { recursive: true })
    .filter(file => /\.test\.(?:ts|mjs)$/.test(file))
    .map(file => path.join(directory, file)),
).sort();

if (tests.length === 0) throw new Error('No unit tests found');
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
