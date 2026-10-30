import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadGeneratorHistory,
  saveGeneratorHistory,
  renderHighlightedPassword,
  type GeneratedPasswordRecord,
} from './GeneratorPanel';

// Mock localStorage for test environment if not present
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    length: store.size,
  };
}

test('generator history persists to localStorage and enforces maximum bounds', () => {
  localStorage.clear();
  assert.deepEqual(loadGeneratorHistory(), []);

  const sample: GeneratedPasswordRecord[] = [
    { id: '1', password: 'pwd1', createdAt: 1000 },
    { id: '2', password: 'pwd2', createdAt: 2000 },
  ];
  saveGeneratorHistory(sample);

  const loaded = loadGeneratorHistory();
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].password, 'pwd1');
  assert.equal(loaded[1].password, 'pwd2');

  // Bound test: 60 records capped to 50
  const many: GeneratedPasswordRecord[] = Array.from({ length: 60 }, (_, i) => ({
    id: `id-${i}`,
    password: `p-${i}`,
    createdAt: i,
  }));
  saveGeneratorHistory(many);
  assert.equal(loadGeneratorHistory().length, 50);

  localStorage.clear();
  assert.deepEqual(loadGeneratorHistory(), []);
});

test('renderHighlightedPassword classifies characters accurately into styled elements', () => {
  const elements = renderHighlightedPassword('A1#');
  assert.ok(Array.isArray(elements));
  assert.equal(elements.length, 3);

  // Letter 'A' -> text-main
  assert.ok(elements[0].props.className.includes('text-main'));
  // Digit '1' -> text-blue-500
  assert.ok(elements[1].props.className.includes('text-blue-500'));
  // Symbol '#' -> text-rose-500
  assert.ok(elements[2].props.className.includes('text-rose-500'));

  // Null for empty string
  assert.equal(renderHighlightedPassword(''), null);
});

