/**
 * TaskActivityTimeline — Inline chronological activity history and audit timeline for a task.
 *
 * CALLING SPEC:
 *   <TaskActivityTimeline
 *     task={task}
 *     currentUser={currentUser}
 *     users={users}
 *     states={states}
 *     onCountChange={(count) => void}
 *     showHeader={true}
 *     className="mt-2"
 *   />
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  History,
  LoaderCircle,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  MessageSquare,
  Clock,
  Sparkles,
} from 'lucide-react';
import { StateGroup, Task, TaskActivity, User, PageRequest, WorkItemState } from '../../types';
import { ApiService } from '../../services/api';
import { LOG_PAGE_SIZE, usePagedRecords } from '../../hooks/usePagedRecords';
import { RecordPagination } from '../RecordPagination';
import { currentLocale } from '../../i18n/core';
import { localizeMessage } from '../../i18n/messages';
import { tr, useLocale } from '../../i18n';
import { BLOCKED_STATE_NAME, legacyStatusToGroup } from '../../utils/workItemState';

const GROUP_LABEL_KEY: Record<StateGroup, string> = {
  backlog: 'tasks:stateGroup.backlog',
  unstarted: 'tasks:stateGroup.unstarted',
  started: 'tasks:stateGroup.started',
  completed: 'tasks:stateGroup.completed',
  cancelled: 'tasks:stateGroup.cancelled',
};

const BLOCKED_LABEL_KEY = 'tasks:stateGroup.blocked';

const resolveRecordedStateName = (value: unknown, states: WorkItemState[]): string => {
  if (typeof value !== 'string' || !value) return '';
  const state = states.find((item) => item.id === value);
  if (state) return state.name;
  if (value === BLOCKED_STATE_NAME) return tr(BLOCKED_LABEL_KEY);
  return tr(GROUP_LABEL_KEY[legacyStatusToGroup(value)]);
};

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

const getActivityNodeStyle = (action: string, isComment: boolean) => {
  if (isComment) {
    return {
      icon: <MessageSquare className="h-3.5 w-3.5 text-feature" />,
      badgeBg: 'bg-feature/10 text-feature border-feature/20',
      ringBg: 'bg-feature/10 border-feature/30',
    };
  }
  switch (action) {
    case 'create':
      return {
        icon: <Plus className="h-3.5 w-3.5 text-success" />,
        badgeBg: 'bg-success/10 text-success border-success/20',
        ringBg: 'bg-success/10 border-success/30',
      };
    case 'delete':
      return {
        icon: <Trash2 className="h-3.5 w-3.5 text-danger" />,
        badgeBg: 'bg-danger/10 text-danger border-danger/20',
        ringBg: 'bg-danger/10 border-danger/30',
      };
    case 'update':
    default:
      return {
        icon: <Edit2 className="h-3.5 w-3.5 text-info" />,
        badgeBg: 'bg-info/10 text-info border-info/20',
        ringBg: 'bg-info/10 border-info/30',
      };
  }
};

export interface TaskActivityTimelineProps {
  task: Pick<Task, 'id' | 'title'>;
  currentUser: User;
  users: User[];
  states?: WorkItemState[];
  showHeader?: boolean;
  onCountChange?: (count: number) => void;
  className?: string;
}

export const TaskActivityTimeline: React.FC<TaskActivityTimelineProps> = ({
  task,
  currentUser,
  users,
  states = [],
  showHeader = true,
  onCountChange,
  className = '',
}) => {
  useLocale();
  const loadPage = useCallback(
    (request: PageRequest) => ApiService.getTaskActivityPage(task.id, currentUser.id, request),
    [task.id, currentUser.id]
  );
  const { data, page, loading, error, goToPage, refresh, retry } = usePagedRecords<TaskActivity>(loadPage);
  const items = data?.items || [];
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof data?.total === 'number') {
      onCountChange?.(data.total);
    }
  }, [data?.total, onCountChange]);

  return (
    <div ref={containerRef} className={`task-activity-timeline flex flex-col ${className}`}>
      {showHeader && (
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-edge/40">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-main">
              {tr('tasks:taskActivityModal.taskActivity')}
            </span>
            {typeof data?.total === 'number' && (
              <span className="inline-flex items-center rounded-full bg-surface-hover border border-edge px-2 py-0.2 text-[10px] font-medium text-sub">
                {tr('tasks:taskActivityModal.totalRecords', { count: data.total })}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex h-7 w-7 items-center justify-center rounded-md text-sub transition-colors hover:bg-hover hover:text-main disabled:opacity-50"
            title={tr('tasks:taskActivityModal.refreshTaskActivity')}
            aria-label={tr('tasks:taskActivityModal.refreshTaskActivity')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      )}

      {loading ? (
        <div
          role="status"
          aria-label={tr('tasks:taskActivityModal.loadTaskActivity')}
          className="flex flex-col items-center justify-center py-10 text-sub"
        >
          <LoaderCircle className="h-6 w-6 animate-spin text-info" />
          <span className="mt-2.5 text-xs text-quiet font-medium">
            {tr('tasks:taskActivityModal.loadTaskActivity')}...
          </span>
        </div>
      ) : error ? (
        <div role="alert" className="py-8 text-center text-xs text-danger">
          <p>{localizeMessage(error)}</p>
          <button
            type="button"
            onClick={retry}
            className="mx-auto mt-3 flex items-center gap-1.5 rounded-lg border border-edge bg-surface px-3 py-1.5 font-medium text-main shadow-xs transition-colors hover:bg-hover"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {tr('tasks:taskActivityModal.retry')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center rounded-lg border border-dashed border-edge/60 bg-canvas/30">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-hover border border-edge text-quiet">
            <History className="h-5 w-5" />
          </div>
          <p className="mt-2.5 text-xs font-medium text-quiet">
            {tr('tasks:taskActivityModal.noActivity')}
          </p>
        </div>
      ) : (
        <ol className="relative ml-3 space-y-5 border-l border-edge/80 pl-5 pb-2">
          {items.map((item) => {
            const isComment = 'taskId' in item.payload && 'content' in item.payload;
            const actorUser = users.find((user) => user.id === item.actorId);
            const actorName = actorUser?.nickname || item.actorId;
            const fields = Object.keys(item.payload)
              .filter((key) => key in FIELD_LABELS)
              .map((key) => FIELD_LABELS[key]);
            const style = getActivityNodeStyle(item.action, isComment);
            const transition = item.payload._statusTransition as { from?: unknown; to?: unknown } | undefined;
            const transitionFrom = transition ? resolveRecordedStateName(transition.from, states) : '';
            const transitionTo = transition ? resolveRecordedStateName(transition.to, states) : '';

            return (
              <li key={item.id} className="relative group">
                {/* Timeline Node Icon */}
                <div
                  className={`absolute -left-[31px] top-0.5 flex h-6 w-6 items-center justify-center rounded-full border shadow-xs transition-transform group-hover:scale-110 ${style.ringBg}`}
                >
                  {style.icon}
                </div>

                {/* Timeline Content */}
                <div className="min-w-0">
                  {/* Actor & Action Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-card border border-edge text-[9px] font-bold text-main shrink-0">
                        {actorName.charAt(0)}
                      </span>
                      <span className="text-xs font-semibold text-main">{actorName}</span>
                      <span
                        className={`inline-flex items-center rounded-md border px-1.5 py-0.2 text-[10px] font-medium ${style.badgeBg}`}
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
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-edge/70 bg-surface/50 p-2">
                      <span className="text-[11px] text-quiet font-medium">
                        {tr('tasks:taskActivityModal.changedFields')}:
                      </span>
                      {fields.map((f, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center rounded bg-card border border-edge px-1.5 py-0.2 text-[10px] font-medium text-sub shadow-2xs"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Detail: Status transition */}
                  {transitionFrom && transitionTo && transitionFrom !== transitionTo && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge/70 bg-surface/50 px-2.5 py-1.5 text-[11px]">
                      <span className="shrink-0 font-medium text-quiet">
                        {tr('tasks:taskActivityModal.status')}
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-sub">
                        <span className="truncate">{transitionFrom}</span>
                        <span className="shrink-0 text-quiet" aria-hidden="true">
                          →
                        </span>
                        <span className="truncate font-medium text-main">{transitionTo}</span>
                      </span>
                    </div>
                  )}

                  {/* Detail: Initial creation */}
                  {item.action === 'create' && !isComment && (
                    <div className="mt-1.5 inline-flex items-center gap-1 text-xs text-sub/90">
                      <Sparkles className="h-3.5 w-3.5 text-success" />
                      <span>{tr('tasks:taskActivityModal.createdTask')}</span>
                    </div>
                  )}

                  {/* Detail: Comment content */}
                  {isComment && typeof item.payload.content === 'string' && (
                    <div className="mt-2 rounded-lg border border-edge/80 bg-card/60 p-2.5 text-xs leading-relaxed text-main shadow-2xs whitespace-pre-wrap break-words">
                      {item.payload.content}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Pagination Footer */}
      {data && data.total > (data.pageSize || LOG_PAGE_SIZE) && (
        <div className="pt-3 border-t border-edge/60 mt-2">
          <RecordPagination
            page={page}
            pageSize={data.pageSize || LOG_PAGE_SIZE}
            total={data.total}
            loading={loading}
            onPageChange={goToPage}
          />
        </div>
      )}
    </div>
  );
};
