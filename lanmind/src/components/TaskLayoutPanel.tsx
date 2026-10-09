import { currentLocale } from "../i18n/core";
import { tr, useLocale } from "../i18n";
import React from 'react';
import { CalendarDays, ChevronDown, GanttChart, Kanban, ListTodo } from 'lucide-react';
import { Task } from '../types';
import { DEFAULT_PROJECT_LAYOUT, ProjectLayout } from '../utils/taskLayout';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';

export const PROJECT_VIEWS = [
  { value: 'project', get label() { return tr("tasks:taskLayoutPanel.list"); }, icon: ListTodo },
  { value: 'kanban', get label() { return tr("tasks:taskLayoutPanel.kanban"); }, icon: Kanban },
  { value: 'calendar', get label() { return tr("tasks:taskLayoutPanel.calendar"); }, icon: CalendarDays },
  { value: 'timeline', get label() { return tr("tasks:taskLayoutPanel.timeline"); }, icon: GanttChart },
] as const;

const GROUPS: ThemeSelectOption[] = [
  { value: 'none', get label() { return tr("tasks:taskLayoutPanel.none"); } }, { value: 'date', get label() { return tr("tasks:taskLayoutPanel.date"); } },
  { value: 'priority', get label() { return tr("tasks:taskLayoutPanel.priority"); } }, { value: 'status', get label() { return tr("tasks:taskLayoutPanel.status"); } },
  { value: 'tag', get label() { return tr("tasks:taskLayoutPanel.tags"); } }, { value: 'assignee', get label() { return tr("tasks:taskLayoutPanel.assignee"); } },
];
const SORTS: ThemeSelectOption[] = [
  { value: 'manual', get label() { return tr("tasks:taskLayoutPanel.defaultOrder"); } }, { value: 'dueDate', get label() { return tr("tasks:taskLayoutPanel.dueDate"); } },
  { value: 'priority', get label() { return tr("tasks:taskLayoutPanel.priority"); } }, { value: 'createdAt', get label() { return tr("tasks:taskLayoutPanel.created"); } },
  { value: 'updatedAt', get label() { return tr("tasks:taskLayoutPanel.updated"); } }, { value: 'title', get label() { return tr("tasks:taskLayoutPanel.title"); } },
];
const DATES: ThemeSelectOption[] = [
  { value: 'ALL', get label() { return tr("tasks:taskLayoutPanel.all"); } }, { value: 'today', get label() { return tr("tasks:taskLayoutPanel.today"); } },
  { value: 'tomorrow', get label() { return tr("tasks:taskLayoutPanel.tomorrow"); } }, { value: 'upcoming', get label() { return tr("tasks:taskLayoutPanel.upcoming"); } },
  { value: 'overdue', get label() { return tr("tasks:taskLayoutPanel.overdue"); } }, { value: 'unscheduled', get label() { return tr("tasks:taskLayoutPanel.unscheduled"); } },
];
const PRIORITIES: ThemeSelectOption[] = [
  { value: 'ALL', get label() { return tr("tasks:taskLayoutPanel.all"); } }, { value: 'P1', get label() { return tr("tasks:taskLayoutPanel.p1Urgent"); }, tone: 'rose', indicator: 'flag' },
  { value: 'P2', get label() { return tr("tasks:taskLayoutPanel.p2High"); }, tone: 'amber', indicator: 'flag' }, { value: 'P3', get label() { return tr("tasks:taskLayoutPanel.p3Normal"); }, tone: 'blue', indicator: 'flag' },
  { value: 'P4', get label() { return tr("tasks:taskLayoutPanel.p4Low"); }, tone: 'slate', indicator: 'flag' },
];
const STATUSES: ThemeSelectOption[] = [
  { value: 'ALL', get label() { return tr("tasks:taskLayoutPanel.all"); } }, { value: 'todo', get label() { return tr("tasks:taskLayoutPanel.notStarted"); } },
  { value: 'in_progress', get label() { return tr("tasks:taskLayoutPanel.inProgress"); }, tone: 'blue' }, { value: 'blocked', get label() { return tr("tasks:taskLayoutPanel.blocked"); }, tone: 'rose' },
  { value: 'completed', get label() { return tr("tasks:taskLayoutPanel.completed"); }, tone: 'emerald' }, { value: 'abandoned', get label() { return tr("tasks:taskLayoutPanel.abandoned"); }, tone: 'slate' },
];

interface TaskLayoutPanelProps {
  id: string;
  tasks: Task[];
  layout: ProjectLayout;
  onLayoutChange: (patch: Partial<ProjectLayout>) => void;
  mode?: 'layout' | 'filters';
  scope?: 'project' | 'task';
}

