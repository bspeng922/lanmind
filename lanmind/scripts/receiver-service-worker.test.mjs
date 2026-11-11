import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createReceiverServiceWorker } from './receiver-service-worker.mjs';

const source = await readFile(new URL('../receiver/sw.js', import.meta.url), 'utf8');
const version = worker => worker.match(/const CACHE = '([^']+)'/)[1];
const assets = [['index.html', '<html>receiver</html>'], ['icon-128.png', new Uint8Array([1, 2])]];

test('offline receiver cache changes when fixed-name resources or worker logic change', () => {
  const initial = version(createReceiverServiceWorker(source, assets));
  for (const changed of [
    [['index.html', '<html>updated</html>'], assets[1]],
    [assets[0], ['icon-128.png', new Uint8Array([3, 4])]],
  ]) assert.notEqual(version(createReceiverServiceWorker(source, changed)), initial);
  assert.notEqual(version(createReceiverServiceWorker(`${source}\n// updated worker`, assets)), initial);
});

test('offline receiver precache is deterministic and excludes its service worker', () => {
  const worker = createReceiverServiceWorker(source, assets);
  assert.equal(createReceiverServiceWorker(source, [...assets].reverse()), worker);
  assert.equal(createReceiverServiceWorker(source, [...assets, ['sw.js', 'previous build']]), worker);
  const urls = JSON.parse(worker.match(/const PRECACHE = (.+);/)[1]);
  assert.deepEqual(urls, ['/receiver/icon-128.png', '/receiver/index.html', '/receiver/']);
});
