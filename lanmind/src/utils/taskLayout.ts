import { currentLocale } from '../i18n/core';
import { useEffect, useState } from 'react';
import { Priority, Task, TaskStatus } from '../types';
import { formatLocalTaskDateTime } from './taskDateTime';

export type ProjectView = 'project' | 'kanban' | 'calendar' | 'timeline';
export type TaskGroupMode = 'none' | 'date' | 'priority' | 'status' | 'tag' | 'assignee';
export type TaskSortMode = 'manual' | 'startDate' | 'dueDate' | 'priority' | 'createdAt' | 'updatedAt' | 'title';
export type ProjectDateFilter = 'today' | 'tomorrow' | 'upcoming' | 'overdue' | 'unscheduled';
export type TaskFilterField = 'priorityFilter' | 'statusFilter' | 'dateFilter' | 'tagFilter' | 'assigneeFilter' | 'projectFilter';

export interface ProjectLayout {
  view: ProjectView;
  groupMode: TaskGroupMode;
  sortMode: TaskSortMode;
  sortDirection: 'asc' | 'desc';
  showCompleted: boolean;
  priorityFilter: Priority[];
  statusFilter: TaskStatus[];
  dateFilter: ProjectDateFilter[];
  tagFilter: string[];
  assigneeFilter: string[];
  projectFilter: (string | null)[];
}
export const EMPTY_TASK_FILTERS = {
  showCompleted: false, priorityFilter: [] as Priority[], statusFilter: [] as TaskStatus[],
  dateFilter: [] as ProjectDateFilter[], tagFilter: [] as string[], assigneeFilter: [] as string[], projectFilter: [] as (string | null)[],
};
export const DEFAULT_PROJECT_LAYOUT: ProjectLayout = {
  view: 'project', groupMode: 'none', sortMode: 'manual', sortDirection: 'asc', ...EMPTY_TASK_FILTERS,
};
export const TASK_FILTER_FIELDS: TaskFilterField[] = ['dateFilter', 'priorityFilter', 'statusFilter', 'tagFilter', 'assigneeFilter', 'projectFilter'];
const validValues = {
  view: ['project', 'kanban', 'calendar', 'timeline'],
  groupMode: ['none', 'date', 'priority', 'status', 'tag', 'assignee'],
  sortMode: ['manual', 'startDate', 'dueDate', 'priority', 'createdAt', 'updatedAt', 'title'],
  priorityFilter: ['P1', 'P2', 'P3', 'P4'],
  statusFilter: ['todo', 'in_progress', 'blocked', 'completed', 'abandoned'],
  dateFilter: ['today', 'tomorrow', 'upcoming', 'overdue', 'unscheduled'],
};
export const defaultSortDirection = (mode: TaskSortMode) => mode === 'title' || mode === 'manual' ? 'asc' : 'desc';

// Accept both the original single-value preferences and the current arrays.
export function normalizeTaskLayout(value: unknown): ProjectLayout {
  const saved = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const next = { ...DEFAULT_PROJECT_LAYOUT };
  for (const field of ['view', 'groupMode', 'sortMode'] as const) {
    if (validValues[field].includes(saved[field] as string)) Object.assign(next, { [field]: saved[field] });
  }
  next.sortDirection = saved.sortDirection === 'asc' || saved.sortDirection === 'desc' ? saved.sortDirection : defaultSortDirection(next.sortMode);
  next.showCompleted = saved.showCompleted === true;
  for (const field of TASK_FILTER_FIELDS) {
    const raw = saved[field];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    const allowed = field in validValues ? validValues[field as 'priorityFilter' | 'statusFilter' | 'dateFilter'] : undefined;
    const clean = values.filter((item) => allowed ? allowed.includes(item) : field === 'projectFilter' ? item === null || typeof item === 'string' && item.length > 0 : typeof item === 'string' && (field === 'assigneeFilter' || item.length > 0));
    Object.assign(next, { [field]: [...new Set(clean)] });
  }
  return next;
}
const TASK_LAYOUT_CHANGE_EVENT = 'lanmind-task-layout-change';
function loadProjectLayout(key: string): ProjectLayout {
  try { return normalizeTaskLayout(JSON.parse(localStorage.getItem(key) || '{}')); }
  catch { return normalizeTaskLayout(null); }
}
export function useTaskLayout(userId: string, projectId: string | null) {
  const key = `lanmind_task_layout:${userId}:${projectId || 'all'}`;
  const [stored, setStored] = useState(() => ({ key, layout: loadProjectLayout(key) }));
  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; layout: ProjectLayout }>).detail;
      if (detail.key === key) setStored(detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setStored({ key, layout: loadProjectLayout(key) });
    };
    window.addEventListener(TASK_LAYOUT_CHANGE_EVENT, handleChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(TASK_LAYOUT_CHANGE_EVENT, handleChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, [key]);
  const layout = stored.key === key ? stored.layout : loadProjectLayout(key);
  const updateLayout = (patch: Partial<ProjectLayout>) => {
    // Avoid stale patches from separate consumers of the same preferences.
    const next = normalizeTaskLayout({ ...loadProjectLayout(key), ...patch });
    localStorage.setItem(key, JSON.stringify(next));
    setStored({ key, layout: next });
    window.dispatchEvent(new CustomEvent(TASK_LAYOUT_CHANGE_EVENT, { detail: { key, layout: next } }));
  };
  return { layout, updateLayout };
}

