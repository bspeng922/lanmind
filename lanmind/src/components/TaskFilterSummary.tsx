import React from 'react';
import { X } from 'lucide-react';
import { tr, useLocale } from '../i18n';
import { Task } from '../types';
import { countTaskFilters, EMPTY_TASK_FILTERS, ProjectLayout, TASK_FILTER_FIELDS } from '../utils/taskLayout';
import { getTaskFilterOptions, TaskFilterContext } from './TaskLayoutPanel';

interface TaskFilterSummaryProps extends TaskFilterContext {
  tasks: Task[];
  layout: ProjectLayout;
  onLayoutChange?: (patch: Partial<ProjectLayout>) => void;
}
export const TaskFilterSummary: React.FC<TaskFilterSummaryProps> = ({ tasks, layout, onLayoutChange, ...context }) => {
  useLocale();
  const options = getTaskFilterOptions(tasks, layout, context);
  if (!countTaskFilters(layout) && layout.sortMode === 'manual') return null;
  return <div className="task-filter-summary flex shrink-0 flex-wrap items-center gap-1.5 border-b border-edge bg-surface px-4 py-2 text-[11px]" aria-label={tr('tasks:taskLayoutPanel.activeFilters')}>
    {TASK_FILTER_FIELDS.filter((field) => context.scope !== 'project' || field !== 'projectFilter').flatMap((field) => layout[field].map((value) => {
      const label = options[field].find((option) => option.value === value)?.label || String(value);
      return <button type="button" key={field + ':' + value} disabled={!onLayoutChange} className="inline-flex max-w-full items-center gap-1 rounded border border-subtle bg-card px-2 py-0.5 text-sub hover:text-main"
        aria-label={tr('tasks:taskLayoutPanel.removeFilter', { label })} title={label}
        onClick={() => onLayoutChange?.({ [field]: layout[field].filter((item) => item !== value) })}><span className="truncate">{label}</span><X className="h-3 w-3 shrink-0" /></button>;
    }))}
    {!layout.statusFilter.length && layout.showCompleted && <button type="button" className="rounded border border-subtle px-2 py-0.5 text-sub" onClick={() => onLayoutChange?.({ showCompleted: false })}>{tr('tasks:taskLayoutPanel.showCompletedTasks')} ×</button>}
    {layout.sortMode !== 'manual' && <span className="text-quiet">{tr('tasks:taskLayoutPanel.sortSummary', { mode: tr('tasks:taskLayoutPanel.' + ({ priority: 'priority', dueDate: 'dueDate', startDate: 'startDate', createdAt: 'created', updatedAt: 'updated', title: 'title' }[layout.sortMode])), direction: tr(layout.sortDirection === 'asc' ? 'tasks:taskLayoutPanel.ascending' : 'tasks:taskLayoutPanel.descending') })}</span>}
    {countTaskFilters(layout) > 0 && onLayoutChange && <button type="button" className="ml-auto text-info hover:underline" onClick={() => onLayoutChange(EMPTY_TASK_FILTERS)}>{tr('tasks:taskLayoutPanel.clearFilters')}</button>}
  </div>;
};
