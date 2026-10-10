/**
 * TaskActivityModal — Displays the chronological activity history of a task.
 *
 * CALLING SPEC:
 *   <TaskActivityModal
 *     task={task}
 *     currentUser={currentUser}
 *     users={users}
 *     onClose={() => void}
 *   />
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  History,
  LoaderCircle,
  RefreshCw,
  X,
  Plus,
  Edit2,
  Trash2,
  MessageSquare,
  Clock,
  Sparkles,
} from 'lucide-react';
import { Task, TaskActivity, User, PageRequest } from '../types';
import { ApiService } from '../services/api';
import { LOG_PAGE_SIZE, usePagedRecords } from '../hooks/usePagedRecords';
import { RecordPagination } from './RecordPagination';
import { currentLocale } from '../i18n/core';
import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from '../i18n';

const FIELD_LABELS: Record<string, string> = {
  get title() { return tr('tasks:taskActivityModal.name'); },
  get description() { return tr('tasks:taskActivityModal.content'); },
  get priority() { return tr('tasks:taskActivityModal.priority'); },
  get status() { return tr('tasks:taskActivityModal.status'); },
  get progress() { return tr('tasks:taskActivityModal.progress'); },
  get startDate() { return tr('tasks:taskActivityModal.startDate'); },
  get dueDate() { return tr('tasks:taskActivityModal.dueDate'); },
  get assigneeId() { return tr('tasks:taskActivityModal.assignee'); },
  get projectId() { return tr('tasks:taskActivityModal.project'); },
  get parentTaskId() { return tr('tasks:taskActivityModal.parentTask'); },
  get tags() { return tr('tasks:taskActivityModal.tags'); },
  get subtasks() { return tr('tasks:taskActivityModal.checklist'); },
  get recurrence() { return tr('tasks:taskActivityModal.recurring'); },
  get reminderTime() { return tr('tasks:taskActivityModal.reminder'); },
  get isShared() { return tr('tasks:taskActivityModal.sharing'); },
};

const ACTION_LABELS: Record<string, string> = {
  get create() { return tr('tasks:taskActivityModal.create'); },
  get update() { return tr('tasks:taskActivityModal.update'); },
  get delete() { return tr('tasks:taskActivityModal.delete'); },
};

interface TaskActivityModalProps {
  task: Task;
  currentUser: User;
  users: User[];
  onClose: () => void;
}

export const TaskActivityModal: React.FC<TaskActivityModalProps> = (props) => (
  <TaskActivityDialog key={`${props.task.id}:${props.currentUser.id}`} {...props} />
);

const TaskActivityDialog: React.FC<TaskActivityModalProps> = ({
  task,
  currentUser,
  users,
  onClose,
}) => {
  useLocale();
  const loadPage = useCallback(
    (request: PageRequest) => ApiService.getTaskActivityPage(task.id, currentUser.id, request),
    [task.id, currentUser.id]
  );
  const { data, page, loading, error, goToPage, refresh, retry } = usePagedRecords<TaskActivity>(loadPage);
  const items = data?.items || [];
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [data]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const getActivityNodeStyle = (action: string, isComment: boolean) => {
    if (isComment) {
      return {
        icon: <MessageSquare className="h-3.5 w-3.5 text-violet-500" />,
        badgeBg: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
        ringBg: 'bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800/60',
      };
    }
    switch (action) {
      case 'create':
        return {
          icon: <Plus className="h-3.5 w-3.5 text-emerald-500" />,
          badgeBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
          ringBg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60',
        };
      case 'delete':
        return {
          icon: <Trash2 className="h-3.5 w-3.5 text-rose-500" />,
          badgeBg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
          ringBg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60',
        };
      case 'update':
      default:
        return {
          icon: <Edit2 className="h-3.5 w-3.5 text-sky-500" />,
          badgeBg: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
          ringBg: 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800/60',
        };
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={tr('tasks:taskActivityModal.taskActivity')}
    >
      <section className="record-history-dialog flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface text-main shadow-popover">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-edge/80 px-6 py-4 bg-surface/80 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info border border-info/20 shadow-xs">
              <History className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-main tracking-tight">
                  {tr('tasks:taskActivityModal.taskActivity')}
                </h2>
                {typeof data?.total === 'number' && (
                  <span className="inline-flex items-center rounded-full bg-surface-hover border border-edge px-2 py-0.5 text-[10px] font-medium text-sub">
                    {tr('tasks:taskActivityModal.totalRecords', { count: data.total })}
                  </span>
                )}
              </div>
              <p className="mt-0.5 truncate text-xs text-sub/80" title={task.title}>
                {task.title}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main disabled:opacity-50"
              title={tr('tasks:taskActivityModal.refreshTaskActivity')}
              aria-label={tr('tasks:taskActivityModal.refreshTaskActivity')}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sub transition-colors hover:bg-hover hover:text-main"
              title={tr('tasks:taskActivityModal.closeTaskActivity')}
              aria-label={tr('tasks:taskActivityModal.closeTaskActivity')}
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>
        </header>

        {/* Content Body */}
        <div ref={bodyRef} aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div
              role="status"
              aria-label={tr('tasks:taskActivityModal.loadTaskActivity')}
              className="flex flex-col items-center justify-center py-16 text-sub"
            >
              <LoaderCircle className="h-7 w-7 animate-spin text-info" />
              <span className="mt-3 text-xs text-quiet font-medium">
                {tr('tasks:taskActivityModal.loadTaskActivity')}...
              </span>
            </div>
          ) : error ? (
            <div role="alert" className="py-12 text-center text-xs text-danger">
              <p>{localizeMessage(error)}</p>
              <button
                type="button"
                onClick={retry}
                className="mx-auto mt-4 flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 font-medium text-main shadow-xs transition-colors hover:bg-hover"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {tr('tasks:taskActivityModal.retry')}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-hover border border-edge text-quiet">
                <History className="h-6 w-6" />
              </div>
              <p className="mt-3 text-xs font-medium text-quiet">
                {tr('tasks:taskActivityModal.noActivity')}
              </p>
            </div>
          ) : (
            <ol className="relative ml-3 space-y-6 border-l border-edge/80 pl-6 pb-2">
              {items.map((item) => {
                const isComment = 'taskId' in item.payload && 'content' in item.payload;
                const actorUser = users.find((user) => user.id === item.actorId);
                const actorName = actorUser?.nickname || item.actorId;
                const fields = Object.keys(item.payload)
                  .filter((key) => key in FIELD_LABELS)
                  .map((key) => FIELD_LABELS[key]);
                const style = getActivityNodeStyle(item.action, isComment);

                return (
                  <li key={item.id} className="relative group">
                    {/* Timeline Node Icon */}
                    <div
                      className={`absolute -left-[35px] top-0.5 flex h-7 w-7 items-center justify-center rounded-full border shadow-xs transition-transform group-hover:scale-110 ${style.ringBg}`}
                    >
                      {style.icon}
                    </div>

                    {/* Timeline Content */}
                    <div className="min-w-0">
                      {/* Actor & Action Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-card border border-edge text-[10px] font-bold text-main shrink-0">
                            {actorName.charAt(0)}
                          </span>
                          <span className="text-xs font-semibold text-main">{actorName}</span>
                          <span
                            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${style.badgeBg}`}
                          >
                            {isComment
                              ? tr('tasks:taskActivityModal.comment')
                              : ACTION_LABELS[item.action] || item.action}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-quiet font-mono">
                          <Clock className="h-3 w-3 shrink-0" />
                          <time>{new Date(item.timestamp).toLocaleString(currentLocale())}</time>
                        </div>
                      </div>

                      {/* Detail: Updates */}
                      {item.action === 'update' && fields.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-edge/70 bg-surface/50 p-2.5">
                          <span className="text-[11px] text-quiet font-medium">
                            {tr('tasks:taskActivityModal.changedFields')}:
                          </span>
                          {fields.map((f, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center rounded bg-card border border-edge px-2 py-0.5 text-[11px] font-medium text-sub shadow-2xs"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Detail: Initial creation */}
                      {item.action === 'create' && !isComment && (
                        <div className="mt-2 inline-flex items-center gap-1 text-xs text-sub/90">
                          <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                          <span>{tr('tasks:taskActivityModal.createdTask')}</span>
                        </div>
                      )}

                      {/* Detail: Comment content */}
                      {isComment && typeof item.payload.content === 'string' && (
                        <div className="mt-2.5 rounded-xl border border-edge/80 bg-card/60 p-3 text-xs leading-relaxed text-main shadow-2xs whitespace-pre-wrap break-words">
                          {item.payload.content}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* Footer */}
        <footer className="shrink-0 border-t border-edge/80 px-6 py-3.5 bg-surface/80">
          <RecordPagination
            page={page}
            pageSize={data?.pageSize || LOG_PAGE_SIZE}
            total={data?.total || 0}
            loading={loading}
            onPageChange={goToPage}
          />
        </footer>
      </section>
    </div>
  );
};
