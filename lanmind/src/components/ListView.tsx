import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TaskCreateButton } from './TaskCreateButton';
import { Task, Project, User, Priority, TaskStatus } from '../types';
import { expandTaskOccurrences, formatRecurrenceLabel } from '../utils/recurrence';
import { formatTaskDueDate, parseTaskDateTime } from '../utils/taskDateTime';
import { filterTasksByLayout, ProjectLayout, useTaskLayout } from '../utils/taskLayout';
import { TaskFilterButton } from './TaskFilterButton';
import { ThemeCheckbox } from './ThemeCheckbox';
import {
  CheckCircle2,
  Circle,
  AlertOctagon,
  Clock,
  User as UserIcon,
  Trash2,
  Edit2,
  Folder,
  Tag,
  ChevronDown,
  ChevronUp,
  Share2,
  CheckSquare,
  Repeat,
  Calendar,
  X,
  Paperclip,
  Pin,
  Layers3,
  Link2,
  MoreHorizontal,
  Copy,
  History,
  ListChecks,
} from 'lucide-react';
import { FilePreviewModal } from './FilePreviewModal';
import { downloadFile, formatFileSize } from '../utils/fileTransfer';
import { copyTaskReference, taskReferenceMarkdown, taskReferenceUrl } from '../utils/taskLinks';
import { canWriteTask } from '../utils/taskPermissions';
import { markdownWithChecklist, reconcileTaskChecklist } from '../utils/taskChecklist';

const PRIORITY_ORDER: Record<Priority, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };
const PRIORITY_LABELS: Record<Priority, string> = {
  P1: '紧急重要',
  P2: '重要',
  P3: '普通',
  P4: '低优',
};
const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '已阻塞',
  abandoned: '已放弃',
};

