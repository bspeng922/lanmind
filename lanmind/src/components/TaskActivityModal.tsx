import { currentLocale } from '../i18n/core';
import { localizeMessage } from '../i18n/messages';
import { tr, useLocale } from "../i18n";
import React, { useCallback, useEffect, useRef } from 'react';
import { History, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { Task, TaskActivity, User } from '../types';
import { ApiService } from '../services/api';
import { LOG_PAGE_SIZE, usePagedRecords } from '../hooks/usePagedRecords';
import { PageRequest } from '../types';
import { RecordPagination } from './RecordPagination';

const FIELD_LABELS: Record<string, string> = {
  get title() { return tr("tasks:taskActivityModal.name"); }, get description() { return tr("tasks:taskActivityModal.content"); }, get priority() { return tr("tasks:taskActivityModal.priority"); }, get status() { return tr("tasks:taskActivityModal.status"); }, get progress() { return tr("tasks:taskActivityModal.progress"); },
  get startDate() { return tr("tasks:taskActivityModal.startDate"); }, get dueDate() { return tr("tasks:taskActivityModal.dueDate"); }, get assigneeId() { return tr("tasks:taskActivityModal.assignee"); }, get projectId() { return tr("tasks:taskActivityModal.project"); },
  get parentTaskId() { return tr("tasks:taskActivityModal.parentTask"); }, get tags() { return tr("tasks:taskActivityModal.tags"); }, get subtasks() { return tr("tasks:taskActivityModal.checklist"); }, get recurrence() { return tr("tasks:taskActivityModal.recurring"); }, get reminderTime() { return tr("tasks:taskActivityModal.reminder"); }, get isShared() { return tr("tasks:taskActivityModal.sharing"); },
};
const ACTION_LABELS: Record<string, string> = { get create() { return tr("tasks:taskActivityModal.create"); }, get update() { return tr("tasks:taskActivityModal.update"); }, get delete() { return tr("tasks:taskActivityModal.delete"); } };

interface TaskActivityModalProps { task: Task; currentUser: User; users: User[]; onClose: () => void }

export const TaskActivityModal: React.FC<TaskActivityModalProps> = (props) => <TaskActivityDialog key={`${props.task.id}:${props.currentUser.id}`} {...props} />;

const TaskActivityDialog: React.FC<TaskActivityModalProps> = ({ task, currentUser, users, onClose }) => {
  useLocale();
  const loadPage = useCallback((request: PageRequest) => ApiService.getTaskActivityPage(task.id, currentUser.id, request), [task.id, currentUser.id]);
  const { data, page, loading, error, goToPage, refresh, retry } = usePagedRecords<TaskActivity>(loadPage);
  const items = data?.items || [];
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [data]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={tr("tasks:taskActivityModal.taskActivity")}>
    <section className="record-history-dialog flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-edge bg-surface text-main shadow-popover">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4">
        <div className="min-w-0"><h2 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-info" />{tr("tasks:taskActivityModal.taskActivity")}</h2><p className="mt-1 truncate text-xs text-sub" title={task.title}>{task.title}</p></div>
        <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={refresh} disabled={loading} className="project-toolbar-icon" title={tr("tasks:taskActivityModal.refreshTaskActivity")} aria-label={tr("tasks:taskActivityModal.refreshTaskActivity")}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button><button type="button" onClick={onClose} className="ui-modal-close-btn" title={tr("tasks:taskActivityModal.closeTaskActivity")} aria-label={tr("tasks:taskActivityModal.closeTaskActivity")}><X className="h-4 w-4" /></button></div>
      </header>
      <div ref={bodyRef} aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loading ? <div role="status" aria-label={tr("tasks:taskActivityModal.loadTaskActivity")} className="flex justify-center py-10"><LoaderCircle className="h-5 w-5 animate-spin text-sub" /></div>
          : error ? <div role="alert" className="py-8 text-center text-xs text-danger"><p>{localizeMessage(error)}</p><button type="button" onClick={retry} className="ui-cancel-button mx-auto mt-3 flex items-center gap-1 rounded-md px-3 py-2"><RefreshCw className="h-3.5 w-3.5" />{tr("tasks:taskActivityModal.retry")}</button></div>
            : items.length === 0 ? <p className="py-10 text-center text-xs text-quiet">{tr("tasks:taskActivityModal.noActivity")}</p>
              : <ol className="divide-y divide-edge">{items.map((item) => {
                const isComment = 'taskId' in item.payload && 'content' in item.payload;
                const actor = users.find((user) => user.id === item.actorId)?.nickname || item.actorId;
                const fields = Object.keys(item.payload).filter((key) => key in FIELD_LABELS).map((key) => FIELD_LABELS[key]);
                return <li key={item.id} className="py-3 first:pt-0"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{actor} · {ACTION_LABELS[item.action] || item.action}{isComment ? tr("tasks:taskActivityModal.comment") : tr("tasks:taskActivityModal.task")}</span><time className="text-[11px] text-quiet">{new Date(item.timestamp).toLocaleString(currentLocale())}</time></div>
                  {item.action === 'update' && fields.length > 0 && <p className="mt-1.5 text-xs text-sub">{fields.join('、')}</p>}
                  {isComment && typeof item.payload.content === 'string' && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-sub">{item.payload.content}</p>}
                </li>;
              })}</ol>}
      </div>
      <footer className="shrink-0 border-t border-edge px-5 py-3"><RecordPagination page={page} pageSize={data?.pageSize || LOG_PAGE_SIZE} total={data?.total || 0} loading={loading} onPageChange={goToPage} /></footer>
    </section>
  </div>;
};
