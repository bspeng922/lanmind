import test from 'node:test';
import assert from 'node:assert/strict';
import { setWorkspaceContext, type WorkspaceContext } from '../../utils/workspaceContext';
import type { WikiDocument, WikiState } from './wikiTypes';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} });
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
const { ApiService } = await import('../../services/api');
const { enqueueWikiSave, rememberWikiBaseline, resetWikiQueue, wikiSaveBlocked, WIKI_SAVE_EVENT } = await import('./wikiPersistence');
const scope: WorkspaceContext = { workspaceId: 'ws', userId: 'me', revision: 1 };
const doc = (id: string, version = 1): WikiDocument => ({
  id, version, title: id, content: 'original', parentId: null, projectId: null,
  sortOrder: 0, favorite: false, createdAt: '2026-10-19', updatedAt: '2026-10-19',
});
const state = (documents: WikiDocument[]): WikiState => ({ documents, selectedId: documents[0]?.id ?? null, expandedIds: [] });
interface Payload {
  changes: { document: WikiDocument; expectedVersion: number | null }[];
  deletions: { id: string; expectedVersion: number | null }[];
  view: { favorites: string[] };
}

test('queued Wiki edits use acknowledged versions and never send unchanged pages', async t => {
  setWorkspaceContext(scope);
  const pendingStates: boolean[] = [];
  const onSaved = (event: Event) => {
    const detail = (event as CustomEvent<{ key: string; pending: boolean }>).detail;
    if (detail.key === 'serial') pendingStates.push(detail.pending);
  };
  window.addEventListener(WIKI_SAVE_EVENT, onSaved);
  t.after(() => window.removeEventListener(WIKI_SAVE_EVENT, onSaved));
  const a = doc('A'), b = doc('B', 3), calls: Payload[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(ApiService, 'saveWikiChanges', async (raw: unknown) => {
    const payload = raw as Payload;
    calls.push(payload);
    if (calls.length === 1) await gate;
    return { documents: payload.changes.map(c => ({ ...c.document, version: (c.expectedVersion ?? 0) + 10 })) };
  });
  rememberWikiBaseline('serial', [a, b]);
  const first = enqueueWikiSave('serial', state([{ ...a, content: 'first' }, b]), [a, b], scope);
  const second = enqueueWikiSave('serial', state([{ ...a, content: 'second' }, b]), [a, b], scope);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(wikiSaveBlocked('serial'), true);
  release(); await first; await second;
  assert.deepEqual(pendingStates, [true, true, true, false]);
  assert.deepEqual(calls.map(c => c.changes.map(v => [v.document.id, v.expectedVersion])), [[['A', 1]], [['A', 11]]]);
  assert.equal(wikiSaveBlocked('serial'), false);
  await enqueueWikiSave('serial', state([b]), [a, b], scope);
  assert.deepEqual(calls[2].deletions, [{ id: 'A', expectedVersion: 21 }]);
  assert.deepEqual(calls[2].changes, []);
});

test('personal Wiki view changes do not rewrite document content or versions', async t => {
  setWorkspaceContext(scope);
  const a = doc('A');
  const calls: Payload[] = [];
  t.mock.method(ApiService, 'saveWikiChanges', async (raw: unknown) => { calls.push(raw as Payload); return { documents: [] }; });
  rememberWikiBaseline('view', [a]);
  await enqueueWikiSave('view', state([{ ...a, favorite: true, updatedAt: 'new local timestamp' }]), [a], scope);
  assert.deepEqual(calls[0].changes, []);
  assert.deepEqual(calls[0].view.favorites, ['A']);
});

test('Wiki metadata additions and removals are saved without changing the body', async t => {
  setWorkspaceContext(scope);
  const a = doc('A'), calls: Payload[] = [];
  t.mock.method(ApiService, 'saveWikiChanges', async (raw: unknown) => {
    const payload = raw as Payload;
    calls.push(payload);
    return { documents: payload.changes.map(change => ({ ...change.document, version: (change.expectedVersion ?? 0) + 1 })) };
  });
  rememberWikiBaseline('metadata', [a]);
  await enqueueWikiSave('metadata', state([{ ...a, icon: 'book', tags: ['Product'] }]), [a], scope);
  await enqueueWikiSave('metadata', state([{ ...a, tags: [] }]), [a], scope);
  assert.deepEqual(calls.map(call => call.changes.map(change => [change.expectedVersion, change.document.tags, change.document.icon, change.document.content])), [
    [[1, ['Product'], 'book', 'original']],
    [[2, [], undefined, 'original']],
  ]);
  await enqueueWikiSave('metadata', state([a]), [a], scope);
  assert.deepEqual(calls[2].changes, []);
});

test('Wiki conflicts preserve the latest draft and stop stale saves until explicit reload', async t => {
  setWorkspaceContext(scope);
  const a = doc('A');
  const save = t.mock.method(ApiService, 'saveWikiChanges', async () => { throw new Error('VERSION_CONFLICT'); });
  rememberWikiBaseline('conflict', [a]);
  await enqueueWikiSave('conflict', state([{ ...a, content: 'draft one' }]), [a], scope);
  await enqueueWikiSave('conflict', state([{ ...a, content: 'latest draft' }]), [a], scope);
  assert.equal(save.mock.callCount(), 1);
  assert.equal(wikiSaveBlocked('conflict'), true);
  assert.equal(storage.get('conflict:save-error'), 'VERSION_CONFLICT');
  assert.equal(JSON.parse(storage.get('conflict:conflict-draft')!).documents[0].content, 'latest draft');
  resetWikiQueue('conflict');
  assert.equal(storage.has('conflict:save-error'), false);
  rememberWikiBaseline('conflict', [{ ...a, version: 5, content: 'external content' }]);
  t.mock.method(ApiService, 'saveWikiChanges', async (raw: unknown) => {
    assert.equal((raw as Payload).changes[0].expectedVersion, 5);
    return { documents: [{ ...a, version: 6, content: 'merged draft' }] };
  });
  await enqueueWikiSave('conflict', state([{ ...a, version: 5, content: 'merged draft' }]), [a], scope);
  assert.equal(wikiSaveBlocked('conflict'), false);
});

test('Wiki saves captured before a workspace switch never reach the new workspace', async t => {
  const save = t.mock.method(ApiService, 'saveWikiChanges', async () => ({ documents: [] }));
  setWorkspaceContext({ ...scope, workspaceId: 'other', revision: 2 });
  await enqueueWikiSave('old-scope', state([doc('A')]), [], scope);
  assert.equal(save.mock.callCount(), 0);
});
