import { useState } from 'react';
import { Priority, Task, TaskStatus } from '../types';
import { formatLocalTaskDateTime } from './taskDateTime';

export type ProjectView = 'project' | 'kanban' | 'calendar' | 'timeline';
export type TaskGroupMode = 'none' | 'date' | 'priority' | 'status' | 'tag' | 'assignee';
export type TaskSortMode = 'manual' | 'dueDate' | 'priority' | 'createdAt' | 'updatedAt' | 'title';
export type ProjectDateFilter = 'ALL' | 'today' | 'tomorrow' | 'upcoming' | 'overdue' | 'unscheduled';

export interface ProjectLayout {
  view: ProjectView;
  groupMode: TaskGroupMode;
  sortMode: TaskSortMode;
  showCompleted: boolean;
  priorityFilter: 'ALL' | Priority;
  statusFilter: 'ALL' | TaskStatus;
  dateFilter: ProjectDateFilter;
  tagFilter: string | null;
}

export const DEFAULT_PROJECT_LAYOUT: ProjectLayout = {
  view: 'project', groupMode: 'none', sortMode: 'manual', showCompleted: false,
  priorityFilter: 'ALL', statusFilter: 'ALL', dateFilter: 'ALL', tagFilter: null,
};

const validValues = {
  view: ['project', 'kanban', 'calendar', 'timeline'],
  groupMode: ['none', 'date', 'priority', 'status', 'tag', 'assignee'],
  sortMode: ['manual', 'dueDate', 'priority', 'createdAt', 'updatedAt', 'title'],
  priorityFilter: ['ALL', 'P1', 'P2', 'P3', 'P4'],
  statusFilter: ['ALL', 'todo', 'in_progress', 'blocked', 'completed', 'abandoned'],
  dateFilter: ['ALL', 'today', 'tomorrow', 'upcoming', 'overdue', 'unscheduled'],
};

function loadProjectLayout(key: string): ProjectLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    const next = { ...DEFAULT_PROJECT_LAYOUT };
    for (const field of Object.keys(validValues) as Array<keyof typeof validValues>) {
      if (validValues[field].includes(saved?.[field])) Object.assign(next, { [field]: saved[field] });
    }
    next.showCompleted = saved?.showCompleted === true;
    next.tagFilter = typeof saved?.tagFilter === 'string' ? saved.tagFilter : null;
    return next;
  } catch { return { ...DEFAULT_PROJECT_LAYOUT }; }
}

export function useTaskLayout(userId: string, projectId: string | null) {
  const key = `lanmind_task_layout:${userId}:${projectId || 'all'}`;
  const [stored, setStored] = useState(() => ({ key, layout: loadProjectLayout(key) }));
  // Read the new project's preferences before rendering or saving any changes.
  const layout = stored.key === key ? stored.layout : loadProjectLayout(key);
  const updateLayout = (patch: Partial<ProjectLayout>) => {
    const next = { ...layout, ...patch };
    setStored({ key, layout: next });
    localStorage.setItem(key, JSON.stringify(next));
  };
  return { layout, updateLayout };
}

export function countTaskLayoutSettings(layout: ProjectLayout) {
  return Number(layout.groupMode !== 'none') + Number(layout.sortMode !== 'manual')
    + Number(layout.showCompleted) + Number(layout.priorityFilter !== 'ALL') + Number(layout.statusFilter !== 'ALL')
    + Number(layout.dateFilter !== 'ALL') + Number(layout.tagFilter !== null);
}

export function filterTasksByLayout(tasks: Task[], layout: ProjectLayout, searchQuery: string, now = new Date()): Task[] {
  const today = formatLocalTaskDateTime(now, false);
  const tomorrow = formatLocalTaskDateTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), false);
  const query = searchQuery.trim().toLocaleLowerCase();
  const filtered = tasks.filter((task) => {
    if (task.parentTaskId) return false;
    if (query && ![task.title, task.description, ...(task.tags || [])].some((value) => value?.toLocaleLowerCase().includes(query))) return false;
    if (layout.priorityFilter !== 'ALL' && task.priority !== layout.priorityFilter) return false;
    if (layout.statusFilter !== 'ALL' && task.status !== layout.statusFilter) return false;
    if (layout.statusFilter === 'ALL' && task.status === 'abandoned') return false;
    if (!layout.showCompleted && layout.statusFilter !== 'completed' && task.status === 'completed') return false;
    if (layout.tagFilter !== null && !task.tags?.includes(layout.tagFilter)) return false;
    const date = task.dueDate?.slice(0, 10);
    switch (layout.dateFilter) {
      case 'today': return date === today;
      case 'tomorrow': return date === tomorrow;
      case 'upcoming': return Boolean(date && date > today);
      case 'overdue': return Boolean(date && date < today && !['completed', 'abandoned'].includes(task.status));
      case 'unscheduled': return !task.startDate && !task.dueDate;
      default: return true;
    }
  });
  return filtered.sort((left, right) => {
    switch (layout.sortMode) {
      case 'dueDate': return (left.dueDate || '9999').localeCompare(right.dueDate || '9999');
      case 'priority': return left.priority.localeCompare(right.priority);
      case 'createdAt': return right.createdAt.localeCompare(left.createdAt);
      case 'updatedAt': return right.updatedAt.localeCompare(left.updatedAt);
      case 'title': return left.title.localeCompare(right.title, 'zh-CN');
      default: return 0;
    }
  });
}
