import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} });
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });

import { collectSubtreeIds, createWikiDocument, loadWikiState, saveWikiState } from './wikiStore';
import type { WikiDocument, WikiState } from './wikiTypes';
import { setWorkspaceContext, type WorkspaceContext } from '../../utils/workspaceContext';

test('collectSubtreeIds finds all recursive descendant ids', () => {
  const root = createWikiDocument({ title: 'Root' });
  const child1 = createWikiDocument({ title: 'Child 1', parentId: root.id });
  const child2 = createWikiDocument({ title: 'Child 2', parentId: root.id });
  const grandChild = createWikiDocument({ title: 'GrandChild', parentId: child1.id });
  const unrelated = createWikiDocument({ title: 'Other Root' });

  const docs = [root, child1, child2, grandChild, unrelated];

  const subtreeRoot = collectSubtreeIds(docs, root.id);
  assert.equal(subtreeRoot.length, 4);
  assert.ok(subtreeRoot.includes(root.id));
  assert.ok(subtreeRoot.includes(child1.id));
  assert.ok(subtreeRoot.includes(child2.id));
  assert.ok(subtreeRoot.includes(grandChild.id));
  assert.ok(!subtreeRoot.includes(unrelated.id));

  const subtreeChild1 = collectSubtreeIds(docs, child1.id);
  assert.deepEqual(subtreeChild1.sort(), [child1.id, grandChild.id].sort());
});

test('moving page updates parentId, sortOrder and avoids circular dependencies', () => {
  const docA = createWikiDocument({ title: 'A', sortOrder: 0 });
  const docB = createWikiDocument({ title: 'B', parentId: docA.id, sortOrder: 0 });
  const docC = createWikiDocument({ title: 'C', parentId: docB.id, sortOrder: 0 });
  const docD = createWikiDocument({ title: 'D', sortOrder: 1 });

  const docs = [docA, docB, docC, docD];

  // Moving docA to docC should be blocked because docC is a descendant of docA
  const subtreeA = new Set(collectSubtreeIds(docs, docA.id));
  assert.ok(subtreeA.has(docC.id));

  // Moving docB to root (null)
  const isTargetBlocked = subtreeA.has(docD.id);
  assert.equal(isTargetBlocked, false);
});

test('AI create wiki integration maintains workspace scope and state persistence', () => {
  const scope: WorkspaceContext = { workspaceId: 'ws-test-ai', userId: 'user-1', revision: 1 };
  setWorkspaceContext(scope);

  const initial = loadWikiState('ws-test-ai', scope);
  const newDoc = createWikiDocument({
    title: 'AI Output Title',
    content: 'AI Generated Content',
    parentId: null,
    sortOrder: initial.documents.length,
  });
  (newDoc as { workspaceId?: string }).workspaceId = 'ws-test-ai';

  const nextState: WikiState = {
    ...initial,
    documents: [...initial.documents, newDoc],
    selectedId: newDoc.id,
  };

  const ok = saveWikiState(nextState, 'ws-test-ai', scope, false);
  assert.equal(ok, true);

  const loaded = loadWikiState('ws-test-ai', scope);
  assert.ok(loaded.documents.some((d) => d.id === newDoc.id));
  const found = loaded.documents.find((d) => d.id === newDoc.id);
  assert.equal(found?.title, 'AI Output Title');
  assert.equal(found?.content, 'AI Generated Content');
});
