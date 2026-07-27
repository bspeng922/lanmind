import React, { useRef, useState } from 'react';
import { Task, Project, TaskStatus } from '../types';
import { formatRecurrenceLabel } from '../utils/recurrence';
import { formatTaskDueDate } from '../utils/taskDateTime';
import { Plus, CheckCircle2, Clock, AlertOctagon, Circle, MoveRight, Calendar, Repeat } from 'lucide-react';

interface KanbanViewProps {
  tasks: Task[];
  projects: Project[];
  onUpdateTaskStatus: (taskId: string, newStatus: TaskStatus) => void;
  onOpenCreateTaskWithStatus: (status: TaskStatus) => void;
  onOpenEditTask: (task: Task) => void;
  canEditTask: (task: Task) => boolean;
}

export const KanbanView: React.FC<KanbanViewProps> = ({
  tasks,
  projects,
  onUpdateTaskStatus,
  onOpenCreateTaskWithStatus,
  onOpenEditTask,
  canEditTask,
}) => {
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
    { id: 'todo', title: '未开始 Todo', color: 'border-slate-800/80 bg-slate-900/40', accentColor: 'text-slate-400', icon: Circle },
    { id: 'in_progress', title: '进行中 In Progress', color: 'border-blue-500/30 bg-blue-500/5', accentColor: 'text-blue-400', icon: Clock },
    { id: 'completed', title: '已完成 Completed', color: 'border-emerald-500/30 bg-emerald-500/5', accentColor: 'text-emerald-400', icon: CheckCircle2 },
    { id: 'blocked', title: '已阻塞 Blocked', color: 'border-rose-500/30 bg-rose-500/5', accentColor: 'text-rose-400', icon: AlertOctagon },
  ];

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
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Kanban Header */}
      <div className="bg-slate-900 border-b border-slate-800 p-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
          看板视图 Kanban Board
          <span className="text-xs font-normal text-slate-400">（按状态栏拖拽或移动任务）</span>
        </h2>
      </div>

      {/* Kanban Board Columns Container */}
      <div className="flex-1 p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 overflow-y-auto">
        {columns.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.id);
          const Icon = col.icon;

          return (
            <div
              key={col.id}
              data-kanban-status={col.id}
              className={`border rounded-xl p-3 flex flex-col h-full transition-all ${col.color} ${
                dropTarget === col.id && draggedTaskId
                  ? 'ring-2 ring-blue-400/70 border-blue-400/80'
                  : ''
              }`}
            >
              {/* Column Header */}
              <div className="mb-2 flex min-h-8 items-center justify-between gap-3 border-b border-slate-800/80 pb-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className={`h-4 w-4 flex-shrink-0 ${col.accentColor}`} />
                  <span className="truncate text-xs font-bold text-slate-200">{col.title}</span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span className="kanban-column-action flex h-6 min-w-6 items-center justify-center px-1.5 font-mono text-[10px]">
                    {colTasks.length}
                  </span>
                  <button
                    onClick={() => onOpenCreateTaskWithStatus(col.id)}
                    className="kanban-column-action flex h-6 w-6 items-center justify-center transition-colors hover:text-blue-400"
                    title={`在“${col.title}”中新建任务`}
                    aria-label={`在“${col.title}”中新建任务`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Kanban Task Cards */}
              <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
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
                        if (!didDragRef.current && canEditTask(task)) onOpenEditTask(task);
                      }}
                      className={`group relative ${canEditTask(task) ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} space-y-2 rounded-xl theme-glow-card p-3 shadow-sm transition-all hover:border-slate-700 hover:shadow-md ${
                        draggedTaskId === task.id ? 'opacity-50 scale-[0.98]' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-100 group-hover:text-blue-400 transition-colors line-clamp-2">
                          {task.title}
                        </span>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                            task.priority === 'P1'
                              ? 'bg-rose-500/20 text-rose-400'
                              : task.priority === 'P2'
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-blue-500/20 text-blue-400'
                          }`}
                        >
                          {task.priority}
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
                          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-800 hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
                          title="移动任务到其他状态"
                          aria-label={`移动任务 ${task.title}`}
                        >
                          <MoveRight className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {moveMenuTaskId === task.id && (
                        <div
                          className="absolute right-2 top-9 z-30 min-w-36 rounded-md border border-slate-700 bg-slate-900 p-1 shadow-xl"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {columns
                            .filter((targetColumn) => targetColumn.id !== task.status)
                            .map((targetColumn) => (
                              <button
                                key={targetColumn.id}
                                type="button"
                                  onClick={() => {
                                    if (!canEditTask(task)) return;
                                    onUpdateTaskStatus(task.id, targetColumn.id);
                                  setMoveMenuTaskId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                              >
                                <targetColumn.icon className="h-3.5 w-3.5" />
                                <span>{targetColumn.title}</span>
                              </button>
                            ))}
                        </div>
                      )}

                      {task.description && (
                        <p className="text-[11px] text-slate-400 line-clamp-2">{task.description}</p>
                      )}

                      {/* Card Footer info */}
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800/60">
                        <div className="flex items-center space-x-1.5 truncate">
                          {project ? (
                            <span className="flex items-center space-x-1 truncate" style={{ color: project.color }}>
                              <span>● {project.name}</span>
                            </span>
                          ) : (
                            <span>个人任务</span>
                          )}

                        {task.recurrence && task.recurrence !== 'none' && (
                            <span className="flex items-center gap-0.5 text-cyan-400 bg-cyan-500/10 px-1 py-0.2 rounded text-[9px]">
                              <Repeat className="w-2.5 h-2.5" />
                              <span>{formatRecurrenceLabel(task.recurrence, task.recurrenceRule, task.dueDate)}</span>
                            </span>
                          )}
                        </div>

                        {task.dueDate && (
                          <span className="flex items-center space-x-1 font-mono text-slate-400 flex-shrink-0">
                            <Calendar className="w-3 h-3" />
                            <span>{formatTaskDueDate(task.dueDate)}</span>
                          </span>
                        )}
                        {task.isShared && !canEditTask(task) && (
                          <span className="rounded border border-slate-700 px-1 py-0.5 text-[9px] text-slate-500">只读</span>
                        )}
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
