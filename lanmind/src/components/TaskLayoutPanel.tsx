import { currentLocale } from "../i18n/core";
import { tr, useLocale } from "../i18n";
import React from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CalendarDays, ChevronDown, GanttChart, Kanban, ListTodo, RotateCcw, X } from 'lucide-react';
import { Project, Task, User } from '../types';
import { DEFAULT_PROJECT_LAYOUT, defaultSortDirection, EMPTY_TASK_FILTERS, ProjectLayout, ProjectView, TaskFilterField, TaskSortMode } from '../utils/taskLayout';
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
  { value: 'startDate', get label() { return tr('tasks:taskLayoutPanel.startDate'); } },
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

export interface TaskFilterContext {
  projects?: Project[];
  users?: User[];
  currentUserId?: string;
  activeView?: ProjectView;
  scope?: 'project' | 'task';
  projectId?: string | null;
}
export interface TaskLayoutPanelProps extends TaskFilterContext {
  id: string;
  tasks: Task[];
  layout: ProjectLayout;
  onLayoutChange: (patch: Partial<ProjectLayout>) => void;
  mode?: 'layout' | 'filters';
}
export interface TaskFilterOption {
  value: string | null;
  label: string;
  tone?: ThemeSelectOption['tone'];
  indicator?: ThemeSelectOption['indicator'];
}
export function getTaskFilterOptions(tasks: Task[], layout: ProjectLayout, context: TaskFilterContext) {
  const { projects = [], users = [], currentUserId, scope = 'task' } = context;
  const tags = [...new Set([...tasks.flatMap((task) => task.tags || []), ...layout.tagFilter])].sort((a, b) => a.localeCompare(b, currentLocale()));
  const memberIds = scope === 'project' ? projects.find((project) => project.id === (context.projectId || tasks.find((task) => task.projectId)?.projectId))?.members || [] : [];
  const assigneeIds = [...new Set([...(currentUserId ? [currentUserId] : []), ...memberIds, ...tasks.map((task) => task.assigneeId).filter(Boolean), ...layout.assigneeFilter])].filter(Boolean);
  const projectIds = [...new Set([...projects.map((project) => project.id), ...tasks.map((task) => task.projectId).filter((id): id is string => Boolean(id)), ...layout.projectFilter.filter((id): id is string => id !== null)])];
  const options: Record<TaskFilterField, TaskFilterOption[]> = {
    dateFilter: DATES.filter((option) => option.value !== 'ALL'),
    priorityFilter: PRIORITIES.filter((option) => option.value !== 'ALL'),
    statusFilter: STATUSES.filter((option) => option.value !== 'ALL'),
    tagFilter: tags.map((tag) => ({ value: tag, label: `#${tag}` })),
    assigneeFilter: [{ value: '', label: tr('tasks:listView.unassigned') }, ...assigneeIds.map((id) => ({
      value: id, label: (id === currentUserId ? tr('tasks:taskLayoutPanel.me') + ' · ' : '') + (users.find((user) => user.id === id)?.nickname || id),
    }))],
    projectFilter: [{ value: null, label: tr('tasks:taskLayoutPanel.personalTasks') }, ...projectIds.map((id) => ({
      value: id, label: projects.find((project) => project.id === id)?.name || id,
    }))],
  };
  return options;
}
export const TaskLayoutPanel: React.FC<TaskLayoutPanelProps> = ({ id, tasks, layout, onLayoutChange, mode = 'filters', scope = 'task', activeView = layout.view, ...context }: TaskLayoutPanelProps) => {
  useLocale();
  const prefix = scope === 'project' ? tr('tasks:taskLayoutPanel.project') : tr('tasks:taskLayoutPanel.task');
  const options = getTaskFilterOptions(tasks, layout, { ...context, scope });
  const hasActiveFilters =
    layout.dateFilter.length > 0 ||
    layout.priorityFilter.length > 0 ||
    layout.statusFilter.length > 0 ||
    layout.tagFilter.length > 0 ||
    layout.assigneeFilter.length > 0 ||
    layout.projectFilter.length > 0;

  const select = (label: string, field: 'groupMode' | 'sortMode' | 'sortDirection', choices: ThemeSelectOption[], disabled = false) => (
    <div className="project-layout-row" data-field={field} key={field}>
      <span>{label}</span>
      <ThemeSelect portal popoverOwnerId={id} menuClassName="task-filter-select-menu" ariaLabel={`${prefix}${label}`} value={layout[field]} options={choices} disabled={disabled}
        onChange={(value) => onLayoutChange(field === 'sortMode' ? { sortMode: value as TaskSortMode, sortDirection: defaultSortDirection(value as TaskSortMode) } : { [field]: value })} />
    </div>
  );
  const multiple = (label: string, field: TaskFilterField, searchable = false) => {
    const hasFilter = layout[field].length > 0;
    return (
      <div className="project-layout-row" data-field={field} key={field}>
        <span>{field === 'dateFilter' ? tr(activeView === 'calendar' ? 'tasks:taskLayoutPanel.scheduleDate' : 'tasks:taskLayoutPanel.dueDate') : label}</span>
        <div className="relative flex items-center min-w-0 flex-1">
          <ThemeSelect multiple portal searchable={searchable} popoverOwnerId={id} menuClassName="task-filter-select-menu" ariaLabel={`${prefix}${label}`}
            value={layout[field].map((value) => JSON.stringify(value))}
            options={[{ value: 'ALL', label: tr('tasks:taskLayoutPanel.all') }, ...options[field].map((option) => ({ ...option, value: JSON.stringify(option.value) }))]}
            onChange={(values) => onLayoutChange({ [field]: values.map((value) => JSON.parse(value)) })} />
          {hasFilter && (
            <button
              type="button"
              className="absolute right-6.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-quiet hover:text-danger hover:bg-hover transition-colors z-10"
              title={`清除${label}筛选`}
              aria-label={`清除${label}筛选`}
              onClick={(e) => {
                e.stopPropagation();
                onLayoutChange({ [field]: [] });
              }}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    );
  };

  if (mode === 'layout') return <div id={id} role="dialog" aria-label={tr('tasks:taskLayoutPanel.projectLayoutSettings')} className="project-layout-panel pb-3">
    <div className="px-3.5 pt-3 pb-2 text-xs font-semibold text-main">{tr('tasks:taskLayoutPanel.layout')}</div>
    <div className="project-layout-views" role="group" aria-label={tr('tasks:taskLayoutPanel.projectView')}>
      {PROJECT_VIEWS.map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-pressed={layout.view === value} data-selected={layout.view === value}
        onClick={() => onLayoutChange({ view: value })}><Icon className="h-4 w-4" /><span>{label}</span></button>)}
    </div>
  </div>;

  return <div id={id} role="dialog" aria-label={tr('tasks:taskLayoutPanel.sortingAndFilters', { value0: prefix })} className="project-layout-panel">
    <div className="px-3.5 pt-3 pb-2 text-xs font-semibold text-main">{tr('tasks:taskLayoutPanel.sortingAndFilters2')}</div>
    <div className="flex items-center justify-between gap-3 px-3.5 py-3 text-xs text-main">
      <div><span>{tr('tasks:taskLayoutPanel.completedTasks')}</span>{layout.statusFilter.length > 0 && <p className="mt-1 text-[10px] text-quiet">{tr('tasks:taskLayoutPanel.explicitStatuses')}</p>}</div>
      <button type="button" role="switch" disabled={layout.statusFilter.length > 0} aria-label={scope === 'project' ? tr('tasks:taskLayoutPanel.showCompletedProjectTasks') : tr('tasks:taskLayoutPanel.showCompletedTasks')} aria-checked={layout.showCompleted} className="ui-switch disabled:opacity-40"
        data-state={layout.showCompleted ? 'checked' : 'unchecked'} onClick={() => onLayoutChange({ showCompleted: !layout.showCompleted })}><span className="ui-switch-thumb" /></button>
    </div>
    <details open className="project-layout-section">
      <summary>{tr('tasks:taskLayoutPanel.sort')}<ChevronDown className="h-3.5 w-3.5" /></summary>
      <div className="space-y-1.5 pb-3">
        {activeView === 'project' && select(tr('tasks:taskLayoutPanel.group'), 'groupMode', GROUPS)}
        <div className="project-layout-row" data-field="sortMode">
          <span>{tr('tasks:taskLayoutPanel.sort')}</span>
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="flex-1 min-w-0">
              <ThemeSelect portal popoverOwnerId={id} menuClassName="task-filter-select-menu" ariaLabel={`${prefix}${tr('tasks:taskLayoutPanel.sort')}`} value={layout.sortMode} options={SORTS}
                onChange={(value) => onLayoutChange({ sortMode: value as TaskSortMode, sortDirection: defaultSortDirection(value as TaskSortMode) })} />
            </div>
            <div data-field="sortDirection" className="shrink-0">
              <button
                type="button"
                disabled={layout.sortMode === 'manual'}
                className="h-8 px-2.5 flex items-center justify-center gap-1.5 rounded-md border border-subtle bg-surface text-sub hover:text-main hover:bg-hover disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed shadow-2xs"
                title={layout.sortDirection === 'desc' ? `${tr('tasks:taskLayoutPanel.descending')} (点击切换为升序)` : `${tr('tasks:taskLayoutPanel.ascending')} (点击切换为降序)`}
                aria-label={`${prefix}${tr('tasks:taskLayoutPanel.direction')}`}
                onClick={() => onLayoutChange({ sortDirection: layout.sortDirection === 'desc' ? 'asc' : 'desc' })}
              >
                {layout.sortDirection === 'desc' ? (
                  <ArrowDownWideNarrow className="w-3.5 h-3.5 text-primary" />
                ) : (
                  <ArrowUpNarrowWide className="w-3.5 h-3.5 text-primary" />
                )}
                <span className="text-xs font-medium">{layout.sortDirection === 'desc' ? tr('tasks:taskLayoutPanel.descending') : tr('tasks:taskLayoutPanel.ascending')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </details>
    <details open className="project-layout-section">
      <summary>{tr('tasks:taskLayoutPanel.filters')}<ChevronDown className="h-3.5 w-3.5" /></summary>
      <div className="space-y-1.5 pb-3">
        {multiple(tr('tasks:taskLayoutPanel.date'), 'dateFilter')}
        {multiple(tr('tasks:taskLayoutPanel.priority'), 'priorityFilter')}
        {multiple(tr('tasks:taskLayoutPanel.status'), 'statusFilter')}
        {multiple(tr('tasks:taskLayoutPanel.tags'), 'tagFilter', true)}
        {multiple(tr('tasks:taskLayoutPanel.assignee'), 'assigneeFilter', true)}
        {scope === 'task' && multiple(tr('tasks:taskLayoutPanel.project'), 'projectFilter', true)}
      </div>
    </details>
    <div className="project-layout-footer">
      <button
        type="button"
        disabled={!hasActiveFilters}
        className="project-layout-reset flex items-center justify-center gap-1.5 rounded-md border border-subtle bg-surface text-xs font-medium text-sub hover:text-main hover:bg-hover disabled:opacity-40 transition-colors"
        onClick={() => onLayoutChange(EMPTY_TASK_FILTERS)}
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span>{tr('tasks:taskLayoutPanel.clearFilters')}</span>
      </button>
      <button
        type="button"
        className="project-layout-reset flex items-center justify-center gap-1.5 rounded-md text-xs font-medium text-danger hover:bg-danger/10 transition-colors"
        onClick={() => onLayoutChange({ ...DEFAULT_PROJECT_LAYOUT, view: layout.view })}
      >
        <span>{tr('tasks:taskLayoutPanel.resetAll')}</span>
      </button>
    </div>
  </div>;
};
