import React from 'react';
import { CalendarDays, ChevronDown, GanttChart, Kanban, ListTodo } from 'lucide-react';
import { Task } from '../types';
import { DEFAULT_PROJECT_LAYOUT, ProjectLayout } from '../utils/taskLayout';
import { ThemeSelect, ThemeSelectOption } from './ThemeSelect';

export const PROJECT_VIEWS = [
  { value: 'project', label: '列表', icon: ListTodo },
  { value: 'kanban', label: '看板', icon: Kanban },
  { value: 'calendar', label: '日历', icon: CalendarDays },
  { value: 'timeline', label: '时间线', icon: GanttChart },
] as const;

const GROUPS: ThemeSelectOption[] = [
  { value: 'none', label: '无' }, { value: 'date', label: '日期' },
  { value: 'priority', label: '优先级' }, { value: 'status', label: '状态' },
  { value: 'tag', label: '标签' }, { value: 'assignee', label: '负责人' },
];
const SORTS: ThemeSelectOption[] = [
  { value: 'manual', label: '默认顺序' }, { value: 'dueDate', label: '到期日期' },
  { value: 'priority', label: '优先级' }, { value: 'createdAt', label: '创建时间' },
  { value: 'updatedAt', label: '更新时间' }, { value: 'title', label: '标题' },
];
const DATES: ThemeSelectOption[] = [
  { value: 'ALL', label: '全部' }, { value: 'today', label: '今天' },
  { value: 'tomorrow', label: '明天' }, { value: 'upcoming', label: '未来安排' },
  { value: 'overdue', label: '已逾期' }, { value: 'unscheduled', label: '未排期' },
];
const PRIORITIES: ThemeSelectOption[] = [
  { value: 'ALL', label: '全部' }, { value: 'P1', label: 'P1 紧急重要', tone: 'rose' },
  { value: 'P2', label: 'P2 重要', tone: 'amber' }, { value: 'P3', label: 'P3 普通', tone: 'blue' },
  { value: 'P4', label: 'P4 低优', tone: 'slate' },
];
const STATUSES: ThemeSelectOption[] = [
  { value: 'ALL', label: '全部' }, { value: 'todo', label: '未开始' },
  { value: 'in_progress', label: '进行中', tone: 'blue' }, { value: 'blocked', label: '已阻塞', tone: 'rose' },
  { value: 'completed', label: '已完成', tone: 'emerald' }, { value: 'abandoned', label: '已放弃', tone: 'slate' },
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
  const prefix = scope === 'project' ? '项目' : '任务';
  const tags = Array.from(new Set(tasks.flatMap((task) => task.tags || []))).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (layout.tagFilter !== null && !tags.includes(layout.tagFilter)) tags.push(layout.tagFilter);
  const tagOptions = [{ value: '', label: '全部' }, ...tags.map((tag) => ({ value: tag, label: `#${tag}` }))];
  const select = (label: string, field: keyof ProjectLayout, options: ThemeSelectOption[], disabled = false) => (
    <div className="project-layout-row" data-field={field} key={field}>
      <span>{label}</span>
      <ThemeSelect portal popoverOwnerId={id} menuClassName="task-filter-select-menu" ariaLabel={`${prefix}${label}`} value={String(layout[field] ?? '')} options={options} disabled={disabled}
        onChange={(value) => onLayoutChange({ [field]: field === 'tagFilter' ? value || null : value })} />
    </div>
  );

  if (mode === 'layout') return <div id={id} role="dialog" aria-label="项目布局设置" className="project-layout-panel pb-3">
    <div className="px-3.5 pt-3 pb-2 text-xs font-semibold text-main">布局</div>
    <div className="project-layout-views" role="group" aria-label="项目视图">
      {PROJECT_VIEWS.map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-pressed={layout.view === value} data-selected={layout.view === value}
        onClick={() => onLayoutChange({ view: value })}><Icon className="h-4 w-4" /><span>{label}</span></button>)}
    </div>
  </div>;

  return <div id={id} role="dialog" aria-label={`${prefix}排序和过滤`} className="project-layout-panel">
    <div className="px-3.5 pt-3 pb-2 text-xs font-semibold text-main">排序和过滤</div>
    <div className="flex items-center justify-between gap-3 px-3.5 py-3 text-xs text-main">
      <span>已完成的任务</span>
      <button type="button" role="switch" aria-label={scope === 'project' ? '显示已完成的项目任务' : '显示已完成的任务'} aria-checked={layout.showCompleted} className="ui-switch"
        data-state={layout.showCompleted ? 'checked' : 'unchecked'} onClick={() => onLayoutChange({ showCompleted: !layout.showCompleted })}><span className="ui-switch-thumb" /></button>
    </div>
    <details open className="project-layout-section">
      <summary>排序<ChevronDown className="h-3.5 w-3.5" /></summary>
      <div className="space-y-1.5 pb-3">
        {select('分组', 'groupMode', GROUPS, scope === 'project' && layout.view !== 'project')}
        {select('排序', 'sortMode', SORTS)}
      </div>
    </details>
    <details open className="project-layout-section">
      <summary>过滤器<ChevronDown className="h-3.5 w-3.5" /></summary>
      <div className="space-y-1.5 pb-3">
        {select('日期', 'dateFilter', DATES)}
        {select('优先级', 'priorityFilter', PRIORITIES)}
        {select('状态', 'statusFilter', STATUSES)}
        {select('标签', 'tagFilter', tagOptions)}
      </div>
    </details>
    <button type="button" className="project-layout-reset" onClick={() => onLayoutChange({ ...DEFAULT_PROJECT_LAYOUT, view: layout.view })}>全部重置</button>
  </div>;
};
