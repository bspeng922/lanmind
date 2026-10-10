/**
 * TaskModalMoreMenu — Dropdown menu for TaskModal header actions
 *
 * CALLING SPEC:
 *   <TaskModalMoreMenu
 *     task={Task}
 *     canEdit={boolean}
 *     onCopyLink={() => Promise<void> | void}
 *     onDuplicate={() => Promise<void> | void}
 *     onViewActivity={() => void}
 *     onDelete={() => Promise<void> | void}
 *   />
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { tr, useLocale } from '../i18n';
import { currentLocale } from '../i18n/core';
import { Task } from '../types';
import {
  MoreHorizontal,
  Link2,
  Copy,
  History,
  Trash2,
  Check,
} from 'lucide-react';

export interface TaskModalMoreMenuProps {
  task: Task;
  canEdit: boolean;
  onCopyLink: () => Promise<void> | void;
  onDuplicate: () => Promise<void> | void;
  onViewActivity: () => void;
  onDelete: () => Promise<void> | void;
}

export const TaskModalMoreMenu: React.FC<TaskModalMoreMenuProps> = ({
  task,
  canEdit,
  onCopyLink,
  onDuplicate,
  onViewActivity,
  onDelete,
}) => {
  useLocale();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const createdDateText = useMemo(() => {
    if (!task.createdAt) return null;
    const date = new Date(task.createdAt);
    if (Number.isNaN(date.getTime())) return null;
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const dateStr = date.toLocaleDateString(currentLocale(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return tr("tasks:taskModal.addedAt", {
      value0: dateStr,
      value1: `${hour}:${minute}`,
    });
  }, [task.createdAt]);

  const handleCopyLinkClick = async () => {
    try {
      await onCopyLink();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } finally {
      setOpen(false);
    }
  };

  const handleDuplicateClick = async () => {
    setOpen(false);
    await onDuplicate();
  };

  const handleViewActivityClick = () => {
    setOpen(false);
    onViewActivity();
  };

  const handleDeleteClick = async () => {
    setOpen(false);
    await onDelete();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-7 px-1.5 items-center justify-center rounded-md transition-colors ${
          open ? 'bg-hover text-main' : 'text-sub hover:bg-hover hover:text-main'
        }`}
        title={tr("tasks:taskModal.moreActions")}
        aria-label={tr("tasks:taskModal.moreActions")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={tr("tasks:taskModal.moreActions")}
          className="absolute right-0 top-full mt-1.5 z-50 min-w-56 w-max max-w-xs rounded-xl border border-edge bg-surface/95 backdrop-blur-md p-1.5 shadow-popover select-none animate-in fade-in zoom-in-95 duration-100"
        >
          {createdDateText && (
            <div className="px-3 py-2 text-[11px] text-quiet border-b border-edge/60 mb-1 select-text whitespace-nowrap">
              {createdDateText}
            </div>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={handleCopyLinkClick}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Link2 className="h-3.5 w-3.5 text-sub" />
            )}
            <span>{copied ? tr("tasks:taskModal.taskLinkCopied") : tr("tasks:taskModal.copyTaskLink")}</span>
          </button>

          {canEdit && (
            <button
              type="button"
              role="menuitem"
              onClick={handleDuplicateClick}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
            >
              <Copy className="h-3.5 w-3.5 text-sub" />
              <span>{tr("tasks:taskModal.duplicateTask")}</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={handleViewActivityClick}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
          >
            <History className="h-3.5 w-3.5 text-sub" />
            <span>{tr("tasks:taskModal.viewTaskActivity")}</span>
          </button>

          {canEdit && (
            <>
              <div className="my-1 border-t border-edge" />
              <button
                type="button"
                role="menuitem"
                onClick={handleDeleteClick}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-danger bg-transparent hover:bg-rose-500/10 focus:bg-rose-500/10 focus:outline-none transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
                <span className="font-semibold">{tr("tasks:taskModal.deleteTask")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
