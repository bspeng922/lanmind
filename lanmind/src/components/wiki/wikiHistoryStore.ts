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
 *   - 版本号保证单调自增（v. 1, v. 2, ...）
 *   - 纯函数设计，不依赖组件实例，返回新数组避免状态污染
 *   - 确定性强，数据损坏或环境受限时安全回退为空列表
 */

import { scopedStorageKey, getWorkspaceContext, type WorkspaceContext } from '../../utils/workspaceContext';
import type { WikiDocument, WikiRevision } from './wikiTypes';

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

/** 为当前文档生成一条新的版本快照。版本号自增。 */
export function recordRevisionSnapshot(
  doc: WikiDocument,
  author: { id: string; name: string },
  comment?: string,
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): WikiRevision {
  const currentRevisions = loadWikiRevisions(doc.id, workspaceId, scope);
  const maxVersion = currentRevisions.reduce((max, r) => Math.max(max, r.version), 0);
  const nextVersion = Math.max(maxVersion + 1, (doc.version ?? 0) + 1, 1);

  const revision: WikiRevision = {
    id: `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    documentId: doc.id,
    version: nextVersion,
    title: doc.title,
    content: doc.content,
    authorId: author.id,
    authorName: author.name || '系统用户',
    comment: comment?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };

  const updated = [revision, ...currentRevisions];
  saveWikiRevisions(doc.id, updated, workspaceId, scope);
  return revision;
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
