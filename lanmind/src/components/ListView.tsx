import { scopedStorageKey } from "../utils/workspaceContext";
import { currentLocale } from "../i18n/core";
import { tr, useLocale } from "../i18n";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TaskCreateButton } from './TaskCreateButton';
import { Task, Project, User, Priority, WorkItemState, TaskAttachment } from '../types';
import { expandTaskOccurrences } from '../utils/recurrence';
import { compareTasks, filterTasksByLayout, ProjectLayout, useTaskLayout, useTaskToday } from '../utils/taskLayout';
import {
  defaultStateFor,
  isCompleted,
  isCancelled,
  resolveTaskStateName,
  sortStates,
} from '../utils/workItemState';
import { TaskFilterButton } from './TaskFilterButton';
import { TaskFilterSummary } from './TaskFilterSummary';
import { TaskListCard } from './task/TaskListCard';
import { Trash2, Edit2, Calendar, X, Pin, Layers3, Link2, MoreHorizontal, Copy, History, CheckSquare, Search } from 'lucide-react';
import { FilePreviewModal } from './FilePreviewModal';
import { copyTaskReference, taskReferenceMarkdown, taskReferenceUrl } from '../utils/taskLinks';
import { canWriteTask } from '../utils/taskPermissions';

const PRIORITY_LABELS: Record<Priority, string> = {
  get P1() { return tr("tasks:listView.urgent"); },
  get P2() { return tr("tasks:listView.high"); },
  get P3() { return tr("tasks:listView.normal"); },
  get P4() { return tr("tasks:listView.low"); },
};

interface ListViewProps {
  tasks: Task[];
  allTasks?: Task[];
  projects: Project[];
  users: User[];
  currentUser: User;
  /** 当前作用域的状态列表。为空时按状态组回退渲染。 */
  states?: WorkItemState[];
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onOpenCreateTask: () => void;
  onOpenEditTask: (task: Task) => void;
  searchQuery: string;
  onSearchChange?: (query: string) => void;
  selectedProjectId: string | null;
  dateFilter?: string | null;
  onClearDateFilter?: () => void;
  projectLayout?: ProjectLayout;
  onLayoutChange?: (patch: Partial<ProjectLayout>) => void;
  viewTitle?: string;
  onDuplicateTask?: (task: Task) => void;
  onOpenTaskActivity?: (task: Task) => void;
  readOnly?: boolean;
}

