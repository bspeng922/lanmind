import assert from 'node:assert/strict';
import { test } from 'node:test';
import { polishDiff, polishModel } from './wikiPolish';
import type { Catalog } from '../ai/aiClient';

test('polish diff reconstructs both Markdown articles including Unicode, code and asset paths', () => {
  const original = '# 标题\n\n原文🙂。\n\n```ts\nconst x = 1;\n```\n![图片](assets/one.png)';
  const result = original.replace('原文🙂。', '更清晰的文字🙂。');
  const parts = polishDiff(original, result);
  assert.equal(parts.filter(([op]) => op !== 1).map(([, text]) => text).join(''), original);
  assert.equal(parts.filter(([op]) => op !== -1).map(([, text]) => text).join(''), result);
  assert.ok(parts.some(([op]) => op === -1));
  assert.ok(parts.some(([op]) => op === 1));
  assert.deepEqual(polishDiff('', ''), []);
  assert.deepEqual(polishDiff(original, original), [[0, original]]);
});

test('polish model uses configured references and rejects disabled or unbound preferences', () => {
  const key = (c: string) => JSON.stringify({ connectionId: c, modelEntryId: 'same-model' });
  const catalog: Catalog = { schemaVersion: 2, defaults: { chat: JSON.parse(key('default')) },
    connections: ['unbound', 'disabled', 'first', 'default'].map(id => ({
      id, name: id, baseUrl: 'http://fixture.invalid', providerType: 'ollama', enabled: id !== 'disabled', bound: id !== 'unbound',
      revision: 1, configRevision: 1, hasCredential: false, referenceCount: 0, parameters: {},
      models: [{ id: 'same-model', remoteModelId: 'same-model', displayName: id, enabled: true, missing: false, parameters: {}, capabilities: {} }],
    })) };
  assert.equal(polishModel(catalog, key('first')), key('first'));
  assert.equal(polishModel(catalog, key('disabled')), key('default'));
  assert.equal(polishModel(catalog, key('unbound')), key('default'));
  catalog.connections[3].models[0].enabled = false;
  assert.equal(polishModel(catalog), key('first'));
  assert.equal(polishModel({ ...catalog, connections: [] }), '');
});

test('changed emoji remain complete characters in each highlighted fragment', () => {
  for (const [before, after] of [['你好🙂结束', '你好😊结束'], ['𐀀', '𐐀'], ['🙂🙂', '🙃🙂']]) {
    const parts = polishDiff(before, after);
    assert.equal(parts.filter(([op]) => op !== 1).map(([, text]) => text).join(''), before);
    assert.equal(parts.filter(([op]) => op !== -1).map(([, text]) => text).join(''), after);
    for (const [, text] of parts) assert.doesNotMatch(text, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  }
});