interface ListViewProps {
  tasks: Task[];
  allTasks?: Task[];
  projects: Project[];
  users: User[];
  currentUser: User;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onOpenCreateTask: () => void;
  onOpenEditTask: (task: Task) => void;
  searchQuery: string;
  selectedProjectId: string | null;
  dateFilter?: string | null;
  onClearDateFilter?: () => void;
  projectLayout?: ProjectLayout;
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
  onUpdateTask,
  onDeleteTask,
  onOpenCreateTask,
  onOpenEditTask,
  searchQuery,
  selectedProjectId,
  dateFilter = null,
  onClearDateFilter,
  projectLayout,
  viewTitle = '全部任务',
  onDuplicateTask,
  onOpenTaskActivity,
  readOnly = false,
}) => {
  const { layout: globalLayout, updateLayout: updateGlobalLayout } = useTaskLayout(currentUser.id, null);
  const { showCompleted, groupMode, sortMode } = projectLayout ?? globalLayout;
  const [pinnedTaskIds, setPinnedTaskIds] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(`lanmind_task_pins:${currentUser.id}`) || '[]'));
    } catch {
      return new Set();
    }
  });
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<any | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

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
      setPinnedTaskIds(new Set(JSON.parse(localStorage.getItem(`lanmind_task_pins:${currentUser.id}`) || '[]')));
    } catch {
      setPinnedTaskIds(new Set());
    }
  }, [currentUser.id]);

  const filteredTasks = projectLayout ? tasks : filterTasksByLayout(tasks, globalLayout, searchQuery).filter((task) => {
    if (selectedProjectId && task.projectId !== selectedProjectId) return false;
    return !dateFilter || task.dueDate?.slice(0, 10) === dateFilter
      || expandTaskOccurrences(task, dateFilter, dateFilter).length > 0;
  });

  const taskGroupLabel = (task: Task) => {
    if (pinnedTaskIds.has(task.id)) return '置顶';
    if (groupMode === 'priority') return `${task.priority} · ${PRIORITY_LABELS[task.priority]}`;
    if (groupMode === 'status') return STATUS_LABELS[task.status];
    if (groupMode === 'tag') return task.tags?.[0] ? `#${task.tags[0]}` : '无标签';
    if (groupMode === 'assignee') return users.find((user) => user.id === task.assigneeId)?.nickname || task.assigneeId || '未分配';
    if (groupMode === 'date') {
      if (!task.dueDate) return '未排期';
      const date = task.dueDate.slice(0, 10);
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
      if (date < todayKey && task.status !== 'completed') return '已逾期';
      if (date === todayKey) return '今天';
      if (date === tomorrowKey) return '明天';
      return date;
    }
    return '';
  };

  const sortedTasks = useMemo(() => {
    const compareValue = (left: Task, right: Task) => {
      if (sortMode === 'dueDate') return (left.dueDate || '9999-12-31').localeCompare(right.dueDate || '9999-12-31');
      if (sortMode === 'priority') return PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
      if (sortMode === 'createdAt') return right.createdAt.localeCompare(left.createdAt);
      if (sortMode === 'updatedAt') return right.updatedAt.localeCompare(left.updatedAt);
      if (sortMode === 'title') return left.title.localeCompare(right.title, 'zh-CN');
      return 0;
    };
    return filteredTasks.filter((task) => !task.parentTaskId).sort((left, right) => {
      const leftPinned = pinnedTaskIds.has(left.id);
      const rightPinned = pinnedTaskIds.has(right.id);
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      if (groupMode !== 'none') {
        const groupCompare = taskGroupLabel(left).localeCompare(taskGroupLabel(right), 'zh-CN');
        if (groupCompare !== 0) return groupCompare;
      }
      return compareValue(left, right);
    });
  }, [filteredTasks, groupMode, pinnedTaskIds, sortMode, users]);
  const pinnedCount = sortedTasks.filter((task) => pinnedTaskIds.has(task.id)).length;

  const togglePinned = (taskId: string) => {
    setPinnedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      localStorage.setItem(`lanmind_task_pins:${currentUser.id}`, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const getPriorityBadge = (p: Priority) => {
    switch (p) {
      case 'P1':
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-500/10 text-danger border border-rose-500/30 rounded">P1 紧急</span>;
      case 'P2':
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/10 text-warning border border-amber-500/30 rounded">P2 重要</span>;
      case 'P3':
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-500/10 text-info border border-blue-500/30 rounded">P3 普通</span>;
      case 'P4':
        return <span className="px-2 py-0.5 text-[10px] font-bold bg-card text-sub border border-subtle rounded">P4 低优</span>;
    }
  };

  const getStatusIcon = (status: TaskStatus, interactive = true) => {
    const interactionClass = interactive
      ? 'cursor-pointer hover:scale-110 transition-transform'
      : 'cursor-not-allowed opacity-60';
    switch (status) {
      case 'completed':
        return <CheckCircle2 className={`h-5 w-5 text-success ${interactionClass}`} />;
      case 'in_progress':
        return <Clock className={`h-5 w-5 text-info ${interactionClass} ${interactive ? 'animate-pulse' : ''}`} />;
      case 'blocked':
        return <AlertOctagon className={`h-5 w-5 text-danger ${interactionClass}`} />;
      case 'abandoned':
        return <X className={`h-5 w-5 text-quiet ${interactionClass}`} />;
      default:
        return <Circle className={`h-5 w-5 text-quiet ${interactionClass} ${interactive ? 'hover:text-info' : ''}`} />;
    }
  };

  const handleToggleStatus = (task: Task) => {
    const statusCycle: Record<TaskStatus, TaskStatus> = {
      todo: 'in_progress',
      in_progress: 'completed',
      completed: 'todo',
      blocked: 'in_progress',
      abandoned: 'todo',
    };
    onUpdateTask(task.id, { status: statusCycle[task.status] });
  };

  const copyTaskLink = async (task: Task) => {
    try {
      await copyTaskReference(task);
    } catch {
      window.prompt('复制任务链接', taskReferenceMarkdown(task, taskReferenceUrl(task)));
    }
    setOpenActionMenuId(null);
  };

  const getTaskAttachments = (task: Task) => {
    if (task.attachments?.length) return task.attachments;
    try {
      const saved = JSON.parse(localStorage.getItem(`lanmind_task_attachments:${task.id}`) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  };

  return (
    <div className="flex-1 flex min-h-0 flex-col bg-canvas text-main">
      {!selectedProjectId && <div className="task-list-toolbar shrink-0 border-b border-edge bg-surface px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {!selectedProjectId && <h2 className="truncate text-base font-semibold text-main">{viewTitle}</h2>}
          {dateFilter && (
            <button
              type="button"
              onClick={onClearDateFilter}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 px-2.5 text-xs font-medium text-info transition-colors hover:bg-blue-500/20"
              title="清除日期筛选"
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>{dateFilter} 的任务</span>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="hidden shrink-0 sm:flex items-center gap-1.5 text-xs text-sub">
            <span>共 <strong className="text-main">{sortedTasks.length}</strong> 项</span>
            {!selectedProjectId && <>
              <span className="text-quiet">·</span>
              <span className="text-success">已完成 {tasks.filter(t => t.status === 'completed').length}</span>
            </>}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {!readOnly && <TaskCreateButton onClick={onOpenCreateTask} />}
          {!selectedProjectId && <TaskFilterButton tasks={tasks} layout={globalLayout} onLayoutChange={updateGlobalLayout} />}
        </div>
      </div>}

      {/* Task List Items Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
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
                <h3 className="text-sm font-semibold text-sub">{projectLayout ? '当前条件下暂无任务' : '暂无任务'}</h3>
                {!projectLayout && <p className="text-xs text-quiet mt-1 max-w-xs leading-relaxed">
                  创建您的第一个任务，开启高效协同之旅。
                </p>}
                {!readOnly && !selectedProjectId && <TaskCreateButton onClick={onOpenCreateTask} className="mt-4" />}
              </>
            ) : !showCompleted && tasks.every(t => t.status === 'completed') ? (
              <>
                <h3 className="text-sm font-semibold text-sub">🎉 所有任务已完成</h3>
                <p className="text-xs text-quiet mt-1 max-w-xs leading-relaxed">
                  太棒了！当前列表中的全部任务均已完成。您可以查看已完成任务或继续创建新任务。
                </p>
                <div className="flex items-center gap-2 mt-4">
                  <button
                    onClick={() => updateGlobalLayout({ showCompleted: true })}
                    className="px-4 py-1.5 text-xs font-semibold rounded-lg border border-subtle bg-card text-sub hover:bg-hover hover:text-main transition-colors"
                  >
                    <span>查看已完成</span>
                  </button>
                  {!readOnly && !selectedProjectId && <TaskCreateButton onClick={onOpenCreateTask} />}
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-sub">暂无符合条件的任务</h3>
                <p className="text-xs text-quiet mt-1 max-w-xs leading-relaxed">
                  您可以使用顶部搜索框调整筛选条件，或者直接创建新任务开启协同。
                </p>
                {!readOnly && !selectedProjectId && <TaskCreateButton onClick={onOpenCreateTask} className="mt-4" />}
              </>
            )}
          </div>
        ) : (
          sortedTasks.map((task, taskIndex) => {
            const project = projects.find((p) => p.id === task.projectId);
            const assignee = users.find((u) => u.id === task.assigneeId);
            const isExpanded = expandedTaskId === task.id;
            const canEdit = !readOnly && Boolean(
              task.creatorId === currentUser.id ||
                task.assigneeId === currentUser.id ||
                (task.projectId &&
                  task.isShared &&
                  Boolean(
                    project &&
                      (project.createdBy === currentUser.id ||
                        project.admins.includes(currentUser.id) ||
                        project.members.includes(currentUser.id)),
                  )) ||
                (!task.isShared && task.sharedWith.includes(currentUser.id)),
            );

            const content = reconcileTaskChecklist(task.description || '', task.subtasks || []);
            const subtasks = content.subtasks;
            const tags = task.tags || [];
            const completedSubCount = subtasks.filter((s) => s.completed).length;
            const totalSubCount = subtasks.length;
            const attachments = getTaskAttachments(task);
            const childTasks = allTasks.filter((candidate) => candidate.parentTaskId === task.id);
            const currentGroupLabel = taskGroupLabel(task);
            const previousGroupLabel = taskIndex > 0 ? taskGroupLabel(sortedTasks[taskIndex - 1]) : null;
            const isPinned = pinnedTaskIds.has(task.id);
            const showPinnedDivider = !isPinned && taskIndex > 0 && pinnedTaskIds.has(sortedTasks[taskIndex - 1].id);
            const showGroupHeader = showPinnedDivider || ((groupMode !== 'none' || isPinned) && currentGroupLabel !== previousGroupLabel);

            return (
              <React.Fragment key={task.id}>
              {showPinnedDivider && <div role="separator" aria-label="置顶任务与其他任务分隔线" className="mt-5 border-t border-subtle pt-2" />}
              {showGroupHeader && (
                <div className="flex items-center gap-2 px-1 pb-0.5 pt-2 text-[11px] font-semibold text-sub">
                  {isPinned ? <Pin className="h-3.5 w-3.5 text-warning" /> : <Layers3 className="h-3.5 w-3.5 text-info" />}
                  <span className={isPinned ? 'text-main' : undefined}>{isPinned ? '置顶任务' : groupMode === 'none' ? '其他任务' : currentGroupLabel}</span>
                  {isPinned && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">{pinnedCount}</span>}
                  <span className="h-px flex-1 bg-edge" />
                </div>
              )}
              <div
                className={`theme-glow-card rounded-xl p-3.5 transition-all ${
                  task.status === 'completed'
                    ? 'border-edge/60 bg-surface/40 opacity-75'
                    : task.status === 'abandoned'
                    ? 'border-edge/60 bg-canvas/40 opacity-60'
                    : task.status === 'blocked'
                    ? 'border-rose-500/30 bg-danger/10'
                    : 'border-edge'
                }`}
              >
                {/* Task Row Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start space-x-3 flex-1 min-w-0">
                    {/* Status Check Toggle */}
                    <div
                      className={`pt-0.5 ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                      onClick={() => canEdit && handleToggleStatus(task)}
                      title={canEdit ? '切换任务状态' : '当前任务只读'}
                    >
                      {getStatusIcon(task.status, canEdit)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <button type="button" onClick={() => onOpenEditTask(task)}
                          className={`min-w-0 break-words text-left text-sm font-medium hover:text-info ${
                            task.status === 'completed' ? 'line-through text-sub' : 'text-main'
                          }`}
                        >
                          {task.title}
                        </button>

                        {getPriorityBadge(task.priority)}

                        {project && (
                          <span
                            className="px-2 py-0.5 text-[10px] rounded font-medium flex items-center space-x-1 text-main max-w-[200px] shrink-0"
                            style={{ backgroundColor: `${project.color}20` }}
                            title={project.name}
                          >
                            <Folder className="w-3 h-3 shrink-0" style={{ color: project.color }} />
                            <span className="truncate">{project.name}</span>
                          </span>
                        )}

                        {task.isShared && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/10 text-feature border border-purple-500/20 rounded flex items-center space-x-1">
                            <Share2 className="w-3 h-3" />
                            <span>{task.projectId ? '项目组共享' : '局域网共享'}</span>
                          </span>
                        )}
                        {task.isShared && !canEdit && (
                          <span className="rounded border border-subtle bg-card px-1.5 py-0.5 text-[10px] text-sub">
                            只读
                          </span>
                        )}

                        {task.recurrence && task.recurrence !== 'none' && (
                          <span className="px-1.5 py-0.5 text-[10px] bg-cyan-500/10 text-info border border-cyan-500/20 rounded flex items-center space-x-1 font-medium">
                            <Repeat className="w-3 h-3 text-info" />
                            <span>{formatRecurrenceLabel(task.recurrence, task.recurrenceRule, task.dueDate)}</span>
                          </span>
                        )}
                        {task.parentTaskId && <span className="inline-flex items-center gap-1 rounded border border-subtle bg-card px-1.5 py-0.5 text-[10px] text-sub"><Link2 className="h-3 w-3" />子任务</span>}
                      </div>

                      {/* Description Preview */}
                      {task.description && (
                        <p className="text-xs text-sub mt-1 line-clamp-2">{task.description}</p>
                      )}

                      {/* Tags & Subtask Meter */}
                      <div className="flex items-center space-x-4 mt-2 text-[11px] text-sub flex-wrap gap-y-1">
                        {task.dueDate && (
                          <span
                            className={`flex items-center space-x-1 font-mono ${
                              (parseTaskDateTime(task.dueDate)?.getTime() || 0) < Date.now() && task.status !== 'completed'
                                ? 'text-danger font-bold'
                                : 'text-sub'
                            }`}
                          >
                            <Clock className="w-3 h-3" />
                            <span>到期: {formatTaskDueDate(task.dueDate)}</span>
                          </span>
                        )}

                        {assignee && (
                          <span className="flex items-center space-x-1">
                            <UserIcon className="w-3 h-3 text-info" />
                            <span>指派人: {assignee.nickname}</span>
                          </span>
                        )}

                        {totalSubCount > 0 && (
                          <span className="flex items-center space-x-1 text-sub">
                            <CheckSquare className="w-3 h-3 text-success" />
                            <span>
                              检查事项: {completedSubCount}/{totalSubCount}
                            </span>
                          </span>
                        )}
                        {childTasks.length > 0 && <span className="flex items-center gap-1 text-sub"><Layers3 className="h-3 w-3 text-info" />子任务 {childTasks.filter((child) => child.status === 'completed').length}/{childTasks.length}</span>}
                        {(task.progress ?? 0) > 0 && task.status !== 'completed' && task.status !== 'abandoned' && (
                          <span className="inline-flex items-center gap-1.5 text-info"><span className="task-progress-track" role="progressbar" aria-label={`${task.title}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress ?? 0}><span className="block h-full rounded-full bg-info" style={{ width: `${task.progress ?? 0}%` }} /></span>{task.progress ?? 0}%</span>
                        )}

                        {tags.map((tg) => (
                          <span key={tg} className="text-[10px] bg-card text-sub px-1.5 py-0.5 rounded border border-subtle/60">
                            #{tg}
                          </span>
                        ))}
                        {attachments.length > 0 && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 text-info border border-blue-500/30 dark:bg-blue-500/20 dark:text-info dark:border-blue-400/30 transition-all hover:bg-blue-500/25"
                            title={`此任务包含 ${attachments.length} 个附件`}
                          >
                            <Paperclip className="w-3.5 h-3.5 text-info shrink-0" strokeWidth={2.2} />
                            <span>{attachments.length} 个附件</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions Right */}
                  <div className="flex items-center space-x-1.5">
                    <button onClick={() => togglePinned(task.id)} className={`p-1.5 transition-colors hover:bg-hover ${pinnedTaskIds.has(task.id) ? 'text-warning' : 'text-sub hover:text-main'}`} title={pinnedTaskIds.has(task.id) ? '取消置顶' : '置顶任务'} aria-label={pinnedTaskIds.has(task.id) ? '取消置顶任务' : '置顶任务'}><Pin className="h-3.5 w-3.5" /></button>
                    {(childTasks.length > 0 || subtasks.length > 0) && <button
                      onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                      className="p-1.5 text-sub hover:text-main hover:bg-hover rounded transition-colors"
                      title={childTasks.length > 0 ? (isExpanded ? '收起子任务及检查事项' : '展开子任务及检查事项') : (isExpanded ? '收起检查事项' : '展开检查事项')}
                      aria-label={childTasks.length > 0 ? (isExpanded ? '收起子任务' : '展开子任务') : (isExpanded ? '收起检查事项' : '展开检查事项')}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>}
                    {(
                      <>
                        {canEdit && <button
                          onClick={() => onOpenEditTask(task)}
                          className="p-1.5 text-sub transition-colors hover:bg-hover hover:text-info"
                          title="编辑任务"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>}
                        <div ref={openActionMenuId === task.id ? actionMenuRef : undefined} className="relative">
                          <button
                            type="button"
                            onClick={() => setOpenActionMenuId((current) => current === task.id ? null : task.id)}
                            className="p-1.5 text-sub transition-colors hover:bg-hover hover:text-main"
                            title="更多操作"
                            aria-label="更多操作"
                            aria-haspopup="menu"
                            aria-expanded={openActionMenuId === task.id}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                          {openActionMenuId === task.id && (
                            <div role="menu" aria-label={`${task.title}更多操作`} className="absolute right-0 top-8 z-20 min-w-44 rounded-xl border border-edge bg-surface p-1.5 shadow-popover">
                              <button
                                type="button"
                                onClick={() => void copyTaskLink(task)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-sub hover:bg-hover hover:text-main"
                              >
                                <Link2 className="h-3.5 w-3.5" /> 复制任务链接
                              </button>
                              {canEdit && <button
                                type="button"
                                onClick={() => { onDuplicateTask?.(task); setOpenActionMenuId(null); }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-sub hover:bg-hover hover:text-main"
                              >
                                <Copy className="h-3.5 w-3.5" /> 创建副本
                              </button>}
                              <button
                                type="button"
                                onClick={() => { onOpenTaskActivity?.(task); setOpenActionMenuId(null); }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-sub hover:bg-hover hover:text-main"
                              >
                                <History className="h-3.5 w-3.5" /> 查看任务动态
                              </button>
                              {canEdit && <button
                                type="button"
                                onClick={() => { onUpdateTask(task.id, { status: task.status === 'abandoned' ? 'todo' : 'abandoned' }); setOpenActionMenuId(null); }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-sub hover:bg-hover hover:text-main"
                              >
                                <X className="h-3.5 w-3.5" /> {task.status === 'abandoned' ? '恢复任务' : '放弃任务'}
                              </button>}
                              {canEdit && <><div className="my-1 border-t border-edge" />
                              <button type="button" onClick={() => { setOpenActionMenuId(null); onDeleteTask(task.id); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-danger hover:bg-hover"><Trash2 className="h-3.5 w-3.5" />删除任务</button></>}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Independent child tasks and Markdown checklist items share an accordion. */}
                {isExpanded && (
                  <div className="mt-3 space-y-3 border-t border-edge/80 pt-3">
                    {childTasks.length > 0 && <section aria-label={`子任务：${task.title}`} className="space-y-2">
                    <div className="text-xs font-semibold text-sub flex items-center justify-between">
                      <span>子任务 ({childTasks.filter((child) => child.status === 'completed').length}/{childTasks.length})</span>
                    </div>

                    <div className="space-y-1.5">
                      {childTasks.map((child) => (
                        <div key={child.id} className="flex items-center gap-2 border-b border-edge px-2 py-2 text-xs">
                          <ThemeCheckbox
                            checked={child.status === 'completed'}
                            onChange={(checked) => onUpdateTask(child.id, { status: checked ? 'completed' : 'todo', progress: checked ? 100 : 0 })}
                            disabled={readOnly || !canWriteTask(child, currentUser.id, projects)}
                            size="sm"
                            ariaLabel={`标记完成子任务：${child.title}`}
                          />
                          <button type="button" onClick={() => onOpenEditTask(child)} className={`min-w-0 flex-1 truncate text-left hover:text-info ${child.status === 'completed' ? 'line-through text-quiet' : 'text-main'}`}>{child.title}</button>
                          <span className="shrink-0 text-[10px] text-quiet">{STATUS_LABELS[child.status]}</span>
                          <span className="hidden shrink-0 text-[10px] text-sub sm:inline">{users.find((user) => user.id === child.assigneeId)?.nickname || child.assigneeId}</span>
                        </div>
                      ))}
                    </div>
                    </section>}
                    {subtasks.length > 0 && <section aria-label={`检查事项：${task.title}`} className="space-y-2">
                      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-sub"><ListChecks className="h-3.5 w-3.5 text-info" />检查事项 ({completedSubCount}/{totalSubCount})</h4>
                      <div className="space-y-1.5">{subtasks.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-md bg-canvas/60 px-2 py-2 text-xs">
                        <ThemeCheckbox checked={item.completed} disabled={!canEdit} size="sm" ariaLabel={`标记完成检查事项：${item.title}`} onChange={(checked) => {
                          const next = subtasks.map((candidate) => candidate.id === item.id ? { ...candidate, completed: checked } : candidate);
                          onUpdateTask(task.id, { subtasks: next, description: markdownWithChecklist(content.description, subtasks, next) });
                        }} />
                        <span className={`min-w-0 flex-1 break-words ${item.completed ? 'text-quiet line-through' : 'text-main'}`}>{item.title}</span>
                      </div>)}</div>
                    </section>}
                    {attachments.length > 0 && (
                      <div className="mt-3 border-t border-edge/80 pt-3">
                        <div className="mb-2 text-xs font-semibold text-sub flex items-center gap-1.5">
                          <Paperclip className="h-3.5 w-3.5 text-info shrink-0" strokeWidth={2.2} />
                          <span>附件清单 ({attachments.length})</span>
                        </div>
                        <div className="space-y-1.5">
                          {attachments.map((file: any) => (
                            <div
                              key={file.id}
                              className="flex items-center justify-between rounded-lg border border-edge bg-surface/60 px-2.5 py-2 text-xs text-sub transition-colors hover:border-subtle"
                            >
                              <button
                                type="button"
                                onClick={() => setPreviewAttachment(file)}
                                className="flex min-w-0 items-center gap-1.5 truncate text-left font-mono hover:text-info transition-colors"
                                title="点击在线预览"
                              >
                                <Paperclip className="h-3.5 w-3.5 text-info shrink-0" strokeWidth={2} />
                                <span className="truncate">{file.name}</span>
                              </button>
                              <div className="ml-2 flex flex-shrink-0 items-center gap-2.5">
                                <span className="text-[10px] text-quiet font-mono">
                                  {formatFileSize(file.size)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => downloadFile(file.dataUrl, file.name)}
                                  className="text-[10px] font-medium text-info hover:text-info hover:underline transition-colors"
                                  title="下载此附件"
                                >
                                  下载
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              </React.Fragment>
            );
          })
        )}
      </div>
      {previewAttachment && <FilePreviewModal name={previewAttachment.name} type={previewAttachment.type} dataUrl={previewAttachment.dataUrl} onClose={() => setPreviewAttachment(null)} />}
    </div>
  );
};
