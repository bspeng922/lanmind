/**
 * wikiCommentStore — 知识库页面协同评论持久化管理。
 *
 * CALLING SPEC:
 *   const comments = loadWikiComments(docId, workspaceId, scope);
 *   const newComment = addWikiComment(docId, data, workspaceId, scope);
 *   const remaining = deleteWikiComment(docId, commentId, workspaceId, scope);
 *
 * TOOL CONTRACT:
 *   - 评论按文档 ID 分组存储，与工作区完全隔离
 *   - 纯函数设计，数据损坏时优雅回退为空数组
 */

import { scopedStorageKey, getWorkspaceContext, type WorkspaceContext } from '../../utils/workspaceContext';
import type { WikiComment } from './wikiTypes';

export function getWikiCommentsKey(
  docId: string,
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): string {
  const wsScope = workspaceId
    ? { workspaceId, userId: scope?.userId ?? 'uninitialized', revision: scope?.revision ?? 0 }
    : scope;
  return scopedStorageKey(`wiki-comments:${docId}`, wsScope);
}

/** 读取某篇文档的全部评论，按时间正序排列（最早在前）。 */
export function loadWikiComments(
  docId: string,
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): WikiComment[] {
  try {
    const key = getWikiCommentsKey(docId, workspaceId, scope);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is WikiComment => Boolean(item && typeof item === 'object' && item.id && item.documentId))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  } catch {
    return [];
  }
}

/** 写入评论列表。 */
export function saveWikiComments(
  docId: string,
  comments: WikiComment[],
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): boolean {
  try {
    const key = getWikiCommentsKey(docId, workspaceId, scope);
    localStorage.setItem(key, JSON.stringify(comments));
    return true;
  } catch {
    return false;
  }
}

/** 为文档新增一条协同评论。 */
export function addWikiComment(
  docId: string,
  data: {
    authorId: string;
    authorName: string;
    authorAvatar?: string;
    content: string;
    replyToCommentId?: string;
    replyTo?: import('./wikiTypes').WikiCommentQuote | null;
  },
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): WikiComment {
  const current = loadWikiComments(docId, workspaceId, scope);
  const comment: WikiComment = {
    id: `wcmt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    documentId: docId,
    authorId: data.authorId,
    authorName: data.authorName || '系统用户',
    authorAvatar: data.authorAvatar,
    content: data.content,
    replyToCommentId: data.replyToCommentId || data.replyTo?.commentId,
    replyTo: data.replyTo ?? null,
    createdAt: new Date().toISOString(),
  };

  const updated = [...current, comment];
  saveWikiComments(docId, updated, workspaceId, scope);
  return comment;
}

/** 删除指定的评论。 */
export function deleteWikiComment(
  docId: string,
  commentId: string,
  workspaceId?: string | null,
  scope: WorkspaceContext = getWorkspaceContext(),
): WikiComment[] {
  const current = loadWikiComments(docId, workspaceId, scope);
  const remaining = current.filter((c) => c.id !== commentId);
  saveWikiComments(docId, remaining, workspaceId, scope);
  return remaining;
}