export const ListView: React.FC<ListViewProps> = ({
  tasks,
  allTasks = tasks,
  projects,
  users,
  currentUser,
  states = [],
  onUpdateTask,
  onDeleteTask,
  onOpenCreateTask,
  onOpenEditTask,
  searchQuery,
  onSearchChange,
  selectedProjectId,
  dateFilter = null,
  onClearDateFilter,
  projectLayout,
  onLayoutChange,
  viewTitle = tr("tasks:listView.allTasks"),
  onDuplicateTask,
  onOpenTaskActivity,
  readOnly = false,
}) => {
  useLocale();
  const { layout: globalLayout, updateLayout: updateGlobalLayout } = useTaskLayout(currentUser.id, null);
  const layout = projectLayout ?? globalLayout;
  const updateLayout = projectLayout ? onLayoutChange : updateGlobalLayout;
  const { showCompleted, groupMode } = layout;
  const today = useTaskToday();
  const [pinnedTaskIds, setPinnedTaskIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(scopedStorageKey(`lanmind_task_pins:${currentUser.id}`)) || '[]'));
    } catch {
      return new Set();
    }
  });
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<TaskAttachment | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [actionMenuPlacement, setActionMenuPlacement] = useState<'down' | 'up'>('down');
  const [actionMenuMaxHeight, setActionMenuMaxHeight] = useState<number | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  const toggleActionMenu = (taskId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (openActionMenuId === taskId) {
      setOpenActionMenuId(null);
      return;
    }
    const button = e.currentTarget;
    const rect = button.getBoundingClientRect();
    const scrollParent = button.closest('.overflow-y-auto') as HTMLElement | null;
    const bottomBoundary = scrollParent
      ? Math.min(window.innerHeight, scrollParent.getBoundingClientRect().bottom)
      : window.innerHeight;
    const topBoundary = scrollParent ? Math.max(0, scrollParent.getBoundingClientRect().top) : 0;
    const spaceBelow = bottomBoundary - rect.bottom - 6;
    const spaceAbove = rect.top - topBoundary - 6;
    const openUp = spaceBelow < 320 && spaceAbove > spaceBelow;
    setActionMenuPlacement(openUp ? 'up' : 'down');
    setActionMenuMaxHeight(Math.max(48, Math.floor(openUp ? spaceAbove : spaceBelow)));
    setOpenActionMenuId(taskId);
  };

  useEffect(() => {
    if (!openActionMenuId) return;
    const outside = (event: PointerEvent) => {
      if (!actionMenuRef.current?.contains(event.target as Node)) setOpenActionMenuId(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        actionMenuRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus();
        setOpenActionMenuId(null);
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [openActionMenuId]);

  useEffect(() => {
    if (dateFilter) updateGlobalLayout({ showCompleted: true });
  }, [dateFilter, currentUser.id]);

  useEffect(() => {
    try {
      setPinnedTaskIds(new Set(JSON.parse(localStorage.getItem(scopedStorageKey(`lanmind_task_pins:${currentUser.id}`)) || '[]')));
    } catch {
      setPinnedTaskIds(new Set());
    }
  }, [currentUser.id]);

  const filteredTasks = filterTasksByLayout(tasks, layout, searchQuery, new Date(today + 'T12:00:00')).filter((task) => {
    if (selectedProjectId && task.projectId !== selectedProjectId) return false;
    return !dateFilter || task.dueDate?.slice(0, 10) === dateFilter
      || expandTaskOccurrences(task, dateFilter, dateFilter).length > 0;
  });

  const taskGroupLabel = (task: Task) => {
    if (pinnedTaskIds.has(task.id)) return tr("tasks:listView.pin");
    if (groupMode === 'priority') return `${task.priority} · ${PRIORITY_LABELS[task.priority]}`;
    if (groupMode === 'status') return resolveTaskStateName(task, states);
    if (groupMode === 'tag') return task.tags?.[0] ? `#${task.tags[0]}` : tr("tasks:listView.noTags");
    if (groupMode === 'assignee') return users.find((user) => user.id === task.assigneeId)?.nickname || task.assigneeId || tr("tasks:listView.unassigned");
    if (groupMode === 'date') {
      if (!task.dueDate) return tr("tasks:listView.unscheduled");
      const date = task.dueDate.slice(0, 10);
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
      if (date < todayKey && !isCompleted(task, states) && !isCancelled(task, states)) return tr("tasks:listView.overdue");
      if (date === todayKey) return tr("tasks:listView.today");
      if (date === tomorrowKey) return tr("tasks:listView.tomorrow");
      return date;
    }
    return '';
  };

  const sortedTasks = useMemo(() => {
    return filteredTasks.filter((task) => !task.parentTaskId).sort((left, right) => {
      const leftPinned = pinnedTaskIds.has(left.id);
      const rightPinned = pinnedTaskIds.has(right.id);
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      if (groupMode !== 'none') {
        const groupCompare = taskGroupLabel(left).localeCompare(taskGroupLabel(right), currentLocale());
        if (groupCompare !== 0) return groupCompare;
      }
      return compareTasks(left, right, layout);
    });
  }, [filteredTasks, groupMode, pinnedTaskIds, layout, users, currentLocale()]);
  const pinnedCount = sortedTasks.filter((task) => pinnedTaskIds.has(task.id)).length;
  const totalTaskCount = tasks.filter((task) => !task.parentTaskId).length;
  const childrenByTask = useMemo(() => {
    const result = new Map<string, Task[]>();
    for (const task of allTasks) {
      if (!task.parentTaskId) continue;
      const children = result.get(task.parentTaskId) || [];
      children.push(task);
      result.set(task.parentTaskId, children);
    }
    return result;
  }, [allTasks]);

  const togglePinned = (taskId: string) => {
    setPinnedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      localStorage.setItem(scopedStorageKey(`lanmind_task_pins:${currentUser.id}`), JSON.stringify(Array.from(next)));
      return next;
    });
  };

  /**
   * 点击状态图标时在状态列表里前进一步。
   * 按任务所属项目的自定义状态顺序推进；缺少状态定义时不写入。
   */
  const handleAdvanceState = (task: Task) => {
    const ordered = sortStates(states.filter((state) => (state.projectId ?? null) === (task.projectId ?? null)));
    const currentIndex = ordered.findIndex((state) => state.id === task.stateId);
    const next = ordered[(currentIndex + 1) % ordered.length];
    if (next) onUpdateTask(task.id, { stateId: next.id });
  };

  /**
   * 在「已取消」与「未开始」之间切换。
   * 目标状态取自当前作用域的状态列表；列表缺失时不写入，避免产生无效引用。
   */
  const toggleAbandoned = (task: Task) => {
    const projectId = task.projectId ?? null;
    const target = isCancelled(task, states)
      ? defaultStateFor(states, projectId, 'unstarted')
      : defaultStateFor(states, projectId, 'cancelled');
    if (target) onUpdateTask(task.id, { stateId: target.id });
  };

  const copyTaskLink = async (task: Task) => {
    try {
      await copyTaskReference(task);
    } catch {
      window.prompt(tr("tasks:listView.copyTaskLink"), taskReferenceMarkdown(task, taskReferenceUrl(task)));
    }
    setOpenActionMenuId(null);
  };

  const getTaskAttachments = (task: Task): TaskAttachment[] => {
    if (task.attachments?.length) return task.attachments;
    try {
      const saved = JSON.parse(localStorage.getItem(scopedStorageKey(`lanmind_task_attachments:${task.id}`)) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  };

  return (
    <div className="task-list-view flex-1 flex min-h-0 min-w-0 flex-col bg-canvas text-main">
      {!selectedProjectId && <div className="task-list-toolbar shrink-0 border-b border-edge bg-surface px-4 py-3 flex items-center justify-between gap-3">
        <div className="task-list-heading flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {!selectedProjectId && <h2 className="truncate text-base font-semibold text-main">{viewTitle}</h2>}
          {dateFilter && (
            <button
              type="button"
              onClick={onClearDateFilter}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 px-2.5 text-xs font-medium text-info transition-colors hover:bg-blue-500/20"
              title={tr("tasks:listView.clearDateFilter")}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>{tr("tasks:listView.tasksFor", { value0: dateFilter })}</span>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="task-list-count flex flex-wrap items-center gap-1.5 text-xs text-sub" role="status">
            <span>{sortedTasks.length !== totalTaskCount
              ? tr('tasks:listCard.visibleCount', { count: sortedTasks.length, total: totalTaskCount })
              : <>{tr("tasks:listView.total")}<strong className="text-main">{sortedTasks.length}</strong> {tr("tasks:listView.items")}</>}</span>
            {!selectedProjectId && <>
              <span className="text-quiet">·</span>
              <span className="text-success">{tr("tasks:listView.completed2", { value0: tasks.filter((t) => !t.parentTaskId && isCompleted(t, states)).length })}</span>
            </>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onSearchChange && (
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-sub pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={tr('tasks:tasks.searchWorkItemsPlaceholder')}
                className="h-8 w-28 md:w-40 rounded-lg border border-subtle bg-card/70 pl-8 pr-7 text-xs text-main placeholder-sub focus:border-accent/50 focus:bg-surface focus:outline-none transition-all shadow-inner"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="absolute right-2 p-0.5 text-sub hover:text-main rounded"
                  title="清除搜索"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {!readOnly && <TaskCreateButton onClick={onOpenCreateTask} />}
          {!selectedProjectId && <TaskFilterButton tasks={tasks} layout={globalLayout} onLayoutChange={updateGlobalLayout} projects={projects} users={users} currentUserId={currentUser.id} activeView="project" />}
        </div>
      </div>}
      <TaskFilterSummary tasks={tasks} layout={layout} onLayoutChange={updateLayout} projects={projects} users={users} currentUserId={currentUser.id} scope={selectedProjectId ? 'project' : 'task'} />

      {/* Task List Items Container */}
      <div className="task-list-scroll flex-1 overflow-y-auto">
        {sortedTasks.length === 0 ? (
          <div className="text-center py-16 theme-glow-card rounded-2xl max-w-md mx-auto my-10 p-8 flex flex-col items-center border border-dashed border-subtle/60 shadow-panel">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3 shadow-inner"
              style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
            >
              <CheckSquare className="w-6 h-6" />
            </div>
            {tasks.length === 0 ? (
              <>
                <h3 className="text-sm font-semibold text-sub">{projectLayout ? tr("tasks:listView.noTasksMatchTheseCriteria") : tr("tasks:listView.noTasks")}</h3>
                {!projectLayout && <p className="text-xs text-quiet mt-1 max-w-xs leading-relaxed">
                  {tr("tasks:listView.createYourFirstTask")}</p>}
                {!readOnly && !selectedProjectId && <TaskCreateButton onClick={onOpenCreateTask} className="mt-4" />}
              </>
            ) : !showCompleted && !layout.statusFilter.length && tasks.every((t) => isCompleted(t, states)) ? (
              <>
                <h3 className="text-sm font-semibold text-sub">{tr("tasks:listView.allTasksCompleted")}</h3>
                <p className="text-xs text-quiet mt-1 max-w-xs leading-relaxed">
                  {tr("tasks:listView.allTasksInThisListAreComplete")}</p>
                <div className="flex items-center gap-2 mt-4">
                  <button
                    onClick={() => updateLayout?.({ showCompleted: true })}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg border border-subtle bg-card text-sub hover:bg-hover hover:text-main transition-colors"
                  >
                    <span>{tr("tasks:listView.viewCompleted")}</span>
                  </button>
                  {!readOnly && !selectedProjectId && <TaskCreateButton onClick={onOpenCreateTask} />}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-sub">{tr("tasks:listView.noMatchingTasks")}</h3>
                <p className="text-xs text-quiet mt-1 max-w-xs leading-relaxed">
                  {tr("tasks:listView.adjustYourSearchOrFiltersOrCreate")}</p>
                {!readOnly && !selectedProjectId && <TaskCreateButton onClick={onOpenCreateTask} className="mt-4" />}
              </>
            )}
          </div>
        ) : (
          sortedTasks.map((task, taskIndex) => {
            const project = projects.find((p) => p.id === task.projectId);
            const canEdit = !readOnly && !project?.isArchived && canWriteTask(task, currentUser.id, projects);
            const currentGroupLabel = taskGroupLabel(task);
            const previousGroupLabel = taskIndex > 0 ? taskGroupLabel(sortedTasks[taskIndex - 1]) : null;
            const isPinned = pinnedTaskIds.has(task.id);
            const showPinnedDivider = !isPinned && taskIndex > 0 && pinnedTaskIds.has(sortedTasks[taskIndex - 1].id);
            const showGroupHeader = showPinnedDivider || ((groupMode !== 'none' || isPinned) && currentGroupLabel !== previousGroupLabel);

            return (
              <React.Fragment key={task.id}>
              {showPinnedDivider && <div role="separator" aria-label={tr("tasks:listView.dividerBetweenPinnedAndOtherTasks")} className="mt-5 border-t border-subtle pt-2" />}
              {showGroupHeader && (
                <div className="flex items-center gap-2 px-1 pb-0.5 pt-2 text-[11px] font-semibold text-sub">
                  {isPinned ? <Pin className="h-3.5 w-3.5 text-warning" /> : <Layers3 className="h-3.5 w-3.5 text-info" />}
                  <span className={isPinned ? 'text-main' : undefined}>{isPinned ? tr("tasks:listView.pinnedTasks") : groupMode === 'none' ? tr("tasks:listView.otherTasks") : currentGroupLabel}</span>
                  {isPinned && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">{pinnedCount}</span>}
                  <span className="h-px flex-1 bg-edge" />
                </div>
              )}
              <TaskListCard
                task={task}
                project={project}
                projects={projects}
                users={users}
                currentUser={currentUser}
                states={states}
                childTasks={childrenByTask.get(task.id) || []}
                attachments={getTaskAttachments(task)}
                showProject={!selectedProjectId}
                canEdit={canEdit}
                readOnly={readOnly}
                expanded={expandedTaskId === task.id}
                onToggleExpanded={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                onAdvanceState={() => handleAdvanceState(task)}
                onOpenTask={onOpenEditTask}
                onUpdateTask={onUpdateTask}
                onPreviewAttachment={setPreviewAttachment}
                actions={<>
                  <button
                    type="button"
                    onClick={() => { setOpenActionMenuId(null); togglePinned(task.id); }}
                    className={`task-card-icon-button transition-colors ${isPinned ? 'text-warning' : 'text-sub hover:text-main'}`}
                    title={tr(isPinned ? 'tasks:listView.unpinTask' : 'tasks:listView.pinnedTasks')}
                    aria-label={tr(isPinned ? 'tasks:listView.unpinTask' : 'tasks:listView.pinnedTasks')}
                    aria-pressed={isPinned}
                  ><Pin className="h-3.5 w-3.5" /></button>
                  {canEdit && <button
                    type="button"
                    onClick={() => { setOpenActionMenuId(null); onOpenEditTask(task); }}
                    className="task-card-icon-button text-sub transition-colors hover:text-main"
                    title={tr('tasks:listView.editTask')}
                    aria-label={tr('tasks:listView.editTask')}
                  ><Edit2 className="h-3.5 w-3.5" /></button>}
                  <div ref={openActionMenuId === task.id ? actionMenuRef : undefined} className="relative">
                    <button
                      type="button"
                      onClick={(e) => toggleActionMenu(task.id, e)}
                      className="p-1.5 text-sub transition-colors hover:bg-hover hover:text-main"
                      title={tr("tasks:listView.moreActions")}
                      aria-label={tr("tasks:listView.moreActions")}
                      aria-haspopup="menu"
                      aria-expanded={openActionMenuId === task.id}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                    {openActionMenuId === task.id && (
                      <div
                        role="menu"
                        aria-label={tr("tasks:listView.actions", { value0: task.title })}
                        style={{ maxHeight: actionMenuMaxHeight ?? undefined }}
                        className={`absolute right-0 z-20 min-w-44 overflow-y-auto rounded-xl border border-edge bg-surface/95 backdrop-blur-md p-1.5 shadow-popover animate-in fade-in zoom-in-95 duration-100 select-none ${
                          actionMenuPlacement === 'up'
                            ? 'bottom-full mb-1.5 origin-bottom-right'
                            : 'top-full mt-1.5 origin-top-right'
                        }`}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void copyTaskLink(task)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                        >
                          <Link2 className="h-3.5 w-3.5 text-sub" /> {tr("tasks:listView.copyTaskLink")}</button>
                        {canEdit && <button
                          type="button"
                          role="menuitem"
                          onClick={() => { onDuplicateTask?.(task); setOpenActionMenuId(null); }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                        >
                          <Copy className="h-3.5 w-3.5 text-sub" /> {tr("tasks:listView.duplicateTask")}</button>}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { onOpenTaskActivity?.(task); setOpenActionMenuId(null); }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                        >
                          <History className="h-3.5 w-3.5 text-sub" /> {tr("tasks:listView.viewTaskActivity")}</button>
                        {canEdit && <button
                          type="button"
                          role="menuitem"
                          onClick={() => { toggleAbandoned(task); setOpenActionMenuId(null); }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-main bg-transparent hover:bg-hover focus:bg-hover focus:outline-none transition-colors"
                        >
                          <X className="h-3.5 w-3.5 text-sub" /> {isCancelled(task, states) ? tr("tasks:listView.restoreTask") : tr("tasks:listView.abandonTask")}
                        </button>}
                        {canEdit && <><div className="my-1 border-t border-edge" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setOpenActionMenuId(null); onDeleteTask(task.id); }}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-danger bg-transparent hover:bg-rose-500/10 focus:bg-rose-500/10 focus:outline-none transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                          <span className="font-semibold text-danger">{tr("tasks:listView.deleteTask")}</span>
                        </button></>}
                      </div>
                    )}
                  </div>
                </>}
              />
              </React.Fragment>
            );
          })
        )}
      </div>
      {previewAttachment && <FilePreviewModal name={previewAttachment.name} type={previewAttachment.type} dataUrl={previewAttachment.dataUrl} onClose={() => setPreviewAttachment(null)} />}
    </div>
  );
};
