import test from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });

import { createWikiDocument } from './wikiStore';
import { buildWikiHistoryItems, recordRevisionSnapshot, recordWikiDocumentChange, loadWikiRevisions, deleteWikiRevision } from './wikiHistoryStore';
import { loadWikiComments, addWikiComment, deleteWikiComment } from './wikiCommentStore';
import { setWorkspaceContext, type WorkspaceContext } from '../../utils/workspaceContext';

test('createWikiDocument records creator and modifier fields', () => {
  const doc = createWikiDocument({
    title: '架构设计规范',
    content: '# 架构规范',
    createdBy: 'user-001',
    createdByName: '张三',
    updatedBy: 'user-001',
    updatedByName: '张三',
  });

  assert.equal(doc.title, '架构设计规范');
  assert.equal(doc.createdBy, 'user-001');
  assert.equal(doc.createdByName, '张三');
  assert.equal(doc.updatedBy, 'user-001');
  assert.equal(doc.updatedByName, '张三');
  assert.ok(doc.createdAt);
  assert.ok(doc.updatedAt);
});

test('wikiHistoryStore snapshots versions monotonically and retrieves them sorted', () => {
  const scope: WorkspaceContext = { workspaceId: 'ws-history-test', userId: 'user-1', revision: 1 };
  setWorkspaceContext(scope);

  const doc = createWikiDocument({
    title: '版本初稿',
    content: '正文内容 v1',
  });

  // Record v1
  const rev1 = recordRevisionSnapshot(doc, { id: 'u1', name: '李四' }, '初始版本', 'ws-history-test', scope);
  assert.equal(rev1.version, 1);
  assert.equal(rev1.title, '版本初稿');
  assert.equal(rev1.authorName, '李四');

  // Record v2
  const docV2 = { ...doc, title: '版本二稿', content: '正文内容 v2 (增加章节)' };
  const rev2 = recordRevisionSnapshot(docV2, { id: 'u2', name: '王五' }, '增加第二章', 'ws-history-test', scope);
  assert.equal(rev2.version, 2);

  // Load revisions: should be sorted descending (v2, then v1)
  const list = loadWikiRevisions(doc.id, 'ws-history-test', scope);
  assert.equal(list.length, 2);
  assert.equal(list[0].version, 2);
  assert.equal(list[1].version, 1);

  // Delete revision 1
  const remaining = deleteWikiRevision(doc.id, rev1.id, 'ws-history-test', scope);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, rev2.id);
});

test('Wiki history preserves the original author and content independently of backend clocks', () => {
  const scope: WorkspaceContext = { workspaceId: 'ws-clock-history', userId: 'user-1', revision: 1 };
  const author = { id: 'editor', name: 'Editor' };
  const before = {
    ...createWikiDocument({ title: 'Original', content: 'Before', updatedBy: 'creator', updatedByName: 'Creator' }),
    version: 1_800_000_000_000,
    updatedAt: '2026-10-19T10:00:00Z',
  };
  const after = { ...before, title: 'Edited', content: 'After', updatedAt: '2026-10-20T10:00:00Z' };
  recordWikiDocumentChange(before, after, author, 'Published', scope.workspaceId, scope);
  const revisions = loadWikiRevisions(before.id, scope.workspaceId, scope);
  assert.deepEqual(revisions.map(r => [r.version, r.title, r.content, r.authorName, r.createdAt]), [
    [2, 'Edited', 'After', 'Editor', after.updatedAt],
    [1, 'Original', 'Before', 'Creator', before.updatedAt],
  ]);
  const acknowledged = { ...after, version: 1_800_000_001_000 };
  const items = buildWikiHistoryItems(acknowledged, revisions, author);
  assert.deepEqual(items.map(r => [r.id === '__current__', r.version, r.content]), [
    [true, 2, 'After'], [false, 1, 'Before'],
  ]);
  recordWikiDocumentChange(acknowledged, { ...acknowledged, updatedAt: 'later' }, author, 'Unchanged', scope.workspaceId, scope);
  assert.deepEqual(loadWikiRevisions(before.id, scope.workspaceId, scope), revisions);
});

