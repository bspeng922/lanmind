import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../src-tauri/', import.meta.url));
const build = spawnSync('cargo', ['build', '--locked', '--bin', 'lanmind', '--message-format=json-render-diagnostics'], {
  cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const artifacts = build.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
const executable = artifacts.findLast(message => message.reason === 'compiler-artifact'
  && message.target.name === 'lanmind' && message.target.kind.includes('bin') && message.executable)?.executable;
if (!executable) throw new Error('Cargo did not report the desktop executable');
console.log('Verifying native script isolation, limits and cancellation with the current desktop binary.');
const test = spawnSync('cargo', ['test', '--locked', '--lib', 'native_worker_obeys_process_boundary_and_cancellation', '--', '--ignored'], {
  cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, LANMIND_AI_TEST_BINARY: executable }, windowsHide: true,
});
if (test.error) throw test.error;
process.stdout.write(test.stdout);
if (test.status === 0 && !/test result: ok\. 1 passed; 0 failed; 0 ignored;/.test(test.stdout))
  throw new Error('The native worker acceptance test did not run exactly once');
process.exit(test.status ?? 1);
