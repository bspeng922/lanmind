import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { unzipSync } from 'fflate';
import { generatePluginKey, packageWebPlugin } from './package-web-plugin.mjs';

test('packaging signs exact metadata, includes only declared files and produces immutable reproducible packages', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lanmind-plugin-'));
  try {
    const key = path.join(directory, 'publisher.pem'); generatePluginKey(key);
    const input = path.join(directory, 'source'); fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, 'manifest.json'), JSON.stringify({ schemaVersion: 2, runtime: 'web', id: 'example', version: '1.0.0', name: { 'en-US': 'Example' }, description: {}, defaultLocale: 'en-US', sdkVersion: 1, minHostVersion: '0.2.1', entry: 'index.html', capabilities: [] }));
    fs.writeFileSync(path.join(input, 'index.html'), '<!doctype html><h1>Hello</h1>');
    const output = path.join(directory, 'example.lmpk'); const result = packageWebPlugin({ input, key, output });
    const files = unzipSync(fs.readFileSync(output)); const metadata = JSON.parse(Buffer.from(files['manifest.json']).toString()); const signature = JSON.parse(Buffer.from(files['signature.json']).toString());
    assert.equal(verify(null, Buffer.concat([Buffer.from('lanmind-web-plugin-v1\0'), files['manifest.json']]), createPublicKey(fs.readFileSync(key)), Buffer.from(signature.signature, 'base64')), true);
    assert.equal(metadata.files['index.html'], createHash('sha256').update(files['index.html']).digest('hex'));
    assert.equal(Object.keys(files).length, 3); assert.equal(result.publisherId.length, 64);
    const another = packageWebPlugin({ input, key, output: path.join(directory, 'again.lmpk') }); assert.equal(result.sha256, another.sha256);
    assert.throws(() => packageWebPlugin({ input, key, output }), /EEXIST/);
    const exposedKey = path.join(input, 'publisher.pem'); fs.copyFileSync(key, exposedKey);
    assert.throws(() => packageWebPlugin({ input, key: exposedKey, output: path.join(directory, 'unsafe.lmpk') }), /signing key must be outside/);
    fs.unlinkSync(exposedKey);
    fs.writeFileSync(path.join(input, 'signature.json'), '{}'); assert.throws(() => packageWebPlugin({ input, key, output: path.join(directory, 'bad.lmpk') }), /Reserved/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Node packages match the Rust verifier fixture in different time zones', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lanmind-plugin-interop-'));
  const previousTimezone = process.env.TZ;
  try {
    const key = path.join(directory, 'test-publisher.pem');
    // Public test seed only; this publisher must never be used for real releases.
    const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 1)]), format: 'der', type: 'pkcs8' });
    fs.writeFileSync(key, privateKey.export({ format: 'pem', type: 'pkcs8' }));
    const input = path.join(directory, 'source'); fs.mkdirSync(input);
    fs.writeFileSync(path.join(input, 'manifest.json'), JSON.stringify({ schemaVersion: 2, runtime: 'web', id: 'example', version: '1.0.0', name: { 'en-US': 'Example' }, description: {}, defaultLocale: 'en-US', sdkVersion: 1, minHostVersion: '0.2.1', entry: 'index.html', capabilities: [] }));
    fs.writeFileSync(path.join(input, 'index.html'), '<!doctype html><h1>Hello</h1>');
    const fixture = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/web-plugin-v1.json', import.meta.url), 'utf8'));
    for (const timezone of ['UTC', 'Asia/Tokyo', 'America/New_York']) {
      process.env.TZ = timezone;
      const output = path.join(directory, `${timezone.replaceAll('/', '-')}.lmpk`);
      const result = packageWebPlugin({ input, key, output });
      assert.equal(result.sha256, fixture.sha256);
      assert.equal(fs.readFileSync(output).toString('base64'), fixture.archiveBase64);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