test('Wiki history merges a legacy current snapshot without filtering other backups by version', () => {
  const scope: WorkspaceContext = { workspaceId: 'ws-legacy-history', userId: 'user-1', revision: 1 };
  const author = { id: 'editor', name: 'Editor' };
  const doc = { ...createWikiDocument({ title: 'Page', content: 'Current' }), version: 40 };
  const currentSnapshot = recordRevisionSnapshot(doc, author, 'Legacy', scope.workspaceId, scope);
  const legacySnapshot = { ...currentSnapshot, version: 41 };
  assert.deepEqual(buildWikiHistoryItems({ ...doc, version: 47 }, [legacySnapshot], author).map(r => [r.id, r.version]), [
    ['__current__', 41],
  ]);
  const backup = { ...legacySnapshot, content: 'Draft before restore' };
  const items = buildWikiHistoryItems({ ...doc, version: 41 }, [backup], author);
  assert.equal(items.length, 2);
  assert.equal(items[0].version, 42);
  assert.equal(items[1].content, 'Draft before restore');
});

test('Wiki restoration retains saved content, unsaved drafts and earlier matching versions', () => {
  const scope: WorkspaceContext = { workspaceId: 'ws-restore-history', userId: 'user-1', revision: 1 };
  const author = { id: 'editor', name: 'Editor' };
  const first = createWikiDocument({ title: 'Page', content: 'First' });
  const second = { ...first, content: 'Second' };
  const draft = { ...first, content: 'Unpublished draft' };
  recordWikiDocumentChange(first, second, author, 'Published', scope.workspaceId, scope);
  recordWikiDocumentChange(second, draft, author, 'Backup', scope.workspaceId, scope);
  recordWikiDocumentChange(draft, first, author, 'Restored', scope.workspaceId, scope);
  const revisions = loadWikiRevisions(first.id, scope.workspaceId, scope);
  const items = buildWikiHistoryItems(first, revisions, author);
  assert.deepEqual(items.map(r => [r.version, r.content]), [
    [4, 'First'], [3, 'Unpublished draft'], [2, 'Second'], [1, 'First'],
  ]);
  assert.equal(recordRevisionSnapshot(first, author, 'Unchanged', scope.workspaceId, scope).id, revisions[0].id);
  assert.equal(loadWikiRevisions(first.id, scope.workspaceId, scope).length, 4);
});

test('wikiCommentStore adds, lists, and deletes document comments', () => {
  const scope: WorkspaceContext = { workspaceId: 'ws-comments-test', userId: 'user-1', revision: 1 };
  setWorkspaceContext(scope);

  const docId = 'doc-comment-1';

  const initial = loadWikiComments(docId, 'ws-comments-test', scope);
  assert.equal(initial.length, 0);

  const comment1 = addWikiComment(
    docId,
    {
      authorId: 'user-a',
      authorName: '赵六',
      content: '这篇文档对架构阐述很清晰！',
    },
    'ws-comments-test',
    scope,
  );
  assert.ok(comment1.id);
  assert.equal(comment1.authorName, '赵六');

  const comment2 = addWikiComment(
    docId,
    {
      authorId: 'user-b',
      authorName: '钱七',
      content: '同意，补充了部分图表。',
      replyToCommentId: comment1.id,
      replyTo: {
        commentId: comment1.id,
        authorId: comment1.authorId,
        authorName: comment1.authorName,
        content: comment1.content,
      },
    },
    'ws-comments-test',
    scope,
  );
  assert.equal(comment2.replyToCommentId, comment1.id);
  assert.equal(comment2.replyTo?.authorName, '赵六');

  const list = loadWikiComments(docId, 'ws-comments-test', scope);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, comment1.id);
  assert.equal(list[1].id, comment2.id);
  assert.equal(list[1].replyTo?.content, '这篇文档对架构阐述很清晰！');

  const afterDelete = deleteWikiComment(docId, comment1.id, 'ws-comments-test', scope);
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].id, comment2.id);
});
