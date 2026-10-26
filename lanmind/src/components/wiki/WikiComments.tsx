/**
 * WikiComments — 知识库页面协同讨论评论区。
 *
 * CALLING SPEC:
 *   <WikiComments
 *     docId={doc.id}
 *     currentUser={currentUser}
 *     workspaceId={workspaceId}
 *   />
 *
 * TOOL CONTRACT:
 *   - 右下角入口打开非模态讨论浮层，关闭时保留当前草稿和引用
 *   - 支持删除个人发言
 *   - 纯受控本地与工作区隔离存储
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MessageSquare,
  Send,
  Trash2,
  User as UserIcon,
  CornerUpLeft,
  Quote,
  X,
} from 'lucide-react';
import type { User } from '../../types';
import type { WikiComment } from './wikiTypes';
import { loadWikiComments, addWikiComment, deleteWikiComment } from './wikiCommentStore';
import { tr, useLocale } from '../../i18n';
import './wiki-discussion.css';

interface WikiCommentsProps {
  docId: string;
  currentUser?: User;
  workspaceId?: string | null;
  suspended?: boolean;
}

export const WikiComments: React.FC<WikiCommentsProps> = ({
  docId,
  currentUser,
  workspaceId,
  suspended = false,
}) => {
  const { locale } = useLocale();
  const [comments, setComments] = useState<WikiComment[]>(() => loadWikiComments(docId, workspaceId));
  const [draft, setDraft] = useState('');
  const [replying, setReplying] = useState<WikiComment | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [menuTheme, setMenuTheme] = useState<string>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const calcPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const mobile = window.innerWidth < 640;
    const width = Math.min(400, window.innerWidth - 24);
    const bottom = mobile ? window.innerHeight - 12 : rect.top - 12;
    const height = Math.min(560, bottom - 12, window.innerHeight * (mobile ? 0.75 : 0.85));
    return { top: bottom - height, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), width, height };
  }, []);

  const closePanel = useCallback((restoreFocus = true) => {
    setIsOpen(false);
    setMenuPos(null);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const togglePanel = () => {
    if (isOpen) return closePanel();
    const position = calcPosition();
    if (!position) return;
    setMenuPos(position);
    setMenuTheme(triggerRef.current?.closest<HTMLElement>('[data-theme]')?.dataset.theme);
    setIsOpen(true);
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    const update = () => setMenuPos(calcPosition());
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen, calcPosition]);

  useEffect(() => {
    if (suspended) closePanel(false);
  }, [suspended, closePanel]);

  useEffect(() => {
    if (!isOpen) return;
    textareaRef.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        closePanel();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [isOpen, closePanel]);

  useEffect(() => {
    const list = loadWikiComments(docId, workspaceId);
    setComments(list);
  }, [docId, workspaceId]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = draft.trim();
    if (!content || submitting) return;

    setSubmitting(true);
    const authorName =
      currentUser?.nickname || currentUser?.username || tr('wiki:comments.currentUser');
    const authorId = currentUser?.id || 'me';

    const newComment = addWikiComment(
      docId,
      {
        authorId,
        authorName,
        authorAvatar: currentUser?.avatar,
        content,
        replyTo: replying
          ? {
              commentId: replying.id,
              authorId: replying.authorId,
              authorName: replying.authorName,
              content: replying.content,
            }
          : null,
      },
      workspaceId,
    );

    setComments((prev) => [...prev, newComment]);
    setDraft('');
    setReplying(null);
    setSubmitting(false);
  };

  const handleDelete = (commentId: string) => {
    const remaining = deleteWikiComment(docId, commentId, workspaceId);
    setComments(remaining);
    if (replying?.id === commentId) {
      setReplying(null);
    }
  };

  return <>
    <button ref={triggerRef} type="button" hidden={suspended} onClick={togglePanel}
      aria-label={tr('wiki:comments.open', { count: comments.length })}
      title={tr('wiki:comments.title')} aria-expanded={isOpen} aria-controls={panelId} aria-haspopup="dialog"
      className="wiki-discussion-trigger absolute bottom-16 right-4 z-40 flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-edge bg-surface px-3 text-accent shadow-popover transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent">
      <MessageSquare className="h-5 w-5" aria-hidden="true" />
      {comments.length > 0 && <span className="text-xs font-semibold">{comments.length}</span>}
    </button>
    {isOpen && menuPos && createPortal(
    <section id={panelId} role="dialog" aria-modal="false" aria-labelledby={`${panelId}-title`} data-theme={menuTheme}
      style={{ position: 'fixed', ...menuPos, zIndex: 45, transition: 'none' }}
      className="wiki-discussion-panel origin-bottom-right flex min-h-0 flex-col overflow-hidden rounded-2xl border border-edge bg-surface text-main shadow-popover select-text">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <h2 id={`${panelId}-title`} className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="h-4 w-4 text-accent" aria-hidden="true" />
          {tr('wiki:comments.title')}
          <span className="rounded-full bg-input px-2 py-0.5 text-xs text-sub">{comments.length}</span>
        </h2>
        <button type="button" onClick={() => closePanel()} aria-label={tr('wiki:comments.close')}
          className="rounded-md p-1.5 text-sub hover:bg-hover hover:text-main"><X className="h-4 w-4" /></button>
      </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 评论输入框 */}
          <form onSubmit={handleSubmit} className="order-2 flex shrink-0 flex-col gap-2 border-t border-edge p-3">
            <div className="relative rounded-xl border border-edge bg-surface shadow-2xs focus-within:border-accent/60 transition-colors overflow-hidden">
              {/* 引用回复提示条 */}
              {replying && (
                <div className="flex items-center justify-between gap-2 border-b border-edge/60 bg-accent/5 px-3 py-1.5 text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Quote className="h-3 w-3 shrink-0 text-accent" />
                    <span className="font-semibold text-main shrink-0">{replying.authorName}:</span>
                    <span className="truncate text-quiet text-[11px]">{replying.content.replace(/\s+/g, ' ')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setReplying(null);
                      textareaRef.current?.focus();
                    }}
                    className="text-quiet hover:text-main p-0.5 rounded transition-colors"
                    title={tr('wiki:comments.cancelReply')}
                    aria-label={tr('wiki:comments.cancelReply')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (!e.nativeEvent.isComposing && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                rows={2}
                aria-label={tr('wiki:comments.draft')}
                placeholder={replying ? tr('wiki:comments.replyPlaceholder', { name: replying.authorName }) : tr('wiki:comments.placeholder')}
                className="w-full resize-none bg-transparent p-3 text-xs text-main placeholder:text-placeholder outline-none"
              />
              <div className="flex items-center justify-between border-t border-edge/40 px-3 py-2 bg-canvas/40">
                <span className="text-[11px] text-quiet">
                  {replying ? tr('wiki:comments.replying', { name: replying.authorName }) : tr('wiki:comments.hint')}
                </span>
                <button
                  type="submit"
                  disabled={!draft.trim() || submitting}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-all hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
                >
                  <Send className="h-3 w-3" />
                  <span>{tr(replying ? 'wiki:comments.reply' : 'wiki:comments.publish')}</span>
                </button>
              </div>
            </div>
          </form>

          {/* 评论列表 */}
          {comments.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-xs text-quiet">
              {tr('wiki:comments.empty')}
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3">
              {comments.map((comment) => {
                const isOwn =
                  comment.authorId === (currentUser?.id || 'me') ||
                  comment.authorId === 'me';
                const date = new Date(comment.createdAt);
                const timeText = Number.isNaN(date.getTime())
                  ? comment.createdAt
                  : date.toLocaleString(locale);

                return (
                  <div
                    key={comment.id}
                    className="flex items-start gap-3 rounded-xl border border-edge/60 bg-surface/70 p-3.5 transition-colors hover:bg-surface"
                  >
                    {/* 头像 */}
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent text-xs font-bold overflow-hidden">
                      {comment.authorAvatar?.startsWith('data:image') ||
                      comment.authorAvatar?.startsWith('http') ? (
                        <img
                          src={comment.authorAvatar}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        comment.authorName[0]?.toUpperCase() || <UserIcon className="h-3.5 w-3.5" />
                      )}
                    </div>

                    {/* 正文 */}
                    <div className="flex-1 min-w-0">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-main truncate">
                          {comment.authorName}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-quiet whitespace-nowrap">
                            {timeText}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setReplying(comment);
                              textareaRef.current?.focus();
                            }}
                            title={tr('wiki:comments.quote', { name: comment.authorName })}
                            aria-label={tr('wiki:comments.quote', { name: comment.authorName })}
                            className="text-quiet hover:text-accent p-0.5 rounded transition-colors"
                          >
                            <CornerUpLeft className="h-3 w-3" />
                          </button>
                          {isOwn && (
                            <button
                              type="button"
                              onClick={() => handleDelete(comment.id)}
                              title={tr('wiki:comments.delete')}
                              aria-label={tr('wiki:comments.delete')}
                              className="text-quiet hover:text-danger p-0.5 rounded transition-colors"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 引用内容卡片 */}
                      {comment.replyTo && (
                        <div className="mb-2 rounded-lg border-l-2 border-accent bg-card/80 p-2 text-[11px] text-quiet">
                          <div className="flex items-center gap-1 font-semibold text-sub mb-0.5">
                            <Quote className="h-2.5 w-2.5 text-accent" />
                            <span>{comment.replyTo.authorName}</span>
                          </div>
                          <div className="text-sub/80 line-clamp-2 whitespace-pre-wrap">
                            {comment.replyTo.content}
                          </div>
                        </div>
                      )}

                      <p className="text-xs text-sub leading-relaxed whitespace-pre-wrap break-words">
                        {comment.content}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </section>
    , document.body)}
  </>;
};
