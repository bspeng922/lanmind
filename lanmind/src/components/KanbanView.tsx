import { tr, useLocale } from "../i18n";
import React, { useRef, useState } from 'react';
import { Task, Project, TaskStatus } from '../types';
import { formatRecurrenceLabel } from '../utils/recurrence';
import { formatTaskDueDate } from '../utils/taskDateTime';
import { PriorityFlag } from './PriorityFlag';
import { Plus, CheckCircle2, Clock, AlertOctagon, Circle, MoveRight, Calendar, Repeat, Paperclip, X } from 'lucide-react';

const getTaskAttachmentsCount = (task: Task): number => {
  if (task.attachments?.length) return task.attachments.length;
  try {
    const saved = JSON.parse(localStorage.getItem(`lanmind_task_attachments:${task.id}`) || '[]');
    return Array.isArray(saved) ? saved.length : 0;
  } catch {
    return 0;
  }
};

interface KanbanViewProps {
  tasks: Task[];
  projects: Project[];
  onUpdateTaskStatus: (taskId: string, newStatus: TaskStatus) => void;
  onOpenCreateTaskWithStatus: (status: TaskStatus) => void;
  onOpenEditTask: (task: Task) => void;
  canEditTask: (task: Task) => boolean;
  readOnly?: boolean;
}

