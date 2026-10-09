import { localizeMessage } from '../i18n/messages';
import { currentLocale } from "../i18n/core";
import { tr, useLocale } from "../i18n";
import React from 'react';
import { CornerUpLeft, Loader2, MessageSquare, Quote, Send, Trash2, X } from 'lucide-react';
import { TaskComment, TaskCommentQuote, User } from '../types';
import { TaskMarkdown } from './TaskMarkdown';

interface TaskCommentsProps {
  comments: TaskComment[];
  users: User[];
  currentUserId?: string;
  loading?: boolean;
  error?: string;
  draft?: string;
  onDraftChange?: (draft: string) => void;
  saving?: boolean;
  onSubmit?: (replyToCommentId?: string) => Promise<boolean>;
  onDelete?: (comment: TaskComment) => Promise<void>;
}

export const TaskComments: React.FC<TaskCommentsProps> = ({ comments, users, currentUserId, loading, error, draft = '', onDraftChange, saving, onSubmit, onDelete }) => {
  useLocale();
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [replying, setReplying] = React.useState<TaskComment | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const commentRefs = React.useRef(new Map<string, HTMLLIElement>());
  const authorName = (id: string) => { const user = users.find((item) => item.id === id); return user?.nickname || user?.username || id; };
  const jumpToComment = (id: string) => {
    const node = commentRefs.current.get(id);
    if (!node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  const quoteContent = (quote: TaskCommentQuote) => <><span className="flex items-center gap-1.5 text-[11px] font-semibold text-sub"><Quote className="h-3 w-3 shrink-0" />{authorName(quote.authorId)}</span><span className="task-comment-quote-excerpt">{quote.content.replace(/\s+/g, ' ').slice(0, 240)}</span></>;
  const submit = async () => {
    if (!onSubmit || saving || !draft.trim()) return;
    if (await onSubmit(replying?.id)) setReplying(null);
  };
  const remove = async (comment: TaskComment) => {
    if (deleting || !onDelete) return;
    setDeleting(comment.id);
    try { await onDelete(comment); } finally { setDeleting(null); }
  };
  return <section className="task-comments border-t border-edge pt-4" aria-label={tr("tasks:taskComments.taskComment")}>
    <h4 className="mb-4 flex items-center gap-2 text-xs font-semibold text-main"><MessageSquare className="h-4 w-4 text-info" /><span>{tr("tasks:taskComments.comment")}</span><span className="rounded-full bg-card px-2 py-0.5 text-[10px] font-medium text-sub">{comments.length}</span></h4>
    {error && <p role="alert" className="mb-4 text-xs text-danger">{localizeMessage(error)}</p>}
    {loading ? <p role="status" className="flex items-center gap-2 py-4 text-xs text-quiet"><Loader2 className="h-3.5 w-3.5 animate-spin" />{tr("tasks:taskComments.loadingComments")}</p>
      : comments.length ? <ol className="task-comment-list">
          {comments.map((comment) => {
            const user = users.find((item) => item.id === comment.authorId);
            const name = authorName(comment.authorId);
            const own = comment.authorId === currentUserId;
            const date = new Date(comment.createdAt);
            const validDate = !Number.isNaN(date.getTime());
            const fullDate = validDate ? date.toLocaleString(currentLocale()) : tr("tasks:taskComments.unknownTime");
            return <li key={comment.id} data-comment-id={comment.id} tabIndex={-1} ref={(node: HTMLLIElement | null) => { if (node) commentRefs.current.set(comment.id, node); else commentRefs.current.delete(comment.id); }} className="task-comment-item">
              <span className="task-comment-avatar" aria-hidden="true">{user?.avatar?.startsWith('data:image') || user?.avatar?.startsWith('http') ? <img src={user.avatar} alt="" /> : user?.avatar || Array.from(name)[0] || '?'}</span>
              <div className="min-w-0 flex-1">
                <div className="task-comment-meta">
                  <span className="min-w-0 truncate text-xs font-semibold text-main" title={name}>{name}</span>
                  {own && <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-[10px] text-info">{tr("tasks:taskComments.me")}</span>}
                  <time className="text-[10px] text-quiet" dateTime={validDate ? date.toISOString() : undefined} title={fullDate}>{validDate ? date.toLocaleString(currentLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : fullDate}</time>
                  {onSubmit && onDraftChange && <button type="button" className="task-comment-reply" disabled={saving} aria-label={tr("tasks:taskComments.replyToSComment", { value0: name })} title={tr("tasks:taskComments.reply")} onClick={() => { setReplying(comment); inputRef.current?.focus(); }}><CornerUpLeft className="h-3.5 w-3.5" /></button>}
                  {own && onDelete && <button type="button" className="task-comment-delete" disabled={Boolean(deleting)} aria-label={tr("tasks:taskComments.deleteComment")} title={tr("tasks:taskComments.deleteComment")} onClick={() => void remove(comment)}>{deleting === comment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>}
                </div>
                <div className="task-comment-content">
                  {comment.replyTo && (comments.some((item) => item.id === comment.replyTo!.commentId)
                    ? <button type="button" className="task-comment-quote" aria-label={tr("tasks:taskComments.viewQuotedComment", { value0: authorName(comment.replyTo.authorId) })} title={tr("tasks:taskComments.viewOriginalComment")} onClick={() => jumpToComment(comment.replyTo!.commentId)}>{quoteContent(comment.replyTo)}</button>
                    : <blockquote className="task-comment-quote" aria-label={tr("tasks:taskComments.quotedComment")}>{quoteContent(comment.replyTo)}<span className="mt-1 block text-[10px] text-quiet">{tr("tasks:taskComments.originalCommentUnavailableQuotedContentIsPreserved")}</span></blockquote>)}
                  <TaskMarkdown value={comment.content} />
                </div>
              </div>
            </li>;
          })}
        </ol> : !error && <div className="task-comments-empty"><MessageSquare className="h-5 w-5 text-quiet" /><p>{tr("tasks:taskComments.noComments")}</p>{onSubmit && <span className="text-[11px] text-quiet">{tr("tasks:taskComments.recordProgressOrAddANote")}</span>}</div>}
    {onSubmit && onDraftChange && <div className="task-comment-composer">
      {replying && <div className="task-comment-reply-draft" aria-label={tr("tasks:taskComments.quotedComment2")}><div className="min-w-0 flex-1">{quoteContent({ commentId: replying.id, authorId: replying.authorId, content: replying.content })}</div><button type="button" className="project-toolbar-icon shrink-0" disabled={saving} aria-label={tr("tasks:taskComments.cancelReply")} title={tr("tasks:taskComments.cancelReply")} onClick={() => { setReplying(null); inputRef.current?.focus(); }}><X className="h-3.5 w-3.5" /></button></div>}
      <textarea ref={inputRef} aria-label={tr("tasks:taskComments.commentContent")} value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder={replying ? tr("tasks:taskComments.writeYourReply") : tr("tasks:taskComments.addAComment")} rows={3} disabled={saving} />
      <div className="flex items-center justify-between gap-3 border-t border-edge px-3 py-2">
        <span className="text-[10px] text-quiet">{tr("tasks:taskComments.markdownSupported")}</span>
        <button type="button" disabled={!draft.trim() || saving || loading} onClick={() => void submit()} className="theme-btn-primary inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[11px] disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}{saving ? tr("tasks:taskComments.sending") : replying ? tr("tasks:taskComments.sendReply") : tr("tasks:taskComments.postComment")}</button>
      </div>
    </div>}
  </section>;
};
