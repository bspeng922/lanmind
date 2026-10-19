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
 *   - 页面底部轻量级协作交流，支持多轮讨论与上下文沉淀
 *   - 支持删除个人发言
 *   - 纯受控本地与工作区隔离存储
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  MessageSquare,
  Send,
  Trash2,
  ChevronDown,
  ChevronUp,
  User as UserIcon,
  CornerUpLeft,
  Quote,
  X,
} from 'lucide-react';
import type { User } from '../../types';
import type { WikiComment } from './wikiTypes';
import { loadWikiComments, addWikiComment, deleteWikiComment } from './wikiCommentStore';
import { formatRelativeTime, tr, useLocale } from '../../i18n';

interface WikiCommentsProps {
  docId: string;
  currentUser?: User;
  workspaceId?: string | null;
}

export const WikiComments: React.FC<WikiCommentsProps> = ({
  docId,
  currentUser,
  workspaceId,
}) => {
  const { locale } = useLocale();
  const [comments, setComments] = useState<WikiComment[]>([]);
  const [draft, setDraft] = useState('');
  const [replying, setReplying] = useState<WikiComment | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      currentUser?.nickname || currentUser?.username || '当前用户';
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

  return (
    <section
      aria-label="页面讨论"
      className="mt-12 rounded-2xl border border-edge bg-card/60 p-5 shadow-2xs backdrop-blur-xs select-text"
    >
      {/* 头部标题与收起/展开 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-2 text-sm font-bold text-main hover:text-accent transition-colors cursor-pointer"
        >
          <MessageSquare className="h-4 w-4 text-info" />
          <span>协同讨论</span>
          <span className="rounded-full bg-input px-2 py-0.5 text-xs font-semibold text-sub">
            {comments.length}
          </span>
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-quiet" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-quiet" />
          )}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* 评论输入框 */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
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
                    title="取消回复"
                    aria-label="取消回复"
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
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                rows={2}
                placeholder={replying ? `回复 ${replying.authorName}... (Ctrl+Enter 发送)` : "参与文档协同探讨，提出修改意见或疑问... (Ctrl+Enter 发送)"}
                className="w-full resize-none bg-transparent p-3 text-xs text-main placeholder:text-placeholder outline-none"
              />
              <div className="flex items-center justify-between border-t border-edge/40 px-3 py-2 bg-canvas/40">
                <span className="text-[11px] text-quiet">
                  {replying ? `正在引用 ${replying.authorName} 的评论` : '支持即时交流与引用回复'}
                </span>
                <button
                  type="submit"
                  disabled={!draft.trim() || submitting}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent transition-all hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
                >
                  <Send className="h-3 w-3" />
                  <span>{replying ? '回复' : '发布'}</span>
                </button>
              </div>
            </div>
          </form>

          {/* 评论列表 */}
          {comments.length === 0 ? (
            <div className="py-6 text-center text-xs text-quiet">
              暂无讨论留言，留下您的第一条想法或反馈吧
            </div>
          ) : (
            <div className="space-y-3 pt-2">
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
                      <div className="flex items-center justify-between gap-2 mb-1">
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
                            title={`引用 ${comment.authorName} 的评论`}
                            aria-label={`引用 ${comment.authorName} 的评论`}
                            className="text-quiet hover:text-accent p-0.5 rounded transition-colors"
                          >
                            <CornerUpLeft className="h-3 w-3" />
                          </button>
                          {isOwn && (
                            <button
                              type="button"
                              onClick={() => handleDelete(comment.id)}
                              title="删除评论"
                              aria-label="删除评论"
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
      )}
    </section>
  );
};
