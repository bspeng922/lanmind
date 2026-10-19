import test from 'node:test';
import assert from 'node:assert/strict';
import { ZipArchive, computeCrc32 } from './zipUtils';

test('computeCrc32 correctly calculates CRC32 for known strings', () => {
  const encoder = new TextEncoder();
  assert.equal(computeCrc32(encoder.encode('')), 0);
  assert.equal(computeCrc32(encoder.encode('123456789')), 0xcbf43926);
  assert.equal(computeCrc32(encoder.encode('hello world')), 0x0d4a1185);
});

test('ZipArchive correctly generates a valid ZIP binary with UTF-8 paths and files', async () => {
  const zip = new ZipArchive();
  zip.addFile('README.md', '# Hello LanMind');
  zip.addFile('docs/架构设计.md', '## 系统架构\n\n测试内容');
  zip.addFile('assets/test.txt', new TextEncoder().encode('binary content'));

  const result = await zip.generateAsync();
  assert.ok(result instanceof Uint8Array);
  assert.ok(result.length > 100);

  // Check ZIP Local Header Magic: 'PK\x03\x04' = 0x04034b50
  assert.equal(result[0], 0x50); // 'P'
  assert.equal(result[1], 0x4b); // 'K'
  assert.equal(result[2], 0x03);
  assert.equal(result[3], 0x04);
});
