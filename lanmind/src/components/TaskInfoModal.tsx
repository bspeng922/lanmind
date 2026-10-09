import { tr, useLocale } from "../i18n";
import React, { useEffect, useState } from 'react';
import { CheckSquare, Edit2, FileText, Link2, Paperclip, X } from 'lucide-react';
import { Project, Task, TaskAttachment, TaskComment, User } from '../types';
import { ApiService } from '../services/api';
import { TaskMarkdown } from './TaskMarkdown';
import { TaskComments } from './TaskComments';
import { FilePreviewModal } from './FilePreviewModal';
import { formatTaskDueDate } from '../utils/taskDateTime';
import { reconcileTaskChecklist } from '../utils/taskChecklist';

const STATUS: Record<Task['status'], string> = { get todo() { return tr("tasks:taskInfoModal.notStarted"); }, get in_progress() { return tr("tasks:taskInfoModal.inProgress"); }, get completed() { return tr("tasks:taskInfoModal.completed"); }, get blocked() { return tr("tasks:taskInfoModal.blocked"); }, get abandoned() { return tr("tasks:taskInfoModal.abandoned"); } };

export const TaskInfoModal: React.FC<{ task: Task | null; currentUserId?: string; users: User[]; projects: Project[]; tasks: Task[]; canEdit: boolean; onClose: () => void; onEdit: (task: Task) => void; onOpen: (task: Task) => void }> = ({ task, currentUserId, users, projects, tasks, canEdit, onClose, onEdit, onOpen }) => {
  useLocale();
  const [preview, setPreview] = useState<TaskAttachment | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentError, setCommentError] = useState('');
  const [commentsLoading, setCommentsLoading] = useState(false);
  useEffect(() => {
    let disposed = false;
    setComments([]); setCommentError('');
    setCommentsLoading(Boolean(task && currentUserId));
    if (task && currentUserId) void ApiService.getTaskComments(task.id, currentUserId).then((items) => { if (!disposed) setComments(items); }).catch(() => { if (!disposed) setCommentError(tr("tasks:taskInfoModal.couldNotLoadComments")); }).finally(() => { if (!disposed) setCommentsLoading(false); });
    return () => { disposed = true; };
  }, [task?.id, currentUserId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !preview) { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose, preview]);
  const children = task ? tasks.filter((item) => item.parentTaskId === task.id) : [];
  const attachments: TaskAttachment[] = task?.attachments?.length ? task.attachments : (() => {
    try { const stored = JSON.parse(localStorage.getItem(`lanmind_task_attachments:${task?.id}`) || '[]'); return Array.isArray(stored) ? stored : []; } catch { return []; }
  })();
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={tr("tasks:taskInfoModal.taskDetails")}>
    <section className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-edge bg-surface shadow-popover">
      <header className="flex items-center justify-between gap-3 border-b border-edge px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-main"><CheckSquare className="h-4 w-4 text-info" />{tr("tasks:taskInfoModal.taskDetails")}</h2>
        <div className="flex items-center gap-2">{task && canEdit && <button type="button" onClick={() => onEdit(task)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-sub hover:bg-hover"><Edit2 className="h-3.5 w-3.5" />{tr("tasks:taskInfoModal.editTask")}</button>}<button type="button" onClick={onClose} title={tr("tasks:taskInfoModal.closeTaskDetails")} aria-label={tr("tasks:taskInfoModal.closeTaskDetails")} className="ui-modal-close-btn"><X className="h-4 w-4" /></button></div>
      </header>
      {!task ? <p className="px-5 py-12 text-center text-xs text-sub">{tr("tasks:taskInfoModal.taskNotFoundOrAccessDenied")}</p> : <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5">
        <h3 className="break-words text-lg font-semibold text-main">{task.title}</h3>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-y border-edge py-4 text-xs sm:grid-cols-3">
          {[[tr("tasks:taskInfoModal.status"), STATUS[task.status]], [tr("tasks:taskInfoModal.priority"), task.priority], [tr("tasks:taskInfoModal.progress"), `${task.progress ?? (task.status === 'completed' ? 100 : 0)}%`], [tr("tasks:taskInfoModal.project"), projects.find((item) => item.id === task.projectId)?.name || tr("tasks:taskInfoModal.personalTask")], [tr("tasks:taskInfoModal.assignee"), users.find((item) => item.id === task.assigneeId)?.nickname || task.assigneeId], [tr("tasks:taskInfoModal.due"), task.dueDate ? formatTaskDueDate(task.dueDate) : tr("tasks:taskInfoModal.notSet")]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="mb-1 text-quiet">{label}</dt><dd className="break-words text-main">{value}</dd></div>)}
        </dl>
        <TaskMarkdown value={reconcileTaskChecklist(task.description || '', task.subtasks || []).description} attachments={attachments} />
        {children.length > 0 && <div className="space-y-2 border-t border-edge pt-4"><h4 className="flex items-center gap-1.5 text-xs font-semibold text-sub"><Link2 className="h-3.5 w-3.5" />{tr("tasks:taskInfoModal.childTasks")}</h4>{children.map((child) => <button key={child.id} type="button" onClick={() => onOpen(child)} className="flex w-full items-center justify-between gap-2 border-b border-edge py-2 text-left text-xs"><span className="min-w-0 truncate text-info">{child.title}</span><span className="shrink-0 text-quiet">{STATUS[child.status]}</span></button>)}</div>}
        {attachments.length > 0 && <div className="space-y-2 border-t border-edge pt-4"><h4 className="flex items-center gap-1.5 text-xs font-semibold text-sub"><Paperclip className="h-3.5 w-3.5" />{tr("tasks:taskInfoModal.attachments")}</h4>{attachments.map((file) => <button key={file.id} type="button" onClick={() => setPreview(file)} className="flex w-full items-center gap-2 py-1.5 text-left text-xs text-info"><FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{file.name}</span></button>)}</div>}
        {currentUserId && <TaskComments comments={comments} users={users} currentUserId={currentUserId} loading={commentsLoading} error={commentError} />}
      </div>}
    </section>
    {preview && <FilePreviewModal name={preview.name} type={preview.type} dataUrl={preview.dataUrl} onClose={() => setPreview(null)} />}
  </div>;
};