export const TaskLayoutPanel: React.FC<TaskLayoutPanelProps> = ({ id, tasks, layout, onLayoutChange, mode = 'filters', scope = 'task' }: TaskLayoutPanelProps) => {
  useLocale();
  const prefix = scope === 'project' ? tr("tasks:taskLayoutPanel.project") : tr("tasks:taskLayoutPanel.task");
  const tags = Array.from(new Set(tasks.flatMap((task) => task.tags || []))).sort((a, b) => a.localeCompare(b, currentLocale()));
  if (layout.tagFilter !== null && !tags.includes(layout.tagFilter)) tags.push(layout.tagFilter);
  const tagOptions = [{ value: '', label: tr("tasks:taskLayoutPanel.all") }, ...tags.map((tag) => ({ value: tag, label: `#${tag}` }))];
  const select = (label: string, field: keyof ProjectLayout, options: ThemeSelectOption[], disabled = false) => (
    <div className="project-layout-row" data-field={field} key={field}>
      <span>{label}</span>
      <ThemeSelect portal popoverOwnerId={id} menuClassName="task-filter-select-menu" ariaLabel={`${prefix}${label}`} value={String(layout[field] ?? '')} options={options} disabled={disabled}
        onChange={(value) => onLayoutChange({ [field]: field === 'tagFilter' ? value || null : value })} />
    </div>
  );

  if (mode === 'layout') return <div id={id} role="dialog" aria-label={tr("tasks:taskLayoutPanel.projectLayoutSettings")} className="project-layout-panel pb-3">
    <div className="px-3.5 pt-3 pb-2 text-xs font-semibold text-main">{tr("tasks:taskLayoutPanel.layout")}</div>
    <div className="project-layout-views" role="group" aria-label={tr("tasks:taskLayoutPanel.projectView")}>
      {PROJECT_VIEWS.map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-pressed={layout.view === value} data-selected={layout.view === value}
        onClick={() => onLayoutChange({ view: value })}><Icon className="h-4 w-4" /><span>{label}</span></button>)}
    </div>
  </div>;

  return <div id={id} role="dialog" aria-label={tr("tasks:taskLayoutPanel.sortingAndFilters", { value0: prefix })} className="project-layout-panel">
    <div className="px-3.5 pt-3 pb-2 text-xs font-semibold text-main">{tr("tasks:taskLayoutPanel.sortingAndFilters2")}</div>
    <div className="flex items-center justify-between gap-3 px-3.5 py-3 text-xs text-main">
      <span>{tr("tasks:taskLayoutPanel.completedTasks")}</span>
      <button type="button" role="switch" aria-label={scope === 'project' ? tr("tasks:taskLayoutPanel.showCompletedProjectTasks") : tr("tasks:taskLayoutPanel.showCompletedTasks")} aria-checked={layout.showCompleted} className="ui-switch"
        data-state={layout.showCompleted ? 'checked' : 'unchecked'} onClick={() => onLayoutChange({ showCompleted: !layout.showCompleted })}><span className="ui-switch-thumb" /></button>
    </div>
    <details open className="project-layout-section">
      <summary>{tr("tasks:taskLayoutPanel.sort")}<ChevronDown className="h-3.5 w-3.5" /></summary>
      <div className="space-y-1.5 pb-3">
        {select(tr("tasks:taskLayoutPanel.group"), 'groupMode', GROUPS, scope === 'project' && layout.view !== 'project')}
        {select(tr("tasks:taskLayoutPanel.sort"), 'sortMode', SORTS)}
      </div>
    </details>
    <details open className="project-layout-section">
      <summary>{tr("tasks:taskLayoutPanel.filters")}<ChevronDown className="h-3.5 w-3.5" /></summary>
      <div className="space-y-1.5 pb-3">
        {select(tr("tasks:taskLayoutPanel.date"), 'dateFilter', DATES)}
        {select(tr("tasks:taskLayoutPanel.priority"), 'priorityFilter', PRIORITIES)}
        {select(tr("tasks:taskLayoutPanel.status"), 'statusFilter', STATUSES)}
        {select(tr("tasks:taskLayoutPanel.tags"), 'tagFilter', tagOptions)}
      </div>
    </details>
    <button type="button" className="project-layout-reset" onClick={() => onLayoutChange({ ...DEFAULT_PROJECT_LAYOUT, view: layout.view })}>{tr("tasks:taskLayoutPanel.resetAll")}</button>
  </div>;
};
