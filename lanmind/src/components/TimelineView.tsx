import { currentLocale, tr, useLocale } from "../i18n";
import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Layers3 } from 'lucide-react';
import { Project, Task, User } from '../types';
import { getStoredRestDays } from '../utils/restDays';
import { filterTasksByLayout, ProjectLayout } from '../utils/taskLayout';
import { TaskFilterButton } from './TaskFilterButton';

interface TimelineViewProps {
  tasks: Task[];
  projects: Project[];
  users: User[];
  canEditTask: (task: Task) => boolean;
  onOpenEditTask: (task: Task) => void;
  layout?: ProjectLayout;
  onLayoutChange?: (patch: Partial<ProjectLayout>) => void;
  searchQuery?: string;
}

type RangeDays = 7 | 14;
const TASK_COLUMN_WIDTH = 176;
const MIN_DAY_WIDTH = 44;
const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const fromKey = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`);
const dayDiff = (left: Date, right: Date) => (Date.UTC(left.getFullYear(), left.getMonth(), left.getDate()) - Date.UTC(right.getFullYear(), right.getMonth(), right.getDate())) / 86_400_000;
const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const startAroundToday = (days: RangeDays) => addDays(new Date(), days === 7 ? -1 : -2);

export const TimelineView: React.FC<TimelineViewProps> = ({ tasks, projects, users, canEditTask, onOpenEditTask, layout, onLayoutChange, searchQuery = '' }) => {
  useLocale();
  const [range, setRange] = useState<{ start: Date; days: RangeDays }>(() => ({ start: startAroundToday(7), days: 7 }));
  const rangeStart = range.start;
  const rangeDays = range.days;
  const rangeEnd = addDays(rangeStart, rangeDays - 1);
  const todayKey = dateKey(new Date());
  const restDays = getStoredRestDays();
  const days = useMemo(() => Array.from({ length: rangeDays }, (_, index) => addDays(rangeStart, index)), [rangeStart, rangeDays]);
  const rowStyle = { gridTemplateColumns: `${TASK_COLUMN_WIDTH}px minmax(0, 1fr)` };
  const daysStyle = { gridTemplateColumns: `repeat(${rangeDays}, minmax(0, 1fr))` };
  const visibleTasks = useMemo(
    () => layout ? filterTasksByLayout(tasks, layout, searchQuery) : tasks,
    [tasks, layout, searchQuery],
  );

  const moveRange = (amount: number) => setRange((current) => ({ ...current, start: addDays(current.start, amount * current.days) }));
  const changeRangeDays = (days: RangeDays) => setRange((current) => ({
    days,
    // Keep the user's browsed date when changing scale; re-anchor the current period around today.
    start: dateKey(current.start) === dateKey(startAroundToday(current.days)) ? startAroundToday(days) : current.start,
  }));
  const taskBar = (task: Task) => {
    const start = fromKey(task.startDate || task.dueDate || '');
    const end = fromKey(task.dueDate || task.startDate || '');
    const firstDay = dayDiff(start, rangeStart);
    const lastDay = dayDiff(end, rangeStart);
    if (!Number.isFinite(firstDay) || !Number.isFinite(lastDay) || lastDay < firstDay || lastDay < 0 || firstDay >= rangeDays) return null;
    const startOffset = Math.max(0, firstDay);
    const endOffset = Math.min(rangeDays - 1, lastDay);
    return {
      left: `calc(${startOffset / rangeDays * 100}% + 3px)`,
      width: `calc(${(endOffset - startOffset + 1) / rangeDays * 100}% - 6px)`,
      continuesBefore: firstDay < 0,
      continuesAfter: lastDay >= rangeDays,
    };
  };
  const scheduled = visibleTasks.filter((task) => Boolean(task.startDate || task.dueDate));
  const visibleScheduled = scheduled.flatMap((task) => {
    const bar = taskBar(task);
    return bar ? [{ task, bar }] : [];
  });
  const outsideCount = scheduled.length - visibleScheduled.length;
  const unscheduled = visibleTasks.filter((task) => !task.startDate && !task.dueDate);

  const statusClass = (task: Task) => task.status === 'completed'
    ? 'bg-success/20 border-success/50 text-success'
    : task.status === 'blocked'
      ? 'bg-danger/20 border-danger/50 text-danger'
      : task.status === 'abandoned'
        ? 'bg-card border-subtle text-quiet'
        : 'bg-info/20 border-info/50 text-info';

  return (
    <div className="timeline-view flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas text-main">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-edge bg-surface px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold"><Clock3 className="h-4 w-4 text-info" />{tr("calendar:timelineView.timeline")}</h2>
          <p className="mt-0.5 text-[11px] text-sub" aria-live="polite">{tr("calendar:timelineView.tasks", { value0: dateKey(rangeStart), value1: dateKey(rangeEnd), value2: visibleScheduled.length, value3: outsideCount > 0 ? tr('calendar:timeline.outsideCount', { count: outsideCount }) : '' })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {layout && onLayoutChange && (
            <TaskFilterButton tasks={tasks} layout={layout} onLayoutChange={onLayoutChange} />
          )}
          <div role="group" aria-label={tr("calendar:timelineView.timelineDays")} className="flex items-center rounded-md border border-subtle bg-card p-0.5">
            {([7, 14] as const).map((days) => <button key={days} type="button" aria-pressed={rangeDays === days} onClick={() => changeRangeDays(days)} className={`h-7 rounded px-2.5 text-[11px] font-medium transition-colors ${rangeDays === days ? 'bg-info/15 text-info' : 'text-sub hover:bg-hover hover:text-main'}`}>{tr("calendar:timelineView.days", { value0: days })}</button>)}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => moveRange(-1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-main" title={tr("calendar:timelineView.previousDays", { value0: rangeDays })} aria-label={tr("calendar:timelineView.previousDays", { value0: rangeDays })}><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => setRange((current) => ({ ...current, start: startAroundToday(current.days) }))} className="h-8 rounded-md border border-subtle px-2.5 text-[11px] text-sub hover:bg-hover hover:text-main">{tr("calendar:timelineView.backToToday")}</button>
            <button type="button" onClick={() => moveRange(1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sub hover:bg-hover hover:text-main" title={tr("calendar:timelineView.nextDays", { value0: rangeDays })} aria-label={tr("calendar:timelineView.nextDays", { value0: rangeDays })}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <div className="timeline-scroll min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <div className="timeline-grid" style={{ minWidth: TASK_COLUMN_WIDTH + rangeDays * MIN_DAY_WIDTH }}>
          <div className="sticky top-0 z-20 grid border-b border-edge bg-surface" style={rowStyle}>
            <div className="sticky left-0 z-30 flex items-center border-r border-edge bg-surface px-3 py-2 text-[11px] font-semibold text-sub">{tr("calendar:timelineView.task")}</div>
            <div className="grid" style={daysStyle}>
              {days.map((day) => {
                const isToday = dateKey(day) === todayKey;
                const isRest = restDays.includes(day.getDay() === 0 ? 7 : day.getDay());
                return <div key={dateKey(day)} data-timeline-date={dateKey(day)} aria-current={isToday ? 'date' : undefined} className={`border-r border-edge px-1 py-2 text-center text-[10px] ${isToday ? 'bg-info/10 font-semibold text-info' : isRest ? 'bg-warning/5 text-warning' : 'text-sub'}`}><div>{day.getMonth() + 1}/{day.getDate()}</div><div className={`mt-0.5 text-[9px] ${isToday ? 'text-info' : 'text-quiet'}`}>{isToday ? tr("calendar:timelineView.today") : tr("calendar:timelineView.text", { value0: new Intl.DateTimeFormat(currentLocale(), { weekday: 'short' }).format(day) })}</div></div>;
              })}
            </div>
          </div>

          {visibleScheduled.map(({ task, bar }) => {
            const project = projects.find((item) => item.id === task.projectId);
            const assignee = users.find((item) => item.id === task.assigneeId);
            return <div key={task.id} className="grid border-b border-edge/80 bg-surface/30" style={rowStyle}>
              <button type="button" onClick={() => onOpenEditTask(task)} disabled={!canEditTask(task)} title={task.title} className="sticky left-0 z-10 flex min-w-0 items-center gap-2 border-r border-edge bg-surface px-3 py-2 text-left disabled:cursor-default">
                <span className={`h-2 w-2 shrink-0 rounded-full ${task.status === 'completed' ? 'bg-success' : task.status === 'blocked' ? 'bg-danger' : 'bg-info'}`} />
                <span className="min-w-0 flex-1 truncate text-xs text-main">{task.title}</span>
                {task.parentTaskId && <Layers3 className="h-3 w-3 shrink-0 text-info" />}
              </button>
              <div className="relative h-11 min-w-0">
                <div className="pointer-events-none absolute inset-0 grid" style={daysStyle} aria-hidden="true">
                  {days.map((day) => <span key={dateKey(day)} className={`border-r border-edge/50 ${dateKey(day) === todayKey ? 'border-l border-l-info/40 bg-info/5' : restDays.includes(day.getDay() === 0 ? 7 : day.getDay()) ? 'bg-warning/[0.025]' : ''}`} />)}
                </div>
                <button type="button" onClick={() => onOpenEditTask(task)} disabled={!canEditTask(task)} aria-label={tr("calendar:timelineView.viewTask", { value0: task.title })} className={`absolute top-2 flex h-7 items-center gap-0.5 overflow-hidden rounded-md border px-1.5 text-left text-[10px] font-semibold shadow-soft transition-transform hover:-translate-y-0.5 disabled:cursor-default ${statusClass(task)}`} style={{ left: bar.left, width: bar.width }} title={tr("calendar:timelineView.text2", { value0: task.title, value1: (task.startDate || task.dueDate || '').slice(0, 10), value2: (task.dueDate || task.startDate || '').slice(0, 10), value3: assignee ? ` · ${assignee.nickname}` : '', value4: project ? ` · ${project.name}` : '' })}>
                  {bar.continuesBefore && <ChevronLeft className="h-3 w-3 shrink-0" aria-label={tr("calendar:timelineView.startedBeforeThisPeriod")} />}
                  <span className="min-w-0 flex-1 truncate">{task.progress && task.progress < 100 ? `${task.progress}% · ` : ''}{task.title}</span>
                  {bar.continuesAfter && <ChevronRight className="h-3 w-3 shrink-0" aria-label={tr("calendar:timelineView.continuesAfterThisPeriod")} />}
                </button>
              </div>
            </div>;
          })}

          {visibleScheduled.length === 0 && <div className="py-10 text-center text-xs text-quiet">{tr("calendar:timelineView.noScheduledTasksInThisPeriod", { value0: outsideCount > 0 ? tr('common:labels.outsidePeriod') : '' })}</div>}
        </div>
        {unscheduled.length > 0 && <div className="mt-4 border-t border-edge pt-3"><div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-sub"><Layers3 className="h-3.5 w-3.5 text-quiet" />{tr("calendar:timelineView.unscheduled")}{unscheduled.length})</div><div className="flex flex-wrap gap-2">{unscheduled.map((task) => <button key={task.id} type="button" onClick={() => onOpenEditTask(task)} disabled={!canEditTask(task)} className="max-w-full truncate rounded-md border border-subtle bg-surface px-2.5 py-1.5 text-xs text-sub hover:border-accent/50 hover:text-main disabled:cursor-default" title={task.title}>{task.title}</button>)}</div></div>}
      </div>
    </div>
  );
};
