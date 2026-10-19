import { tr, useLocale } from "../i18n";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Task, Project, StateGroup, WeekStartDay, WorkItemState } from '../types';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Plus,
  Repeat,
  X,
  CheckCircle2,
  Clock,
  Circle,
  AlertOctagon,
} from 'lucide-react';
import { formatRecurrenceLabel } from '../utils/recurrence';
import { splitTaskDueDate } from '../utils/taskDateTime';
import { getLunarDateInfo } from '../utils/lunar';
import { TaskCreateButton } from './TaskCreateButton';
import { TaskFilterButton } from './TaskFilterButton';
import { PriorityFlag } from './PriorityFlag';
import { DEFAULT_PROJECT_LAYOUT, ProjectLayout, groupFilterValue, useTaskToday } from '../utils/taskLayout';
import { selectCalendarTasks } from '../utils/taskCalendarLayout';
import {
  defaultStateFor,
  isBlocked,
  isCompleted,
  resolveTaskGroup,
  resolveTaskStateName,
  STATE_GROUPS,
} from '../utils/workItemState';
import { TaskFilterContext } from './TaskLayoutPanel';
import { TaskFilterSummary } from './TaskFilterSummary';
import {
  generateCalendarGrid,
  getStoredWeekStartDay,
  getWeekdayHeaders,
  WEEK_START_CHANGE_EVENT,
  TAURI_WEEK_START_EVENT,
} from '../utils/calendarGrid';

