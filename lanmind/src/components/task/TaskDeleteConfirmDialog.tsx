import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { tr, useLocale } from '../../i18n';
import { localizeMessage } from '../../i18n/messages';
import type { Task } from '../../types';
import { ThemeCheckbox } from '../ThemeCheckbox';

interface TaskDeleteConfirmDialogProps {
  task: Task;
  childCount: number;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (deleteChildren: boolean) => void;
}

export const TaskDeleteConfirmDialog: React.FC<TaskDeleteConfirmDialogProps> = ({ task, childCount, busy, error, onCancel, onConfirm }) => {
  useLocale();
  const { currentTheme } = useTheme();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ busy, onCancel });
  callbacks.current = { busy, onCancel };
  const [deleteChildren, setDeleteChildren] = useState(false);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!callbacks.current.busy) callbacks.current.onCancel();
      }
      if (event.key === 'Tab') {
        const controls = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled)') || []) as HTMLElement[];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); dialogRef.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(<div className="task-delete-overlay fixed inset-0 z-[100] flex items-center justify-center bg-overlay p-4 font-sans" data-theme={currentTheme.id} onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} tabIndex={-1} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-edge bg-surface p-5 text-main shadow-popover">
      <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold"><Trash2 className="h-4 w-4 text-danger" />{tr('tasks:deleteDialog.title')}</h2>
      <p className="mt-3 break-words text-sm font-medium [overflow-wrap:anywhere]">{task.identifier && <span className="mr-2 text-xs text-sub">{task.identifier}</span>}{task.title}</p>
      <p id={descriptionId} className="mt-2 text-xs leading-5 text-sub">{tr('tasks:deleteDialog.description')}</p>
      {childCount > 0 && <div className="mt-4 rounded-lg border border-edge bg-canvas p-3 text-xs leading-5 text-sub">
        <p>{tr('tasks:deleteDialog.childrenHint', { count: childCount })}</p>
        <ThemeCheckbox className="mt-2" checked={deleteChildren} onChange={setDeleteChildren} disabled={busy} label={tr('tasks:deleteDialog.deleteChildren', { count: childCount })} />
      </div>}
      {error && <p role="alert" className="mt-3 text-xs leading-5 text-danger">{localizeMessage(error)}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="ui-cancel-button rounded-md px-4 py-2 text-xs font-medium disabled:opacity-50">{tr('tasks:taskModal.cancel')}</button>
        <button type="button" onClick={() => onConfirm(deleteChildren)} disabled={busy} className="flex items-center gap-1.5 rounded-md bg-danger px-4 py-2 text-xs font-semibold text-on-solid transition-opacity hover:opacity-90 disabled:opacity-50">{busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}{tr(busy ? 'tasks:deleteDialog.deleting' : 'tasks:deleteDialog.confirm')}</button>
      </div>
    </div>
  </div>, document.body);
};
