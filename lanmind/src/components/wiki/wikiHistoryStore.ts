/**
 * wikiHistoryStore — 页面历史修改记录持久化与快照管理。
 *
 * CALLING SPEC:
 *   const revisions = loadWikiRevisions(docId, workspaceId, scope);
 *   const snapshot = recordRevisionSnapshot(doc, author, comment, workspaceId, scope);
 *   const remaining = deleteWikiRevision(docId, revisionId, workspaceId, scope);
 *
 * TOOL CONTRACT:
 *   - 历史记录按文档 ID 分组存储在用户与工作区专属命名空间内
 *   - 历史序号单调自增，与后台用于并发控制的文档版本号独立
 *   - 纯函数设计，不依赖组件实例，返回新数组避免状态污染
 *   - 确定性强，数据损坏或环境受限时安全回退为空列表
 */

import { scopedStorageKey, getWorkspaceContext, type WorkspaceContext } from '../../utils/workspaceContext';
import type { WikiDocument, WikiRevision } from './wikiTypes';

type RevisionAuthor = { id: string; name: string };
type WikiContent = Pick<WikiDocument, 'title' | 'content'>;
const sameContent = (a: WikiContent, b: WikiContent) => a.title === b.title && a.content === b.content;

export function getWikiRevisionsKey(
  docId: string,
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): string {
  const wsScope = workspaceId
    ? { workspaceId, userId: scope?.userId ?? 'uninitialized', revision: scope?.revision ?? 0 }
    : scope;
  return scopedStorageKey(`wiki-revisions:${docId}`, wsScope);
}

/** 读取某篇文档的全部历史修改版本列表，按版本号倒序排列（最新在前）。 */
export function loadWikiRevisions(
  docId: string,
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): WikiRevision[] {
  try {
    const key = getWikiRevisionsKey(docId, workspaceId, scope);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is WikiRevision => Boolean(item && typeof item === 'object' && item.id && item.documentId))
      .sort((a, b) => b.version - a.version);
  } catch {
    return [];
  }
}

/** 写入或覆盖某篇文档的历史版本列表。 */
export function saveWikiRevisions(
  docId: string,
  revisions: WikiRevision[],
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): boolean {
  try {
    const key = getWikiRevisionsKey(docId, workspaceId, scope);
    localStorage.setItem(key, JSON.stringify(revisions));
    return true;
  } catch {
    return false;
  }
}

/** 记录不可变的正文快照；连续相同的内容复用已有记录。 */
export function recordRevisionSnapshot(
  doc: WikiDocument,
  author: RevisionAuthor,
  comment?: string,
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): WikiRevision {
  const currentRevisions = loadWikiRevisions(doc.id, workspaceId, scope);
  if (currentRevisions[0] && sameContent(currentRevisions[0], doc)) return currentRevisions[0];
  const maxVersion = currentRevisions.reduce((max, r) => Math.max(max, r.version), 0);
  const nextVersion = maxVersion + 1;

  const revision: WikiRevision = {
    id: `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    documentId: doc.id,
    version: nextVersion,
    title: doc.title,
    content: doc.content,
    authorId: author.id,
    authorName: author.name || '系统用户',
    comment: comment?.trim() || undefined,
    createdAt: doc.updatedAt || new Date().toISOString(),
  };

  const updated = [revision, ...currentRevisions];
  saveWikiRevisions(doc.id, updated, workspaceId, scope);
  return revision;
}

/** 同时保留修改前后的正文，覆盖首次保存、自动保存和旧数据尚未记录快照的情况。 */
export function recordWikiDocumentChange(
  before: WikiDocument,
  after: WikiDocument,
  author: RevisionAuthor,
  comment?: string,
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): void {
  if (sameContent(before, after)) return;
  recordRevisionSnapshot(before, {
    id: before.updatedBy || before.createdBy || author.id,
    name: before.updatedByName || before.createdByName || author.name,
  }, '保存前的文档', workspaceId, scope);
  recordRevisionSnapshot(after, author, comment, workspaceId, scope);
}

/** 最新快照与当前正文相同时合并展示；其他快照均保留，包括恢复前的草稿备份。 */
export function buildWikiHistoryItems(
  doc: WikiDocument,
  revisions: WikiRevision[],
  fallbackAuthor: RevisionAuthor,
): WikiRevision[] {
  const latest = revisions[0];
  const currentSnapshot = latest && sameContent(latest, doc) ? latest : undefined;
  const current: WikiRevision = {
    id: '__current__',
    documentId: doc.id,
    version: currentSnapshot?.version ?? (latest?.version ?? 0) + 1,
    title: doc.title,
    content: doc.content,
    authorId: doc.updatedBy || doc.createdBy || currentSnapshot?.authorId || fallbackAuthor.id,
    authorName: doc.updatedByName || doc.createdByName || currentSnapshot?.authorName || fallbackAuthor.name,
    comment: '当前正文版本',
    createdAt: doc.updatedAt,
  };
  return [current, ...revisions.filter(revision => revision.id !== currentSnapshot?.id)];
}

/** 删除指定的历史版本记录。 */
export function deleteWikiRevision(
  docId: string,
  revisionId: string,
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): WikiRevision[] {
  const current = loadWikiRevisions(docId, workspaceId, scope);
  const remaining = current.filter((r) => r.id !== revisionId);
  saveWikiRevisions(docId, remaining, workspaceId, scope);
  return remaining;
}
