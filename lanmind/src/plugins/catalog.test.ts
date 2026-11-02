import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePluginVersions, groupPluginCatalog } from './catalog';
import type { MarketPackage } from './client';

function item(pluginKey = 'publisher/example', version = '1.0.0', sha256 = 'a', nodeId = 'one'): MarketPackage {
  return { pluginKey, publisherId: 'publisher', sha256, sizeBytes: 100, compatible: true, metadata: { manifest: '', publicKey: '', signature: '' },
    manifest: { schemaVersion: 2, runtime: 'web', id: 'example', version, name: { 'en-US': 'Example' }, description: {}, defaultLocale: 'en-US', minHostVersion: '0.2.1', sdkVersion: 1, entry: 'index.html', capabilities: [], files: {} },
    sources: [{ nodeId, displayName: nodeId, address: '127.0.0.1', port: 1 }] };
}
test('catalog collapses sources without merging publishers, versions or conflicting packages', () => {
  const groups = groupPluginCatalog([item(), item(undefined, undefined, undefined, 'two'), item(undefined, '2.0.0', 'b'), item('another/example')]);
  assert.equal(groups.length, 2); assert.equal(groups[0].variants.length, 2); assert.equal(groups[0].variants[1].sources.length, 2);
  assert.equal(groups[0].recommended?.manifest.version, '2.0.0');
  const conflicted = groupPluginCatalog([item(), item(undefined, undefined, 'different'), item(undefined, '0.9.0', 'old')])[0];
  assert.equal(conflicted.conflicts.has('1.0.0'), true); assert.equal(conflicted.recommended?.manifest.version, '0.9.0');
});
test('versions compare numerically and stable compatible versions are recommended', () => {
  assert.equal(comparePluginVersions('1.10.0', '1.9.0'), 1); assert.equal(comparePluginVersions('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(comparePluginVersions('1.0.0-rc.10', '1.0.0-rc.2'), 1); assert.equal(comparePluginVersions('1.0.0+one', '1.0.0+two'), 0);
  const incompatible = { ...item(undefined, '3.0.0'), compatible: false };
  assert.equal(groupPluginCatalog([item(), item(undefined, '2.0.0-beta'), incompatible])[0].recommended?.manifest.version, '1.0.0');
});

test('a LAN release cannot replace a different installed package with the same version', () => {
  const local = { ...item(), enabled: true, shared: true, available: true, installedAt: '2026-11-02' };
  const collision = groupPluginCatalog([item(undefined, '1.0.0', 'different')], [local])[0];
  assert.equal(collision.conflicts.has('1.0.0'), true);
  assert.equal(collision.recommended, undefined);
  const upgrade = groupPluginCatalog([item(undefined, '1.0.0', 'different'), item(undefined, '1.1.0', 'next')], [local])[0];
  assert.equal(upgrade.recommended?.manifest.version, '1.1.0');
});
