import { tr, useLocale } from "../i18n";
/**
 * ReportTaskList — Renders matched period tasks with summary metrics, filter controls, and task cards.
 *
 * CALLING SPEC:
 *   <ReportTaskList
 *     tasks={tasks}
 *     projects={projects}
 *     currentUser={currentUser}
 *     title="周期任务清单"
 *     dateRangeLabel="2026-09-23 ~ 2026-09-23"
 *     emptyMessage="当前周期内暂无任务记录"
 *   />
 */

import React, { useMemo, useState } from 'react';
import { PriorityFlag } from './PriorityFlag';
import { Project, ReportSourceTask, Task, User } from '../types';
import { calculateTaskStats, TASK_STATUS_META } from '../utils/reportDateRange';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  ListChecks,
  Search,
  FolderKanban,
  User as UserIcon,
  Tag as TagIcon,
  X,
} from 'lucide-react';

export interface ReportTaskListProps {
  tasks: Array<Task | ReportSourceTask>;
  projects: Project[];
  currentUser: User;
  title?: string;
  dateRangeLabel?: string;
  emptyMessage?: string;
  emptyHint?: string;
  testId?: string;
}

type StatusFilter = 'done' | 'in_progress' | 'blocked' | 'todo';
type DateFilter = 'today' | 'tomorrow';
type PriorityFilter = 'P1' | 'P2' | 'P3' | 'P4';

