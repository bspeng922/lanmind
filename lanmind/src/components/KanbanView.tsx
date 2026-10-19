import { scopedStorageKey } from "../utils/workspaceContext";
import { tr, useLocale } from "../i18n";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StateGroup, Task, Project, WorkItemState } from '../types';
import { formatRecurrenceLabel } from '../utils/recurrence';
import { formatTaskDueDate } from '../utils/taskDateTime';
import { PriorityFlag } from './PriorityFlag';
import { IssueIdentifier } from './workitem/IssueIdentifier';
import { PrioritySignal } from './workitem/PrioritySignal';
import { MemberAvatar } from './workitem/MemberAvatar';
import { LabelPill } from './workitem/LabelPill';
import { filterTasksByLayout, groupFilterValue, ProjectLayout, useTaskToday } from '../utils/taskLayout';
import {
  BLOCKED_STATE_NAME,
  resolveTaskGroup,
  sortStates,
  STATE_GROUPS,
} from '../utils/workItemState';
import { TaskFilterContext } from './TaskLayoutPanel';
import { TaskFilterButton } from './TaskFilterButton';
import { TaskFilterSummary } from './TaskFilterSummary';
import { Plus, CheckCircle2, Clock, AlertOctagon, Circle, MoveRight, Calendar, Repeat, Paperclip, X } from 'lucide-react';

/** 一个看板列。有状态定义时按状态成列，否则按状态组成列。 */
interface KanbanColumn {
  id: string;
  group: StateGroup;
  title: string;
  state: WorkItemState | null;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

/** 状态图标按状态组决定；阻塞是 started 组下的独立状态，单独识别。 */
function iconForGroup(group: StateGroup, stateName?: string) {
  if (group === 'started' && stateName === BLOCKED_STATE_NAME) return AlertOctagon;
  switch (group) {
    case 'completed': return CheckCircle2;
    case 'started': return Clock;
    case 'cancelled': return X;
    default: return Circle;
  }
}

/** 列头着色按状态色，通过内联样式传递，避免为每个状态生成 Tailwind 类。 */
const columnColorStyle = (column: KanbanColumn): React.CSSProperties => ({
  borderColor: column.state?.color
    ? `color-mix(in srgb, ${column.state.color} 30%, transparent)`
    : `color-mix(in srgb, var(--state-${column.group}) 30%, transparent)`,
});

const getTaskAttachmentsCount = (task: Task): number => {
  if (task.attachments?.length) return task.attachments.length;
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(`lanmind_task_attachments:${task.id}`)) || '[]');
    return Array.isArray(saved) ? saved.length : 0;
  } catch {
    return 0;
  }
};

interface KanbanViewProps extends TaskFilterContext {
  tasks: Task[];
  projects: Project[];
  /** 当前作用域的状态列表。为空时按状态组成列。 */
  states?: WorkItemState[];
  onUpdateTaskState: (taskId: string, stateId: string) => void;
  onOpenCreateTaskWithState: (stateId: string) => void;
  onOpenEditTask: (task: Task) => void;
  canEditTask: (task: Task) => boolean;
  readOnly?: boolean;
  layout?: ProjectLayout;
  onLayoutChange?: (patch: Partial<ProjectLayout>) => void;
  searchQuery?: string;
}

