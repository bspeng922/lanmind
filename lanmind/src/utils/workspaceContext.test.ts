import test from 'node:test';
import assert from 'node:assert/strict';
import { setWorkspaceContext, scopedStorageKey, migrateWorkspaceStorage, clearWorkspaceStorage, sameWorkspace } from './workspaceContext';

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  key(index: number) { return [...this.map.keys()][index] ?? null; }
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
}
const storage = new MemoryStorage();
Object.assign(globalThis, { localStorage: storage, window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} } });
const a = { workspaceId: 'A', userId: 'alice', revision: 1, originalWorkspaceId: 'A' };
const b = { ...a, workspaceId: 'B', revision: 2 };

test('dissolution clears all users and legacy caches of its workspace without touching another workspace or preferences', () => {
  storage.clear();
  const removed = [scopedStorageKey('wiki', a), scopedStorageKey('wiki', { ...a, userId: 'bob' }),
    'lanmind_wiki_documents_v2_A', 'lanmind_ai_messages_v1_A:chat', 'lanmind_wiki_documents_v2', 'lanmind_task_attachments:old'];
  const retained = [scopedStorageKey('wiki', b), scopedStorageKey('wiki', { ...b, workspaceId: 'AA' }),
    'lanmind_wiki_documents_v2_B', 'lanmind_ai_messages_v1_B:chat', 'lanmind-locale-preference'];
  for (const key of [...removed, ...retained]) storage.setItem(key, 'saved');
  clearWorkspaceStorage('A', a, storage);
  for (const key of removed) assert.equal(storage.getItem(key), null);
  for (const key of retained) assert.equal(storage.getItem(key), 'saved');
  clearWorkspaceStorage('A', a, storage);
  for (const key of retained) assert.equal(storage.getItem(key), 'saved');
});

test('legacy data migrates once to the recorded original workspace', () => {
  storage.clear();
  storage.setItem('lanmind_wiki_documents_v2', '{"documents":[{"id":"legacy"}]}');
  migrateWorkspaceStorage(b, storage);
  assert.equal(storage.getItem(scopedStorageKey('lanmind_wiki_documents_v2', b)), null);
  migrateWorkspaceStorage(a, storage);
  assert.ok(storage.getItem(scopedStorageKey('lanmind_wiki_documents_v2', a)));
  storage.setItem(scopedStorageKey('lanmind_wiki_documents_v2', a), '{"documents":[]}');
  migrateWorkspaceStorage(a, storage);
  assert.equal(storage.getItem(scopedStorageKey('lanmind_wiki_documents_v2', a)), '{"documents":[]}');
  assert.ok(storage.getItem('lanmind_wiki_documents_v2')); // Recovery snapshot remains.
});

test('namespaces separate users and stale responses after A-B-A switching', () => {
  assert.notEqual(scopedStorageKey('projects', a), scopedStorageKey('projects', b));
  assert.notEqual(scopedStorageKey('projects', a), scopedStorageKey('projects', { ...a, userId: 'bob' }));
  setWorkspaceContext({ ...a, revision: 3 });
  assert.equal(sameWorkspace(a), false);
});

test('Wiki debounce saves use the captured user and workspace', async () => {
  storage.clear(); setWorkspaceContext(a);
  const { createStarterState, saveWikiState, loadWikiState } = await import('../components/wiki/wikiStore');
  const state = createStarterState(); state.documents[0].content = 'A secret';
  setWorkspaceContext({ ...b, userId: 'bob' });
  assert.equal(saveWikiState(state, 'A', a), true);
  assert.equal(loadWikiState('A', a).documents[0].content, 'A secret');
  assert.equal(loadWikiState('B', b).documents[0].content, '');
  assert.equal(loadWikiState('A', { ...a, userId: 'bob' }).documents[0].content, '');
});

test('AI workspace switches do not fall back to global conversations or messages', async () => {
  storage.clear(); setWorkspaceContext(a);
  const ai = await import('../components/ai/aiStore');
  ai.setAIWorkspace('A');
  const conversation = ai.createConversation('A conversation');
  ai.appendMessage(conversation.id, { role: 'user', content: 'A secret' });
  setWorkspaceContext(b); ai.setAIWorkspace('B');
  assert.deepEqual(ai.getConversationSummaries(), []);
  assert.deepEqual(ai.getMessages(conversation.id), []);
  setWorkspaceContext(a); ai.setAIWorkspace('A');
  assert.equal(ai.getMessages(conversation.id)[0].content, 'A secret');
  setWorkspaceContext({ ...a, userId: 'bob' }); ai.setAIWorkspace('A');
  assert.deepEqual(ai.getConversationSummaries(), []);
});


test('existing workspace caches migrate to their recorded workspace, never another user', () => {
  storage.clear();
  const original = { ...a, originalUserId: 'alice' };
  const other = { ...original, workspaceId: 'B' };
  storage.setItem('lanmind_wiki_documents_v2', 'global');
  storage.setItem('lanmind_wiki_documents_v2_B', 'B pages');
  storage.setItem('lanmind_ai_conversations_v1_B', 'B conversations');
  storage.setItem('lanmind_ai_messages_v1_B:thread', 'B messages');
  migrateWorkspaceStorage({ ...other, userId: 'bob' }, storage);
  assert.equal(storage.getItem(scopedStorageKey('lanmind_wiki_documents_v2', { ...other, userId: 'bob' })), null);
  migrateWorkspaceStorage(other, storage);
  assert.equal(storage.getItem(scopedStorageKey('lanmind_wiki_documents_v2', other)), 'B pages');
  assert.equal(storage.getItem(scopedStorageKey('lanmind_ai_messages_v1:thread', other)), 'B messages');
  migrateWorkspaceStorage(original, storage);
  assert.equal(storage.getItem(scopedStorageKey('lanmind_wiki_documents_v2', original)), 'global');
});

test('Wiki links resolve only in their explicit workspace', async () => {
  const { wikiIdFromLink } = await import('../components/wiki/wikiLinks');
  setWorkspaceContext(a);
  assert.equal(wikiIdFromLink('lanmind://wiki/page-a?workspace=A'), 'page-a');
  assert.equal(wikiIdFromLink('https://example.test/?workspace=A#/wiki/page-a'), 'page-a');
  setWorkspaceContext(b);
  assert.equal(wikiIdFromLink('lanmind://wiki/page-a?workspace=A'), null);
  assert.equal(wikiIdFromLink('https://example.test/?workspace=A#/wiki/page-a'), null);
  assert.equal(wikiIdFromLink('lanmind://wiki/page-b'), 'page-b');
});
