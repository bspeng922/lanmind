import React, { useEffect, useRef, useState } from 'react';
import type { Project, Task, TaskRecycleResult } from '../types';
import { ApiService } from '../services/api';
import { tr } from '../i18n';
import { canWriteTask } from '../utils/taskPermissions';
import { scopedStorageKey } from '../utils/workspaceContext';
import { TaskDeleteConfirmDialog } from '../components/task/TaskDeleteConfirmDialog';

interface TaskDeletionOptions {
  tasks: Task[];
  projects: Project[];
  userId?: string;
  readOnly?: boolean;
  setTasks: (update: (tasks: Task[]) => Task[]) => void;
  refresh: () => void | Promise<void>;
  onOpenRecycle?: () => void;
}

/** All task entry points await the same themed confirmation and cancellation result. */
export function useTaskDeletion({ tasks, projects, userId, readOnly = false, setTasks, refresh, onOpenRecycle }: TaskDeletionOptions) {
  const [target, setTarget] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(false);
  const request = useRef<((deleted: boolean) => void) | null>(null);
  const busyRef = useRef(false);
  const scopeKey = scopedStorageKey(`task-deletion:${userId || ''}`);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  useEffect(() => {
    setTarget(null); setBusy(false); setError(''); setNotice(false); busyRef.current = false;
    return () => { request.current?.(false); request.current = null; };
  }, [scopeKey]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(false), 8000); return () => window.clearTimeout(timer); }, [notice]);

  const canDelete = (task: Task) => Boolean(userId) && !readOnly && canWriteTask(task, userId!, projects) && !projects.find((project) => project.id === task.projectId)?.isArchived;
  const requestDelete = (id: string): Promise<boolean> => {
    const task = tasks.find((item) => item.id === id);
    if (!task || request.current || !canDelete(task)) return Promise.resolve(false);
    setError(''); setTarget(task);
    return new Promise((resolve) => { request.current = resolve; });
  };
  const cancel = () => {
    if (busyRef.current) return;
    request.current?.(false); request.current = null; setTarget(null); setError('');
  };
  const confirm = async (deleteChildren: boolean) => {
    if (!target || busyRef.current) return;
    const task = tasks.find((item) => item.id === target.id);
    if (!task || !canDelete(task)) { cancel(); return; }
    busyRef.current = true; setBusy(true); setError('');
    const operationScope = scopeKey;
    const isCurrentScope = () => activeScope.current === operationScope && scopedStorageKey(`task-deletion:${userId || ''}`) === operationScope;
    const ensureScope = () => { if (!isCurrentScope()) throw new Error(tr('tasks:deleteDialog.failed')); };
    const reload = () => { if (isCurrentScope()) void Promise.resolve(refresh()).catch(() => {}); };
    try {
      const children = tasks.filter((item) => item.parentTaskId === task.id);
      if (children.some((child) => !canDelete(child))) throw new Error(tr('tasks:deleteDialog.childPermission'));
      ensureScope();
      const legacyAttachments: Record<string, unknown[]> = {};
      for (const item of [task, ...(deleteChildren ? children : [])]) {
        if (item.attachments?.length) continue;
        try {
          const cached = JSON.parse(localStorage.getItem(scopedStorageKey(`lanmind_task_attachments:${item.id}`)) || '[]');
          if (Array.isArray(cached) && cached.length) legacyAttachments[item.id] = cached;
        } catch { /* A malformed legacy cache is not a persisted attachment. */ }
      }
      const result = await ApiService.taskRecycle<TaskRecycleResult>('trash', { id: task.id, withChildren: deleteChildren, expectedVersion: task.version, legacyAttachments }, userId!);
      ensureScope();
      const deletedIds = new Set(result.ids || [task.id, ...(deleteChildren ? children.map((child) => child.id) : [])]);
      setTasks((previous) => previous.filter((item) => !deletedIds.has(item.id)).map((item) => !deleteChildren && item.parentTaskId === task.id ? { ...item, parentTaskId: null } : item));
      for (const id of Object.keys(legacyAttachments)) localStorage.removeItem(scopedStorageKey(`lanmind_task_attachments:${id}`));
      request.current?.(true); request.current = null; setTarget(null); setNotice(true); reload();
    } catch (reason) {
      if (isCurrentScope()) { setError(reason instanceof Error ? reason.message : tr('tasks:deleteDialog.failed')); reload(); }
    } finally {
      if (isCurrentScope()) { busyRef.current = false; setBusy(false); }
    }
  };
  const confirmation = <>
    {target && <TaskDeleteConfirmDialog key={target.id} task={target} childCount={tasks.filter((task) => task.parentTaskId === target.id).length} busy={busy} error={error} onCancel={cancel} onConfirm={(deleteChildren) => void confirm(deleteChildren)} />}
    {notice && <div role="status" className="fixed bottom-5 left-1/2 z-[100] flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-lg border border-edge bg-surface px-4 py-3 text-xs text-main shadow-lg">
      <span>{tr('tasks:recycle.trashed')}</span>
      {onOpenRecycle && <button type="button" className="text-info" onClick={() => { setNotice(false); onOpenRecycle(); }}>{tr('tasks:recycle.viewBin')}</button>}
      <button type="button" className="text-sub" onClick={() => setNotice(false)} aria-label={tr('tasks:recycle.close')}>×</button>
    </div>}
  </>;
  return { requestDelete, confirmation };
}
