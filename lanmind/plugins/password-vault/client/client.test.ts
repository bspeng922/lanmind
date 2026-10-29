import assert from 'node:assert/strict';
import test from 'node:test';
import { VaultClient, descendants, folderPath, vaultError } from './index';

test('late credential responses cannot reappear after locking', async () => {
  let status = { configured: true, locked: false, sessionVersion: 1, idleMinutes: 5 };
  let resolveRead: (value: unknown) => void = () => {};
  const client = new VaultClient(async action => {
    if (action === 'get') return new Promise(resolve => { resolveRead = resolve; });
    if (action === 'lock') status = { ...status, locked: true, sessionVersion: 2 };
    return { ...status };
  }, false);
  await client.initialize();
  const pending = client.call('get', { id: 'record' });
  await client.call('lock'); resolveRead({ password: 'must never be rendered' });
  await assert.rejects(pending, /VAULT_LOCKED/);
  assert.equal(client.snapshot().locked, true);
});
test('folder selection includes descendants and paths remain bounded for malformed trees', () => {
  const folders = [{ id: 'a', name: 'Root', parentId: null }, { id: 'b', name: 'Servers', parentId: 'a' }, { id: 'c', name: 'SSH', parentId: 'b' }];
  assert.deepEqual([...descendants(folders, 'a')].sort(), ['a', 'b', 'c']);
  assert.equal(folderPath(folders, 'c'), 'Root / Servers / SSH');
  assert.equal(folderPath([{ id: 'a', name: 'Loop', parentId: 'a' }], 'a'), 'Loop');
});
test('unknown native errors do not expose arbitrary backend strings to the interface', () => {
  const raw = 'provider accidentally included a private value';
  assert.ok(!vaultError(new Error(raw)).includes(raw));
  assert.ok(!vaultError('VAULT_PASSWORD').includes('VAULT_PASSWORD'));
});
