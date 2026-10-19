/**
 * TaskActivityModal — Displays the chronological activity history of a task in a dialog modal.
 *
 * CALLING SPEC:
 *   <TaskActivityModal
 *     task={task}
 *     currentUser={currentUser}
 *     users={users}
 *     states={states}
 *     onClose={() => void}
 *   />
 */

import React, { useEffect } from 'react';
import { History, X } from 'lucide-react';
import { Task, User, WorkItemState } from '../types';
import { tr, useLocale } from '../i18n';
import { TaskActivityTimeline } from './task/TaskActivityTimeline';

export interface TaskActivityModalProps {
  task: Task;
  currentUser: User;
  users: User[];
  /** 用于把状态 id 还原成项目自定义的状态名。个人任务可省略。 */
  states?: WorkItemState[];
  onClose: () => void;
}

export const TaskActivityModal: React.FC<TaskActivityModalProps> = (props) => (
  <TaskActivityDialog key={`${props.task.id}:${props.currentUser.id}`} {...props} />
);

const TaskActivityDialog: React.FC<TaskActivityModalProps> = ({
  task,
  currentUser,
  users,
  states = [],
  onClose,
}) => {
  useLocale();

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

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
              <h2 className="text-sm font-bold text-main tracking-tight">
                {tr('tasks:taskActivityModal.taskActivity')}
              </h2>
              <p className="mt-0.5 truncate text-xs text-sub/80" title={task.title}>
                {task.title}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
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
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <TaskActivityTimeline
            task={task}
            currentUser={currentUser}
            users={users}
            states={states}
            showHeader={true}
          />
        </div>
      </section>
    </div>
  );
};