export const KanbanView: React.FC<KanbanViewProps> = ({
  tasks,
  projects,
  onUpdateTaskStatus,
  onOpenCreateTaskWithStatus,
  onOpenEditTask,
  canEditTask,
  readOnly = false,
}) => {
  useLocale();
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);
  const [moveMenuTaskId, setMoveMenuTaskId] = useState<string | null>(null);
  const didDragRef = useRef(false);
  const pointerDragRef = useRef<{
    pointerId: number;
    taskId: string;
    sourceStatus: TaskStatus;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const columns: { id: TaskStatus; title: string; color: string; accentColor: string; icon: any }[] = [
    { id: 'todo', title: tr("tasks:kanbanView.toDo"), color: 'border-edge/80 bg-surface/40', accentColor: 'text-sub', icon: Circle },
    { id: 'in_progress', title: tr("tasks:kanbanView.inProgress"), color: 'border-blue-500/30 bg-blue-500/5', accentColor: 'text-info', icon: Clock },
    { id: 'completed', title: tr("tasks:kanbanView.completed"), color: 'border-emerald-500/30 bg-emerald-500/5', accentColor: 'text-success', icon: CheckCircle2 },
    { id: 'blocked', title: tr("tasks:kanbanView.blocked"), color: 'border-rose-500/30 bg-rose-500/5', accentColor: 'text-danger', icon: AlertOctagon },
  ];
  if (tasks.some((task) => task.status === 'abandoned')) {
    columns.push({ id: 'abandoned', title: tr("tasks:kanbanView.abandoned"), color: 'border-edge/80 bg-surface/40', accentColor: 'text-quiet', icon: X });
  }

  const statusAtPoint = (x: number, y: number) =>
    document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-kanban-status]')
      ?.dataset.kanbanStatus as TaskStatus | undefined;

  const clearPointerDrag = () => {
    pointerDragRef.current = null;
    setDraggedTaskId(null);
    setDropTarget(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, task: Task) => {
    if (event.button !== 0 || !canEditTask(task)) return;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      taskId: task.id,
      sourceStatus: task.status,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.moved && distance < 6) return;
    drag.moved = true;
    didDragRef.current = true;
    setDraggedTaskId(drag.taskId);
    setDropTarget(statusAtPoint(event.clientX, event.clientY) || null);
    event.preventDefault();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const targetStatus = statusAtPoint(event.clientX, event.clientY);
    if (drag.moved && targetStatus && targetStatus !== drag.sourceStatus) {
      onUpdateTaskStatus(drag.taskId, targetStatus);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const moved = drag.moved;
    clearPointerDrag();
    if (moved) {
      window.setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    } else {
      didDragRef.current = false;
    }
  };

  return (
    <div className="flex-1 flex min-h-0 flex-col bg-canvas text-main overflow-hidden">
      {/* Kanban Header */}
      <div className="bg-surface border-b border-edge p-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-main flex items-center gap-2">
          {tr("tasks:kanbanView.kanbanBoard")}<span className="text-xs font-normal text-sub">{tr("tasks:kanbanView.dragTasksBetweenStatusColumns")}</span>
        </h2>
      </div>

      {/* Kanban Board Columns Container */}
      <div className="kanban-board">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.id);
          const Icon = col.icon;

          return (
            <div
              key={col.id}
              data-kanban-status={col.id}
              className={`border rounded-xl p-3 flex min-h-0 min-w-0 flex-col transition-all ${col.color} ${
                dropTarget === col.id && draggedTaskId
                  ? 'ring-2 ring-blue-400/70 border-blue-400/80'
                  : ''
              }`}
            >
              {/* Column Header */}
              <div className="mb-2 flex min-h-8 shrink-0 items-center justify-between gap-3 border-b border-edge/80 pb-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className={`h-4 w-4 flex-shrink-0 ${col.accentColor}`} />
                  <span className="truncate text-xs font-bold text-main">{col.title}</span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span className="kanban-column-action flex h-6 min-w-6 items-center justify-center px-1.5 font-mono text-[10px]">
                    {colTasks.length}
                  </span>
                  <button
                    hidden={readOnly}
                    onClick={() => onOpenCreateTaskWithStatus(col.id)}
                    className="kanban-column-action flex h-6 w-6 items-center justify-center transition-colors hover:text-info"
                    title={tr("tasks:kanbanView.createATaskIn", { value0: col.title })}
                    aria-label={tr("tasks:kanbanView.createATaskIn", { value0: col.title })}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Kanban Task Cards */}
              <div className="flex-1 min-h-0 min-w-0 space-y-2.5 overflow-y-auto pr-1">
                {colTasks.map((task) => {
                  const project = projects.find((p) => p.id === task.projectId);

                  return (
                    <div
                      key={task.id}
                      onPointerDown={(event) => handlePointerDown(event, task)}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={() => {
                        didDragRef.current = false;
                        clearPointerDrag();
                      }}
                      onClick={() => {
                        if (!didDragRef.current) onOpenEditTask(task);
                      }}
                      className={`group relative ${canEditTask(task) ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} space-y-2 rounded-xl theme-glow-card p-3 shadow-soft transition-all hover:border-subtle hover:shadow-panel ${
                        draggedTaskId === task.id ? 'opacity-50 scale-[0.98]' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-main group-hover:text-info transition-colors line-clamp-2">
                          {task.title}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                            task.priority === 'P1'
                              ? 'bg-rose-500/20 text-danger'
                              : task.priority === 'P2'
                              ? 'bg-amber-500/20 text-warning'
                              : task.priority === 'P3'
                              ? 'bg-blue-500/20 text-info'
                              : 'bg-card text-sub'
                          }`}
                        >
                          <PriorityFlag priority={task.priority} />{task.priority}
                        </span>
                        <button
                          type="button"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!canEditTask(task)) return;
                            setMoveMenuTaskId((current) => current === task.id ? null : task.id);
                          }}
                          disabled={!canEditTask(task)}
                          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-quiet transition-colors hover:bg-hover hover:text-info disabled:cursor-not-allowed disabled:opacity-40"
                          title={tr("tasks:kanbanView.moveTaskToAnotherStatus")}
                          aria-label={tr("tasks:kanbanView.moveTask", { value0: task.title })}
                        >
                          <MoveRight className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {moveMenuTaskId === task.id && (
                        <div
                          role="menu"
                          aria-label={tr("tasks:kanbanView.moveTaskToAnotherStatus")}
                          className="absolute right-2 top-9 z-30 min-w-36 rounded-xl border border-edge bg-surface/95 backdrop-blur-md p-1.5 shadow-popover animate-in fade-in zoom-in-95 duration-100 select-none"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {columns
                            .filter((targetColumn) => targetColumn.id !== task.status)
                            .map((targetColumn) => (
                              <button
                                key={targetColumn.id}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  if (!canEditTask(task)) return;
                                  onUpdateTaskStatus(task.id, targetColumn.id);
                                  setMoveMenuTaskId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-main bg-transparent transition-colors hover:bg-hover hover:text-main focus:bg-hover focus:outline-none"
                              >
                                <targetColumn.icon className="h-3.5 w-3.5 text-sub" />
                                <span>{targetColumn.title}</span>
                              </button>
                            ))}
                        </div>
                      )}

                      {task.description && (
                        <p className="text-[11px] text-sub line-clamp-2">{task.description}</p>
                      )}

                      {/* Card Footer info */}
                      <div className="flex items-center justify-between text-[10px] text-sub pt-1 border-t border-edge/60">
                        <div className="flex items-center space-x-1.5 truncate">
                          {project ? (
                            <span className="flex items-center space-x-1 truncate max-w-[140px]" style={{ color: project.color }} title={project.name}>
                              <span className="truncate">● {project.name}</span>
                            </span>
                          ) : (
                            <span>{tr("tasks:kanbanView.personalTask")}</span>
                          )}

                        {task.recurrence && task.recurrence !== 'none' && (
                            <span className="flex items-center gap-0.5 text-info bg-cyan-500/10 px-1 py-0.2 rounded text-[9px]">
                              <Repeat className="w-2.5 h-2.5" />
                              <span>{formatRecurrenceLabel(task.recurrence, task.recurrenceRule, task.dueDate)}</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {getTaskAttachmentsCount(task) > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 rounded px-1 py-0.2 text-[9px] font-medium bg-blue-500/15 text-info border border-blue-500/30"
                              title={tr("tasks:kanbanView.attachments", { value0: getTaskAttachmentsCount(task) })}
                            >
                              <Paperclip className="w-2.5 h-2.5 text-info shrink-0" strokeWidth={2.2} />
                              <span>{getTaskAttachmentsCount(task)}</span>
                            </span>
                          )}
                          {task.dueDate && (
                            <span className="flex items-center space-x-1 font-mono text-sub">
                              <Calendar className="w-3 h-3" />
                              <span>{formatTaskDueDate(task.dueDate)}</span>
                            </span>
                          )}
                          {task.isShared && !canEditTask(task) && (
                            <span className="rounded border border-subtle px-1 py-0.5 text-[9px] text-quiet">{tr("tasks:kanbanView.readOnly")}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
