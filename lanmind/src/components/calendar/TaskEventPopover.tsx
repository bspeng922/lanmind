/**
 * TaskEventPopover.tsx — Lightweight anchor popover for calendar task preview and quick actions.
 *
 * CALLING SPEC:
 *   <TaskEventPopover
 *     task={selectedTask}
 *     triggerRect={anchorRect}
 *     onClose={() => setAnchorRect(null)}
 *     projects={projects}
 *     states={states}
 *     onOpenEditTask={onOpenEditTask}
 *     onUpdateTask={onUpdateTask}
 *     onDeleteTask={onDeleteTask}
 *     canEditTask={canEditTask}
 *   />
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Task, Project, WorkItemState } from '../../types';
import { PriorityFlag } from '../PriorityFlag';
import { CheckCircle2, Clock, Circle, X, Trash2, Calendar, Edit3, ArrowRight } from 'lucide-react';
import { tr } from '../../i18n';
import { splitTaskDueDate, combineTaskDueDate } from '../../utils/taskDateTime';
import { resolveTaskGroup, resolveTaskStateName, isCompleted } from '../../utils/workItemState';
import { getTaskEventStyle } from '../../utils/calendarTokens';

interface TaskEventPopoverProps {
  task: Task | null;
  triggerRect: DOMRect | null;
  onClose: () => void;
  projects?: Project[];
  states?: WorkItemState[];
  onOpenEditTask: (task: Task) => void;
  onUpdateTask?: (id: string, updates: Partial<Task>) => void;
  onDeleteTask?: (id: string) => void;
  canEditTask?: (task: Task) => boolean;
}

export function TaskEventPopover({
  task,
  triggerRect,
  onClose,
  projects = [],
  states = [],
  onOpenEditTask,
  onUpdateTask,
  onDeleteTask,
  canEditTask,
}: TaskEventPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);

  // Synchronously compute placement relative to window viewport
  useEffect(() => {
    if (!triggerRect || !task) {
      setPos(null);
      return;
    }

    const popoverWidth = 280;
    const popoverHeight = 220;
    const padding = 12;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = triggerRect.right + 8;
    let originX = 'left';
    if (left + popoverWidth > viewportWidth - padding) {
      left = triggerRect.left - popoverWidth - 8;
      originX = 'right';
      if (left < padding) {
        left = Math.max(padding, Math.min(viewportWidth - popoverWidth - padding, triggerRect.left));
      }
    }

    let top = triggerRect.top;
    let originY = 'top';
    if (top + popoverHeight > viewportHeight - padding) {
      top = Math.max(padding, viewportHeight - popoverHeight - padding);
      originY = 'bottom';
    }

    setPos({
      top,
      left,
      origin: `origin-${originY}-${originX}`,
    });
  }, [triggerRect, task]);

  // Click outside and Escape key to close
  useEffect(() => {
    if (!triggerRect) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleScroll = () => {
      onClose();
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [triggerRect, onClose]);

  if (!task || !triggerRect || !pos) return null;

  const project = projects.find((p) => p.id === task.projectId);
  const editable = canEditTask ? canEditTask(task) : true;
  const completed = isCompleted(task, states);
  const dueParts = splitTaskDueDate(task.dueDate);
  const startParts = splitTaskDueDate(task.startDate);

  const handleToggleComplete = () => {
    if (!onUpdateTask || !editable) return;
    const nextGroup = completed ? 'unstarted' : 'completed';
    onUpdateTask(task.id, {
      stateGroup: nextGroup,
      status: nextGroup === 'completed' ? 'completed' : 'todo',
      progress: nextGroup === 'completed' ? 100 : 0,
    });
    onClose();
  };

  const handlePostponeOneDay = () => {
    if (!onUpdateTask || !editable || !dueParts.date) return;
    const curr = new Date(dueParts.date);
    curr.setDate(curr.getDate() + 1);
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    const newDueDate = combineTaskDueDate(`${y}-${m}-${d}`, dueParts.time);
    onUpdateTask(task.id, { dueDate: newDueDate });
    onClose();
  };

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      className={`fixed z-50 w-[280px] rounded-xl border border-edge bg-surface p-3.5 shadow-2xl transition-none ${pos.origin} animate-in fade-in zoom-in-95`}
      style={{
        top: pos.top,
        left: pos.left,
        transition: 'none',
      }}
    >
      {/* Top Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <PriorityFlag priority={task.priority} />
          {project && (
            <span
              className="inline-block max-w-[120px] truncate rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: `${project.color || '#3b82f6'}20`,
                color: project.color || '#3b82f6',
              }}
            >
              {project.name}
            </span>
          )}
          <span className="text-[11px] text-sub font-medium">{resolveTaskStateName(task, states)}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-quiet hover:bg-hover hover:text-main"
          aria-label={tr('calendar:calendarView.close')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Task Title */}
      <h3
        className={`mt-2 text-sm font-semibold leading-snug text-main line-clamp-3 ${
          completed ? 'line-through opacity-70' : ''
        }`}
      >
        {task.title}
      </h3>

      {/* Date & Time display */}
      <div className="mt-2.5 flex items-center gap-1.5 text-xs text-sub">
        <Calendar className="h-3.5 w-3.5 shrink-0 text-quiet" />
        <span className="truncate">
          {startParts.date ? `${startParts.date} ${startParts.time}` : ''}
          {startParts.date && dueParts.date ? ' → ' : ''}
          {dueParts.date ? `${dueParts.date} ${dueParts.time || tr('calendar:calendarView.allDay')}` : tr('tasks:taskLayoutPanel.noDueDate')}
        </span>
      </div>

      {/* Action Toolbar */}
      <div className="mt-3.5 flex items-center justify-between border-t border-edge/60 pt-2.5">
        <div className="flex items-center gap-1">
          {editable && onUpdateTask && (
            <>
              <button
                type="button"
                onClick={handleToggleComplete}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-main hover:bg-hover transition-colors"
                title={completed ? tr('calendar:calendarView.restoreToToDo') : tr('calendar:calendarView.completeTask')}
              >
                {completed ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-quiet" />
                )}
                <span>{completed ? tr('calendar:calendarView.complete') : tr('calendar:calendarView.completeTask2')}</span>
              </button>

              {dueParts.date && !completed && (
                <button
                  type="button"
                  onClick={handlePostponeOneDay}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-sub hover:bg-hover hover:text-main transition-colors"
                  title={tr('calendar:calendarView.postponeOneDay')}
                >
                  <ArrowRight className="h-3 w-3" />
                  <span>+1d</span>
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {editable && onDeleteTask && (
            <button
              type="button"
              onClick={() => {
                onDeleteTask(task.id);
                onClose();
              }}
              className="rounded p-1 text-quiet hover:bg-danger/10 hover:text-danger transition-colors"
              title={tr('calendar:calendarView.delete')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onOpenEditTask(task);
              onClose();
            }}
            className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-on-accent hover:bg-accent/90 transition-colors shadow-sm"
          >
            <Edit3 className="h-3 w-3" />
            <span>{tr('calendar:calendarView.edit')}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