export const ReportTaskList: React.FC<ReportTaskListProps> = ({
  tasks,
  projects,
  currentUser,
  title,
  dateRangeLabel,
  emptyMessage = tr("reports:reportTaskList.noSourceTasksMatchThisReport"),
  emptyHint = tr("reports:reportTaskList.adjustThePeriodDatesOrProjectScope"),
  testId = 'report-source-tasks',
}) => {
  useLocale();
  const [activeFilters, setActiveFilters] = useState<Set<StatusFilter>>(new Set());
  const [priorityFilters, setPriorityFilters] = useState<Set<PriorityFilter>>(new Set());
  const [dateFilters, setDateFilters] = useState<Set<DateFilter>>(new Set());
  const [tagFilters, setTagFilters] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const projectNames = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const stats = useMemo(() => calculateTaskStats(tasks), [tasks]);
  const availableTags = useMemo(() => Array.from(new Set(tasks.flatMap((task) => task.tags || []).filter(Boolean))).sort(), [tasks]);
  const dateKeys = useMemo(() => {
    const today = new Date();
    const toKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return { today: toKey(today), tomorrow: toKey(tomorrow) };
  }, []);

  const completionRate = useMemo(() => {
    if (stats.total === 0) return 0;
    return Math.round((stats.completed / stats.total) * 100);
  }, [stats]);

  // Filter tasks based on active status filter and search query
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Status filter
      if (activeFilters.size > 0 && !activeFilters.has(task.status as StatusFilter)) return false;
      if (priorityFilters.size > 0 && !priorityFilters.has(task.priority as PriorityFilter)) return false;
      if (dateFilters.size > 0) {
        const dueDate = task.dueDate?.slice(0, 10);
        const matchesDate = (dateFilters.has('today') && dueDate === dateKeys.today) || (dateFilters.has('tomorrow') && dueDate === dateKeys.tomorrow);
        if (!matchesDate) return false;
      }
      if (tagFilters.size > 0 && !(task.tags || []).some((tag) => tagFilters.has(tag))) return false;

      // Keyword search query
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const titleMatch = task.title?.toLowerCase().includes(query);
        const descMatch = task.description?.toLowerCase().includes(query);
        const tagMatch = task.tags?.some((t) => t.toLowerCase().includes(query));
        const projName = task.projectId ? projectNames.get(task.projectId)?.toLowerCase() : '';
        const projMatch = projName?.includes(query);
        if (!titleMatch && !descMatch && !tagMatch && !projMatch) return false;
      }

      return true;
    });
  }, [tasks, activeFilters, priorityFilters, dateFilters, tagFilters, dateKeys, searchQuery, projectNames]);

  const toggleStatusFilter = (filter: StatusFilter) => {
    setActiveFilters((previous) => {
      const next = new Set(previous);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  };
  const toggleSetValue = <T,>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, value: T) => setter((previous) => {
    const next = new Set(previous);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  });
  const clearAllFilters = () => { setActiveFilters(new Set()); setPriorityFilters(new Set()); setDateFilters(new Set()); setTagFilters(new Set()); };

  if (tasks.length === 0) {
    return (
      <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-edge/60 bg-surface/80 text-quiet shadow-sm">
          <ListChecks className="h-7 w-7 text-info/70" />
        </div>
        <p className="mt-4 text-sm font-semibold text-main">{emptyMessage}</p>
        <p className="mt-1.5 max-w-sm text-xs leading-5 text-quiet">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-8 sm:py-6 space-y-4">
      {/* Overview & Metric Summary Header */}
      <div className="rounded-2xl border border-edge/80 bg-surface/60 p-4 sm:p-5 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-edge/60 pb-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-bold text-main">{title || tr("reports:reportTaskList.sourceTasks")}</h2>
              {dateRangeLabel && (
                <span className="inline-flex items-center gap-1 rounded-md border border-edge/70 bg-card/60 px-2.5 py-0.5 text-[11px] font-mono text-sub">
                  <Calendar className="h-3 w-3 text-quiet" />
                  <span>{dateRangeLabel}</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-quiet">
              周期任务事实清单与完成进度
            </p>
          </div>

          {/* Completion Rate Pill */}
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-xs font-semibold text-main">
                完成率 <span className="text-success font-bold">{completionRate}%</span>
              </div>
              <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-surface border border-edge">
                <div
                  className="h-full rounded-full bg-success transition-all duration-300"
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={clearAllFilters}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium transition-all ${
                activeFilters.size === 0
                  ? 'border-accent bg-accent/15 text-accent font-semibold shadow-xs'
                  : 'border-edge bg-surface/70 text-sub hover:border-subtle hover:text-main'
              }`}
            >
              <span className="font-semibold text-main">{stats.total}</span>
              <span>{tr("reports:reportTaskList.total")}</span>
            </button>

            <button
              type="button"
              onClick={() => toggleStatusFilter('done')}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium transition-all ${
                activeFilters.has('done')
                  ? 'border-emerald-500/50 bg-emerald-500/20 text-success font-semibold shadow-xs'
                  : 'border-emerald-500/25 bg-emerald-500/10 text-success hover:border-emerald-500/40'
              }`}
            >
              <CheckCircle2 className="h-3 w-3" />
              <span className="font-semibold">{stats.completed}</span>
              <span>{tr("reports:reportTaskList.completed")}</span>
            </button>

            <button
              type="button"
              onClick={() => toggleStatusFilter('in_progress')}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium transition-all ${
                activeFilters.has('in_progress')
                  ? 'border-sky-500/50 bg-sky-500/20 text-info font-semibold shadow-xs'
                  : 'border-sky-500/25 bg-sky-500/10 text-info hover:border-sky-500/40'
              }`}
            >
              <Clock className="h-3 w-3" />
              <span className="font-semibold">{stats.inProgress}</span>
              <span>{tr("reports:reportTaskList.inProgress")}</span>
            </button>

            {stats.blocked > 0 && (
              <button
                type="button"
                onClick={() => toggleStatusFilter('blocked')}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium transition-all ${
                    activeFilters.has('blocked')
                    ? 'border-rose-500/50 bg-rose-500/20 text-danger font-semibold shadow-xs'
                    : 'border-rose-500/25 bg-rose-500/10 text-danger hover:border-rose-500/40'
                }`}
              >
                <AlertCircle className="h-3 w-3" />
                <span className="font-semibold">{stats.blocked}</span>
                <span>{tr("reports:reportTaskList.blocked")}</span>
              </button>
            )}

            {stats.todo > 0 && (
              <button
                type="button"
                onClick={() => toggleStatusFilter('todo')}
                className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-medium transition-all ${
                    activeFilters.has('todo')
                    ? 'border-subtle bg-card text-main font-semibold shadow-xs'
                    : 'border-subtle bg-surface/70 text-sub hover:border-edge hover:text-main'
                }`}
              >
                <span className="font-semibold">{stats.todo}</span>
                <span>{tr("reports:reportTaskList.toDo")}</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {(['P1', 'P2', 'P3', 'P4'] as PriorityFilter[]).map((priority) => (
              <button key={priority} type="button" onClick={() => toggleSetValue(setPriorityFilters, priority)} className={`rounded-md border px-2 py-1 ${priorityFilters.has(priority) ? 'border-accent bg-accent/15 text-accent font-semibold' : 'border-edge text-sub'}`}>{priority}</button>
            ))}
            {(['today', 'tomorrow'] as DateFilter[]).map((date) => (
              <button key={date} type="button" onClick={() => toggleSetValue(setDateFilters, date)} className={`rounded-md border px-2 py-1 ${dateFilters.has(date) ? 'border-accent bg-accent/15 text-accent font-semibold' : 'border-edge text-sub'}`}>{date === 'today' ? '今天' : '明天'}</button>
            ))}
            {availableTags.map((tag) => (
              <button key={tag} type="button" onClick={() => toggleSetValue(setTagFilters, tag)} className={`rounded-md border px-2 py-1 ${tagFilters.has(tag) ? 'border-accent bg-accent/15 text-accent font-semibold' : 'border-edge text-sub'}`}>#{tag}</button>
            ))}
          </div>

          {/* Quick Search */}
          <div className="relative min-w-[180px] max-w-xs flex-1 sm:flex-initial">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-quiet" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索任务或标签..."
              className="w-full rounded-lg border border-edge bg-canvas/80 py-1 pl-8 pr-7 text-xs text-main placeholder-quiet outline-none transition-colors focus:border-accent"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-quiet hover:text-main"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Task items list */}
      <ul className="space-y-2.5" data-testid={testId}>
        {filteredTasks.length === 0 ? (
          <li className="rounded-xl border border-dashed border-edge/80 p-8 text-center text-xs text-quiet">
            未找到与当前筛选条件匹配的周期任务
          </li>
        ) : (
          filteredTasks.map((task) => {
            const status = TASK_STATUS_META[task.status] || {
              label: task.status,
              className: 'border-subtle text-sub',
            };
            const projectName = task.projectId
              ? projectNames.get(task.projectId) || task.projectId
              : tr("reports:reportTaskList.personalTask");
            const assignee =
              task.assigneeId === currentUser.id
                ? tr("reports:reportTaskList.me", { value0: currentUser.nickname })
                : task.assigneeId || tr("reports:reportTaskList.notSpecified");

            return (
              <li
                key={task.id}
                className="group relative rounded-xl border border-edge/80 bg-surface/50 p-4 transition-all duration-200 hover:border-accent/40 hover:bg-surface/85 hover:shadow-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {/* Title & Badges */}
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold leading-5 text-main group-hover:text-accent transition-colors">
                        {task.title}
                      </h3>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${status.className}`}
                      >
                        {status.label}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md border border-subtle bg-canvas/50 px-2 py-0.5 text-[10px] font-medium text-sub">
                        <PriorityFlag priority={task.priority} />
                        {task.priority}
                      </span>
                    </div>

                    {/* Description */}
                    {task.description && (
                      <p
                        title={task.description}
                        className="report-task-description mt-2 min-w-0 truncate text-xs leading-5 text-sub/90 bg-canvas/40 rounded-lg p-2 border border-edge/40 cursor-text"
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {task.description}
                      </p>
                    )}

                    {/* Metadata Footer */}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-quiet">
                      <span className="inline-flex items-center gap-1 font-medium text-sub">
                        <FolderKanban className="h-3 w-3 text-quiet" />
                        <span>{projectName}</span>
                      </span>

                      <span className="inline-flex items-center gap-1 text-sub">
                        <UserIcon className="h-3 w-3 text-quiet" />
                        <span>{tr("reports:reportTaskList.assignee", { value0: assignee })}</span>
                      </span>

                      {task.dueDate && (
                        <span className="inline-flex items-center gap-1 text-sub">
                          <Calendar className="h-3 w-3 text-quiet" />
                          <span>{tr("reports:reportTaskList.due", { value0: task.dueDate.slice(0, 10) })}</span>
                        </span>
                      )}

                      <span className="inline-flex items-center gap-1 text-quiet">
                        <Clock className="h-3 w-3" />
                        <span>{tr("reports:reportTaskList.updated", { value0: task.updatedAt?.slice(0, 10) })}</span>
                      </span>
                    </div>

                    {/* Tags */}
                    {task.tags && task.tags.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {task.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-0.5 rounded bg-card px-2 py-0.5 text-[10px] font-medium text-sub border border-edge/60"
                          >
                            <TagIcon className="h-2.5 w-2.5 text-quiet" />
                            <span>{tag}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
};