interface CalendarViewProps extends TaskFilterContext {
  tasks: Task[];
  projects: Project[];
  /** 当前作用域的状态列表。缺省为空时按下发在任务上的状态信息与旧状态取值回退。 */
  states?: WorkItemState[];
  onOpenCreateTaskWithDate: (dateStr: string) => void;
  onOpenEditTask: (task: Task) => void;
  canEditTask: (task: Task) => boolean;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  readOnly?: boolean;
  compact?: boolean;
  layout?: ProjectLayout;
  onLayoutChange?: (patch: Partial<ProjectLayout>) => void;
  searchQuery?: string;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  tasks,
  projects,
  states = [],
  onOpenCreateTaskWithDate,
  onOpenEditTask,
  canEditTask,
  onUpdateTask,
  readOnly = false,
  compact = false,
  layout,
  onLayoutChange,
  searchQuery = '',
  scope = 'task',
  users,
  currentUserId,
}) => {
  const { locale } = useLocale();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showUndated, setShowUndated] = useState(false);
  const [taskAreaHeight, setTaskAreaHeight] = useState(0);
  const taskAreaRef = useRef<HTMLDivElement>(null);
  const [showLunar, setShowLunar] = useState<boolean>(() => {
    return localStorage.getItem('lanmind_show_lunar') !== 'false';
  });
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(getStoredWeekStartDay);

  useEffect(() => {
    const handleLunarChange = (e: CustomEvent<boolean>) => {
      setShowLunar(e.detail);
    };
    const handleWeekStartChange = (e: CustomEvent<WeekStartDay>) => {
      if (e.detail === 'monday' || e.detail === 'sunday') {
        setWeekStartDay(e.detail);
      }
    };
    window.addEventListener('lanmind-lunar-change', handleLunarChange as EventListener);
    window.addEventListener(WEEK_START_CHANGE_EVENT, handleWeekStartChange as EventListener);
    let unlistenWeekStart: (() => void) | undefined;
    if (isTauri()) {
      listen<WeekStartDay>(TAURI_WEEK_START_EVENT, (event) => {
        if (event.payload === 'monday' || event.payload === 'sunday') {
          setWeekStartDay(event.payload);
        }
      }).then((fn) => {
        unlistenWeekStart = fn;
      }).catch(() => {});
    }
    return () => {
      window.removeEventListener('lanmind-lunar-change', handleLunarChange as EventListener);
      window.removeEventListener(WEEK_START_CHANGE_EVENT, handleWeekStartChange as EventListener);
      unlistenWeekStart?.();
    };
  }, []);

  const formatDateKey = (date: Date) => {
    const dateYear = date.getFullYear();
    const dateMonth = String(date.getMonth() + 1).padStart(2, '0');
    const dateDay = String(date.getDate()).padStart(2, '0');
    return `${dateYear}-${dateMonth}-${dateDay}`;
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  // Build grid dates
  const gridCells = useMemo(
    () => generateCalendarGrid(year, month, weekStartDay),
    [year, month, weekStartDay]
  );

  const todayFormatted = useTaskToday();
  const monthStart = formatDateKey(new Date(year, month, 1));
  const monthEnd = formatDateKey(new Date(year, month + 1, 0));
  /**
   * 日历在没有外部布局时自带一套默认筛选：展示全部状态组。
   * 筛选取值只能是状态 id 或 `group:<组>` 令牌，旧的状态字面量不会命中任何工作项。
   */
  const fallbackLayout = useMemo<ProjectLayout>(
    () => ({ ...DEFAULT_PROJECT_LAYOUT, showCompleted: true, statusFilter: STATE_GROUPS.map(groupFilterValue) }),
    [],
  );
  const { tasksByDate, undated } = useMemo(() => selectCalendarTasks(tasks, layout || fallbackLayout, searchQuery, monthStart, monthEnd, new Date(todayFormatted + 'T12:00:00')),
    [tasks, layout, fallbackLayout, searchQuery, monthStart, monthEnd, todayFormatted, locale]);
  const unscheduledTaskCount = undated.length;
  const selectedDayTasks = selectedDate ? tasksByDate.get(selectedDate) || [] : [];
  const minimumCellHeight = compact ? 82 : 100;
  const firstCurrentMonthIndex = gridCells.findIndex((cell) => cell.isCurrentMonth);
  // Measure the flex area itself, including browser zoom and wrapped toolbars.
  const getVisibleTaskLimit = (count: number) => {
    const availableHeight = taskAreaHeight || minimumCellHeight - (compact ? 39 : 47);
    const capacity = Math.max(0, Math.min(6, Math.floor((availableHeight + 2) / 22)));
    return count > capacity ? Math.max(0, capacity - 1) : capacity;
  };

  /** 状态推进与看板一致：有状态定义时按定义顺序前进，否则按状态组循环。 */
  const handleToggleStatus = (task: Task) => {
    if (!canEditTask(task)) return;
    const projectId = task.projectId ?? null;
    const groupCycle: Record<StateGroup, StateGroup> = {
      backlog: 'unstarted',
      unstarted: 'started',
      started: 'completed',
      completed: 'backlog',
      cancelled: 'backlog',
    };
    const target = defaultStateFor(states, projectId, groupCycle[resolveTaskGroup(task, states)]);
    if (target) onUpdateTask(task.id, { stateId: target.id });
  };

  /** 状态图标按状态组决定；阻塞与进行中同属 started 组，按名称区分。着色取该状态自身的颜色。 */
  const getStatusIcon = (task: Task, interactive = true, size: 'sm' | 'md' = 'sm') => {
    const iconSizeClass = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
    const interactionClass = interactive
      ? 'cursor-pointer hover:scale-110 transition-transform'
      : 'cursor-not-allowed opacity-60';
    const group = resolveTaskGroup(task, states);
    const style = { color: states.find((item) => item.id === task.stateId)?.color ?? `var(--state-${group})` };
    if (group === 'completed') {
      return <CheckCircle2 className={`${iconSizeClass} shrink-0 ${interactionClass}`} style={style} />;
    }
    if (group === 'cancelled') {
      return <X className={`${iconSizeClass} shrink-0 ${interactionClass}`} style={style} />;
    }
    if (group === 'started') {
      return isBlocked(task, states)
        ? <AlertOctagon className={`${iconSizeClass} shrink-0 ${interactionClass}`} style={style} />
        : <Clock className={`${iconSizeClass} shrink-0 ${interactionClass} ${interactive ? 'animate-pulse' : ''}`} style={style} />;
    }
    return <Circle className={`${iconSizeClass} shrink-0 ${interactionClass} ${interactive ? 'hover:opacity-80' : ''}`} style={style} />;
  };

  /**
   * 图标按钮的提示文案。状态名来自状态定义，读出来的是用户自己起的名字。
   * 分组文案仍用既有键，键里没有插槽，状态名随在提示之后给出。
   */
  const statusToggleTitle = (task: Task) => {
    const group = resolveTaskGroup(task, states);
    const hint = group === 'completed'
      ? tr("calendar:calendarView.restoreToToDo")
      : group === 'started'
        ? tr("calendar:calendarView.completeTask")
        : group === 'unstarted' || group === 'backlog'
          ? tr("calendar:calendarView.startTaskMarkAsInProgress")
          : tr("calendar:calendarView.changeStatus");
    return `${hint} · ${resolveTaskStateName(task, states)}`;
  };

  useEffect(() => {
    const area = taskAreaRef.current;
    if (!area) return;
    const updateHeight = () => setTaskAreaHeight(area.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(area);
    return () => observer.disconnect();
  }, [year, month, weekStartDay, compact]);

  return (
    <div className="calendar-view flex min-h-0 min-w-0 flex-1 flex-col bg-canvas text-main overflow-hidden" data-compact={compact}>
      {/* Calendar Navigation Header */}
      <div className={`calendar-navigation shrink-0 bg-surface border-b border-edge flex flex-wrap items-center justify-between gap-2 ${compact ? 'px-3 py-2' : 'p-4'}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CalendarIcon className={`${compact ? 'h-4 w-4' : 'h-5 w-5'} shrink-0 text-info`} />
          <h2 className={`${compact ? 'text-sm' : 'text-base'} font-bold text-main`}>{tr("calendar:calendarView.calendar", { value0: year, value1: month + 1 })}</h2>
          {unscheduledTaskCount > 0 && (
            <button type="button" aria-expanded={showUndated} onClick={() => setShowUndated((value) => !value)} className="rounded border border-subtle bg-card px-2 py-0.5 text-[10px] text-sub">{tr('tasks:taskLayoutPanel.noDueDate', { count: unscheduledTaskCount })}</button>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {scope === 'task' && layout && onLayoutChange && (
            <TaskFilterButton tasks={tasks} layout={layout} onLayoutChange={onLayoutChange} projects={projects} users={users} currentUserId={currentUserId} activeView="calendar" />
          )}
          <button
            onClick={goToToday}
            className="px-2.5 py-1 text-xs bg-card hover:bg-hover text-main border border-subtle rounded-lg transition-colors font-medium"
          >
            {tr("calendar:calendarView.today")}</button>
          <div className="flex items-center space-x-1 border border-subtle rounded-lg bg-card p-0.5">
            <button
              onClick={prevMonth}
              className="p-1 hover:bg-hover rounded text-sub transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={nextMonth}
              className="p-1 hover:bg-hover rounded text-sub transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Days of Week Bar */}
      {layout && <TaskFilterSummary tasks={tasks} layout={layout} onLayoutChange={onLayoutChange} projects={projects} users={users} currentUserId={currentUserId} scope={scope} />}
      {(showUndated || layout?.dateFilter.includes('unscheduled')) && undated.length > 0 && <div className="calendar-undated shrink-0 max-h-40 overflow-auto border-b border-edge bg-surface px-4 py-2">
        <p className="mb-1 text-[11px] font-semibold text-sub">{tr('tasks:taskLayoutPanel.noDueDate', { count: undated.length })}</p>
        {undated.map((task) => <button type="button" key={task.id} onClick={() => onOpenEditTask(task)} className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-main hover:bg-hover"><PriorityFlag priority={task.priority} /><span className="truncate">{task.title}</span>{task.startDate && <span className="ml-auto text-[10px] text-quiet">{task.startDate.slice(0, 10)}</span>}</button>)}
      </div>}
      {tasksByDate.size === 0 && undated.length === 0 && <p role="status" className="shrink-0 px-4 py-2 text-xs text-quiet">{tr('tasks:taskLayoutPanel.noMatches')}</p>}
      <div className={`grid shrink-0 grid-cols-7 bg-surface/60 border-b border-edge text-center text-xs font-semibold text-sub ${compact ? 'py-1.5' : 'py-2'}`}>
        {getWeekdayHeaders(weekStartDay, 'bilingual').map((header) => (
          <div key={header}>{header}</div>
        ))}
      </div>

      {/* Calendar Days Grid */}
      <div
        className="calendar-days-grid grid min-h-0 flex-1 grid-cols-7 gap-x-px gap-y-1 overflow-y-auto bg-card/80"
        style={{ gridTemplateRows: `repeat(6, minmax(${minimumCellHeight}px, 1fr))` }}
      >
        {gridCells.map((cell, index) => {
          if (!cell.isCurrentMonth) {
            const lunar = showLunar ? getLunarDateInfo(cell.dateStr) : null;
            return (
              <div key={cell.dateStr || index} className={`${compact ? 'p-1.5' : 'p-2'} min-w-0 bg-canvas/40 text-xs text-quiet select-none`}>
                <div className="flex items-center gap-1.5">
                  <span>{cell.dayNum}</span>
                  {lunar && <span className="truncate text-[10px] text-quiet">{lunar.label}</span>}
                </div>
              </div>
            );
          }

          const dayTasks = tasksByDate.get(cell.dateStr) || [];
          const visibleTaskLimit = getVisibleTaskLimit(dayTasks.length);
          const isToday = cell.dateStr === todayFormatted;

          return (
            <div
              key={cell.dateStr}
              data-calendar-date={cell.dateStr}
              className={`calendar-day group flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-edge/50 bg-surface/90 ${compact ? 'p-1.5' : 'p-2'} transition-colors hover:bg-hover/80 ${
                isToday ? 'bg-info/10 ring-1 ring-accent/50' : ''
              }`}
            >
                <div className={`flex shrink-0 items-center justify-between ${compact ? 'h-[22px]' : 'h-[26px]'}`}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedDate(cell.dateStr)}
                      aria-label={tr("calendar:calendarView.viewTasksFor", { value0: cell.dateStr })}
                      className={`text-xs font-bold ${compact ? 'h-5 w-5' : 'h-6 w-6'} shrink-0 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        isToday
                          ? 'bg-accent text-on-accent shadow-panel shadow-accent/40 hover:bg-accent/90 hover:scale-110'
                          : 'text-sub hover:bg-hover/60 hover:text-main hover:scale-110'
                      }`}
                    >
                      {cell.dayNum}
                    </button>
                    {showLunar && (() => {
                      const lunar = getLunarDateInfo(cell.dateStr);
                      return (
                        <span
                          className={`text-[10px] leading-none truncate ${
                            lunar.isFestival
                              ? 'text-warning font-semibold'
                              : lunar.isSolarTerm
                              ? 'text-success font-semibold'
                              : 'text-sub'
                          }`}
                          title={lunar.fullText}
                        >
                          {lunar.label}
                        </span>
                      );
                    })()}
                  </div>

                  <button
                    hidden={readOnly}
                    onClick={() => onOpenCreateTaskWithDate(cell.dateStr)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-sub hover:text-info hover:bg-hover rounded transition-all"
                    title={tr("calendar:calendarView.createATaskOnThisDate")}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Day Tasks List */}
                <div ref={index === firstCurrentMonthIndex ? taskAreaRef : undefined} className="calendar-day-tasks mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                  {dayTasks.slice(0, visibleTaskLimit).map((occurrence) => {
                    const t = occurrence.task;
                    const dueTime = splitTaskDueDate(occurrence.dueDate).time;
                    const priorityColor =
                      t.priority === 'P1'
                        ? 'border-l-danger bg-danger/10 text-danger'
                        : t.priority === 'P2'
                        ? 'border-l-warning bg-warning/10 text-warning'
                        : t.priority === 'P3'
                        ? 'border-l-info bg-info/10 text-info'
                        : 'border-l-subtle bg-card/60 text-sub';

                    return (
                      <div
                        key={`${t.id}-${occurrence.dueDate}`}
                        onClick={() => onOpenEditTask(t)}
                        className={`calendar-task group/task flex h-5 shrink-0 items-center gap-1 overflow-hidden rounded border-l-2 px-1 text-[11px] leading-4 transition-all ${canEditTask(t) ? 'cursor-pointer hover:scale-[1.01]' : 'cursor-default opacity-75'} ${priorityColor} ${
                          isCompleted(t, states) ? 'line-through opacity-60' : ''
                        }`}
                        title={`${dueTime ? `${dueTime} ` : ''}${t.title} (${t.priority})`}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleStatus(t);
                          }}
                          disabled={!canEditTask(t)}
                          className={`flex-shrink-0 p-0.5 rounded transition-colors ${
                            canEditTask(t) ? 'hover:bg-hover/60' : 'cursor-default'
                          }`}
                          title={statusToggleTitle(t)}
                        >
                          {getStatusIcon(t, canEditTask(t), 'sm')}
                        </button>
                        {t.recurrence && t.recurrence !== 'none' && (
                          <Repeat className="w-2.5 h-2.5 text-info flex-shrink-0" />
                        )}
                        {dueTime && <span className="flex-shrink-0 font-mono text-[9px]">{dueTime}</span>}
                        <span className="truncate flex-1">{t.title}</span>
                      </div>
                    );
                  })}
                  {dayTasks.length > visibleTaskLimit && (
                    <button
                      type="button"
                      onClick={() => setSelectedDate(cell.dateStr)}
                      aria-label={tr("calendar:calendarView.viewAllTasksFor", { value0: cell.dateStr, value1: dayTasks.length })}
                      title={tr("calendar:calendarView.viewAllTasks", { value0: dayTasks.length })}
                      className="calendar-more block h-5 w-full shrink-0 truncate rounded px-1 text-left text-[10px] font-medium leading-5 text-info transition-colors hover:bg-info/10"
                    >{tr("calendar:calendarView.viewAll", { value0: dayTasks.length })}</button>
                  )}
                </div>
            </div>
          );
        })}
      </div>

      {selectedDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm"
          onClick={() => setSelectedDate(null)}
        >
          <div
            className="flex max-h-[75vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-subtle bg-surface shadow-popover"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={tr("calendar:calendarView.tasksFor", { value0: selectedDate })}
          >
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-main">{tr("calendar:calendarView.tasksFor2", { value0: selectedDate })}</h3>
                <p className="mt-0.5 text-[11px] text-quiet">{tr("calendar:calendarView.total", { value0: selectedDayTasks.length })}</p>
              </div>
              <div className="flex items-center gap-2">
                {!readOnly && <TaskCreateButton onClick={() => {
                    if (!readOnly) onOpenCreateTaskWithDate(selectedDate);
                    setSelectedDate(null);
                  }} />}
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-sub transition-colors hover:bg-hover hover:text-main"
                  title={tr("calendar:calendarView.closeDailyTasks")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {selectedDayTasks.length === 0 ? (
                <div className="py-10 text-center text-xs text-quiet">{tr("calendar:calendarView.noTasksOnThisDate")}</div>
              ) : (
                selectedDayTasks.map((occurrence) => {
                  const task = occurrence.task;
                  const dueTime = splitTaskDueDate(occurrence.dueDate).time;
                  const project = projects.find((item) => item.id === task.projectId);
                  const group = resolveTaskGroup(task, states);
                  return (
                    <div
                      key={`${task.id}-${occurrence.dueDate}`}
                      className={`group flex w-full items-center gap-3 rounded-md border border-edge bg-canvas/70 p-3 transition-colors ${
                        canEditTask(task)
                          ? 'hover:border-subtle hover:bg-hover/50'
                          : 'opacity-75'
                      }`}
                    >
                      <span
                        className={`h-8 w-1 flex-shrink-0 rounded-full ${
                          task.priority === 'P1'
                            ? 'bg-danger'
                            : task.priority === 'P2'
                              ? 'bg-warning'
                              : task.priority === 'P3'
                                ? 'bg-info'
                                : 'bg-muted'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleStatus(task);
                        }}
                        disabled={!canEditTask(task)}
                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
                          canEditTask(task)
                            ? 'hover:bg-hover text-sub hover:text-main'
                            : 'cursor-not-allowed text-quiet'
                        }`}
                        title={statusToggleTitle(task)}
                      >
                        {getStatusIcon(task, canEditTask(task), 'md')}
                      </button>
                      <div
                        onClick={() => {
                          onOpenEditTask(task);
                          setSelectedDate(null);
                        }}
                        className={`min-w-0 flex-1 ${canEditTask(task) ? 'cursor-pointer' : 'cursor-default'}`}
                        title={canEditTask(task) ? tr("calendar:calendarView.editTaskDetails") : undefined}
                      >
                        <span
                          className={`block truncate text-xs font-semibold text-main ${
                            isCompleted(task, states) ? 'line-through opacity-60' : ''
                          }`}
                        >
                          {task.title}
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-[10px] text-quiet">
                          {dueTime && <span className="font-mono">{dueTime}</span>}
                          {project && <span className="truncate max-w-[120px]" title={project.name}>{project.name}</span>}
                          <span className="inline-flex items-center gap-1" title={resolveTaskStateName(task, states)}><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: states.find((item) => item.id === task.stateId)?.color ?? `var(--state-${group})` }} />{resolveTaskStateName(task, states)}</span>
                          <span className="inline-flex items-center gap-1"><PriorityFlag priority={task.priority} />{task.priority}</span>
                          {task.recurrence && task.recurrence !== 'none' && (
                            <span>{formatRecurrenceLabel(task.recurrence, task.recurrenceRule, task.dueDate)}</span>
                          )}
                        </span>
                      </div>
                      {canEditTask(task) && (
                        <div className="flex items-center gap-1.5">
                          {group === 'backlog' || group === 'unstarted' ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const target = defaultStateFor(states, task.projectId ?? null, 'started');
                                if (target) onUpdateTask(task.id, { stateId: target.id });
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-info/15 text-info border border-info/30 hover:bg-info/25 transition-colors"
                              title={tr("calendar:calendarView.startTask")}
                            >
                              <Clock className="w-3.5 h-3.5" />
                              <span>{tr("calendar:calendarView.start")}</span>
                            </button>
                          ) : null}
                          {group === 'started' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const target = defaultStateFor(states, task.projectId ?? null, 'completed');
                                if (target) onUpdateTask(task.id, { stateId: target.id });
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-success/15 text-success border border-success/30 hover:bg-success/25 transition-colors"
                              title={tr("calendar:calendarView.completeTask2")}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>{tr("calendar:calendarView.complete")}</span>
                            </button>
                          )}
                          {isCompleted(task, states) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const target = defaultStateFor(states, task.projectId ?? null, 'unstarted');
                                if (target) onUpdateTask(task.id, { stateId: target.id });
                              }}
                              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-card text-sub border border-subtle hover:bg-hover hover:text-main transition-colors"
                              title={tr("calendar:calendarView.restoreToDo")}
                            >
                              <span>{tr("calendar:calendarView.restoreToDo")}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