export const KanbanView: React.FC<KanbanViewProps> = ({
  tasks,
  projects,
  states = [],
  onUpdateTaskState,
  onOpenCreateTaskWithState,
  onOpenEditTask,
  canEditTask,
  readOnly = false,
  layout,
  onLayoutChange,
  searchQuery = '',
  scope = 'task',
  users,
  currentUserId,
}) => {
  const { locale } = useLocale();
  const today = useTaskToday();
  const visibleTasks = useMemo(() => layout ? filterTasksByLayout(tasks, layout, searchQuery, new Date(today + 'T12:00:00')) : tasks, [tasks, layout, searchQuery, today, locale]);
  const pendingMove = useRef<{ id: string; targetColumnId: string } | null>(null);
  const [hiddenNotice, setHiddenNotice] = useState(false);
  /**
   * 看板列由当前作用域的状态列表生成。
   * 项目作用域使用该项目的自定义状态；全局作用域跨多个项目，退回按 5 个标准状态组生成列。
   */
  const columns: KanbanColumn[] = useMemo(() => {
    if (scope === 'project' && states.length) {
      // 在项目作用域内，先按 id 去重，再按状态组排序生成列
      const uniqueStates = Array.from(new Map(states.map((s) => [s.id, s])).values());
      return sortStates(uniqueStates).map((state) => ({
        id: state.id,
        group: state.group,
        title: state.name,
        state,
        icon: iconForGroup(state.group, state.name),
      }));
    }
    // 全局/跨项目作用域，严格展示 5 个标准状态组列，杜绝多项目 Backlog 重复堆叠
    return STATE_GROUPS.map((group) => ({
      id: groupFilterValue(group),
      group,
      title: tr(`tasks:stateGroup.${group}`),
      state: null,
      icon: iconForGroup(group),
    }));
  }, [states, scope, locale]);

  /** 解析一个工作项落在哪一列。有状态定义时按状态 id 匹配，否则回退按状态组匹配。 */
  const columnForTask = (task: Task): KanbanColumn | undefined => {
    if (scope === 'project' && states.length) {
      const byId = columns.find((column) => column.id === task.stateId);
      if (byId) return byId;
    }
    const group = resolveTaskGroup(task, states);
    return columns.find((column) => column.group === group);
  };

  useEffect(() => {
    const pending = pendingMove.current;
    if (!pending) return;
    const task = tasks.find((item) => item.id === pending.id);
    if (!task) return;
    const landedIn = columnForTask(task)?.id;
    // 列归属与目标一致说明更新已生效，此时再判断是否被当前筛选隐藏。
    if (landedIn === pending.targetColumnId) {
      setHiddenNotice(!visibleTasks.some((item) => item.id === pending.id));
      pendingMove.current = null;
    }
  }, [tasks, visibleTasks, columns, states]);

  /** 移动工作项到目标列。目标列是状态组令牌时，交由上层解析为该组的状态。 */
  const moveTask = (id: string, targetColumnId: string) => {
    pendingMove.current = { id, targetColumnId };
    setHiddenNotice(false);
    onUpdateTaskState(id, targetColumnId);
  };
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveMenuTaskId, setMoveMenuTaskId] = useState<string | null>(null);

  // 点击外部空白区域或按 Escape 键自动关闭看板快速移动菜单
  useEffect(() => {
    if (!moveMenuTaskId) return;
    const handleOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const isInsideMenu = target.closest(`[data-kanban-move-menu="${moveMenuTaskId}"]`);
      const isMenuButton = target.closest(`[data-kanban-move-btn="${moveMenuTaskId}"]`);
      if (!isInsideMenu && !isMenuButton) {
        setMoveMenuTaskId(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setMoveMenuTaskId(null);
      }
    };
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [moveMenuTaskId]);

  const didDragRef = useRef(false);
  const pointerDragRef = useRef<{
    pointerId: number;
    taskId: string;
    sourceColumnId: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  /** 解析指针下的看板列。返回列 id（状态 id 或状态组令牌）。 */
  const columnAtPoint = (x: number, y: number) =>
    document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-kanban-column]')
      ?.dataset.kanbanColumn;

  const clearPointerDrag = () => {
    pointerDragRef.current = null;
    setDraggedTaskId(null);
    setDropTarget(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, task: Task) => {
    if (readOnly || event.button !== 0 || !canEditTask(task)) return;
    const current = columnForTask(task);
    if (!current) return;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      taskId: task.id,
      sourceColumnId: current.id,
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
    setDropTarget(columnAtPoint(event.clientX, event.clientY) || null);
    event.preventDefault();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const targetColumnId = columnAtPoint(event.clientX, event.clientY);
    if (drag.moved && targetColumnId && targetColumnId !== drag.sourceColumnId) {
      moveTask(drag.taskId, targetColumnId);
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
    <div className="kanban-view flex-1 flex min-h-0 flex-col bg-canvas text-main overflow-hidden">
      {/* Kanban Header */}
      <div className="bg-surface border-b border-edge p-4 flex flex-wrap gap-2 items-center justify-between">
        <h2 className="text-base font-bold text-main flex items-center gap-2">
          {tr("tasks:kanbanView.kanbanBoard")}<span className="text-xs font-normal text-sub">{tr("tasks:kanbanView.dragTasksBetweenStatusColumns")}</span>
        </h2>
        {scope === 'task' && layout && onLayoutChange && <TaskFilterButton tasks={tasks} layout={layout} onLayoutChange={onLayoutChange} projects={projects} users={users} currentUserId={currentUserId} activeView="kanban" />}
      </div>
      {layout && <TaskFilterSummary tasks={tasks} layout={layout} onLayoutChange={onLayoutChange} projects={projects} users={users} currentUserId={currentUserId} scope={scope} />}
      {hiddenNotice && <div role="status" className="flex shrink-0 items-center justify-between gap-2 px-4 py-2 text-xs text-info">{tr('tasks:kanbanView.hiddenByFilter')}<button type="button" aria-label={tr('common:header.close')} onClick={() => setHiddenNotice(false)}><X className="h-3.5 w-3.5" /></button></div>}
      {visibleTasks.length === 0 && <p role="status" className="shrink-0 px-4 py-3 text-xs text-quiet">{tr('tasks:taskLayoutPanel.noMatches')}</p>}

      {/* Kanban Board Columns Container */}
      <div className="kanban-board">
        {columns.map((col) => {
          const colTasks = visibleTasks.filter((t) => columnForTask(t)?.id === col.id);
          const Icon = col.icon;
          const colColor = col.state?.color ?? `var(--state-${col.group})`;

          return (
            <div
              key={col.id}
              data-kanban-column={col.id}
              style={{ ...columnColorStyle(col), '--kanban-column-color': colColor } as React.CSSProperties}
              className={`border rounded-xl bg-surface/40 p-3 flex min-h-0 min-w-0 flex-col transition-all ${
                dropTarget === col.id && draggedTaskId ? 'ring-2 ring-accent/70' : ''
              }`}
            >
              {/* Column Header */}
              <div className="mb-2 flex min-h-8 shrink-0 items-center justify-between gap-3 border-b border-edge/80 pb-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 flex-shrink-0" style={{ color: colColor }} />
                  <span className="truncate text-xs font-bold text-main">{col.title}</span>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <span className="kanban-column-action flex h-6 min-w-6 items-center justify-center px-1.5 font-mono text-[10px]">
                    {colTasks.length}
                  </span>
                  <button
                    hidden={readOnly}
                    onClick={() => onOpenCreateTaskWithState(col.id)}
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
                  const assignee = users?.find((u) => u.id === task.assigneeId);
                  const taskGroup = resolveTaskGroup(task, states);
                  const isOverdue = Boolean(
                    task.dueDate &&
                    taskGroup !== 'completed' &&
                    taskGroup !== 'cancelled' &&
                    new Date(task.dueDate) < new Date()
                  );
                  const primaryTag = task.tags && task.tags.length > 0 ? task.tags[0] : null;

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
                      className={`group relative ${canEditTask(task) ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} flex flex-col justify-between gap-2.5 rounded-lg border border-edge/80 bg-surface p-3 text-left shadow-soft transition-all hover:border-subtle hover:shadow-panel ${
                        draggedTaskId === task.id ? 'opacity-50 scale-[0.98]' : ''
                      }`}
                    >
                      {/* Top Row: Identifier, Project Dot, Move Button */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {project?.color && (
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: project.color }}
                              title={project.name}
                            />
                          )}
                          <IssueIdentifier taskId={task.id} project={project} size="sm" />
                        </div>
                        <button
                          type="button"
                          data-kanban-move-btn={task.id}
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
                          data-kanban-move-menu={task.id}
                          aria-label={tr("tasks:kanbanView.moveTaskToAnotherStatus")}
                          className="absolute right-2 top-9 z-30 min-w-36 rounded-xl border border-edge bg-surface/95 backdrop-blur-md p-1.5 shadow-popover animate-in fade-in zoom-in-95 duration-100 select-none"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {columns
                            .filter((targetColumn) => targetColumn.id !== columnForTask(task)?.id)
                            .map((targetColumn) => (
                              <button
                                key={targetColumn.id}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  if (!canEditTask(task)) return;
                                  moveTask(task.id, targetColumn.id);
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

                      {/* Title */}
                      <span className="text-xs font-semibold leading-snug text-main group-hover:text-info transition-colors line-clamp-2">
                        {task.title}
                      </span>

                      {/* Card Footer: Assignee, Tags, Due Date, Priority */}
                      <div className="flex items-center justify-between text-[11px] text-sub pt-1 border-t border-edge/60">
                        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                          <MemberAvatar user={assignee} size="sm" showPresence={true} />
                          {primaryTag && <LabelPill label={primaryTag} size="xs" />}
                          {task.dueDate && (
                            <span
                              className={`flex items-center gap-1 font-mono text-[10px] ${
                                isOverdue ? 'text-danger font-semibold' : 'text-sub'
                              }`}
                            >
                              <Calendar className="w-3 h-3" />
                              <span>{formatTaskDueDate(task.dueDate)}</span>
                            </span>
                          )}
                        </div>

                        <PrioritySignal priority={task.priority} size="sm" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onOpenCreateTaskWithState(col.id)}
                  className="mt-2.5 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-edge/80 py-1.5 px-2.5 text-xs text-sub hover:border-info hover:text-info hover:bg-hover transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{tr("tasks:kanbanView.createATaskIn", { value0: col.title }) || "New work item"}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