// Refresh relative dates at local midnight and after the application resumes.
export function useTaskToday(): string {
  const [today, setToday] = useState(() => formatLocalTaskDateTime(new Date(), false));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(formatLocalTaskDateTime(now, false));
      timer = setTimeout(refresh, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime() + 50);
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  return today;
}
export function countTaskFilters(layout: ProjectLayout) {
  return TASK_FILTER_FIELDS.filter((field) => layout[field].length > 0).length + Number(!layout.statusFilter.length && layout.showCompleted);
}
export function countTaskLayoutSettings(layout: ProjectLayout, view = layout.view) {
  return countTaskFilters(layout) + Number(layout.sortMode !== 'manual') + Number(view === 'project' && layout.groupMode !== 'none');
}
export function matchesTaskFields(task: Task, layout: ProjectLayout, searchQuery = ''): boolean {
  const query = searchQuery.trim().toLocaleLowerCase();
  if (task.parentTaskId) return false;
  if (query && ![task.title, task.description, ...(task.tags || [])].some((value) => value?.toLocaleLowerCase().includes(query))) return false;
  if (layout.priorityFilter.length && !layout.priorityFilter.includes(task.priority)) return false;
  if (layout.statusFilter.length) {
    if (!layout.statusFilter.includes(task.status)) return false;
  } else if (task.status === 'abandoned' || task.status === 'completed' && !layout.showCompleted) return false;
  if (layout.tagFilter.length && !task.tags?.some((tag) => layout.tagFilter.includes(tag))) return false;
  if (layout.assigneeFilter.length && !layout.assigneeFilter.includes(task.assigneeId || '')) return false;
  if (layout.projectFilter.length && !layout.projectFilter.includes(task.projectId || null)) return false;
  return true;
}
export function matchesTaskDate(task: Pick<Task, 'dueDate' | 'startDate' | 'status'>, filters: ProjectDateFilter[], now = new Date()): boolean {
  const today = formatLocalTaskDateTime(now, false);
  const tomorrow = formatLocalTaskDateTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), false);
  const date = task.dueDate?.slice(0, 10);
  return !filters.length || filters.some((filter) => {
    switch (filter) {
      case 'today': return date === today;
      case 'tomorrow': return date === tomorrow;
      case 'upcoming': return Boolean(date && date > today);
      case 'overdue': return Boolean(date && date < today && !['completed', 'abandoned'].includes(task.status));
      case 'unscheduled': return !task.startDate && !task.dueDate;
    }
  });
}
export function compareTasks(left: Task, right: Task, layout: Pick<ProjectLayout, 'sortMode' | 'sortDirection'>): number {
  const { sortMode, sortDirection } = layout;
  if (sortMode === 'manual') return 0;
  const a = left[sortMode];
  const b = right[sortMode];
  if (!a || !b) return a ? -1 : b ? 1 : left.id.localeCompare(right.id);
  return (sortDirection === 'desc' ? -1 : 1) * a.localeCompare(b, currentLocale()) || left.id.localeCompare(right.id);
}
export function filterTasksByLayout(tasks: Task[], layout: ProjectLayout, searchQuery: string, now = new Date()): Task[] {
  return tasks.filter((task) => matchesTaskFields(task, layout, searchQuery) && matchesTaskDate(task, layout.dateFilter, now))
    .sort((left, right) => compareTasks(left, right, layout));
}
