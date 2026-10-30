/**
 * CalendarView.tsx — Unified orchestrator for Calendar views (Day, Week, Month).
 *
 * CALLING SPEC:
 *   <CalendarView
 *     tasks={tasks}
 *     projects={projects}
 *     states={states}
 *     onOpenCreateTaskWithDate={handleCreate}
 *     onOpenEditTask={handleEdit}
 *     canEditTask={canEdit}
 *     onUpdateTask={handleUpdate}
 *     readOnly={readOnly}
 *     compact={compact}
 *     layout={layout}
 *     onLayoutChange={setLayout}
 *   />
 */

import React, { useEffect, useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Task, Project, WeekStartDay, WorkItemState } from '../types';
import { tr, useLocale } from '../i18n';
import { DEFAULT_PROJECT_LAYOUT, ProjectLayout, useTaskToday } from '../utils/taskLayout';
import { selectCalendarTasks } from '../utils/taskCalendarLayout';
import { TaskFilterContext } from './TaskLayoutPanel';
import { TaskFilterSummary } from './TaskFilterSummary';
import { TaskFilterButton } from './TaskFilterButton';
import {
  generateCalendarGrid,
  getStoredWeekStartDay,
  getWeekDays,
  formatYMD,
  WEEK_START_CHANGE_EVENT,
  TAURI_WEEK_START_EVENT,
} from '../utils/calendarGrid';
import { extractTaskTimeRange } from '../utils/calendarLayout';
import { combineTaskDueDate } from '../utils/taskDateTime';
import { PriorityFlag } from './PriorityFlag';
import { CalendarHeader, CalendarViewMode } from './calendar/CalendarHeader';
import { MonthGrid } from './calendar/MonthGrid';
import { AllDayRow } from './calendar/AllDayRow';
import { TimeGrid, VisibleDay } from './calendar/TimeGrid';
import { TaskEventPopover } from './calendar/TaskEventPopover';

interface CalendarViewProps extends TaskFilterContext {
  tasks: Task[];
  projects: Project[];
  states?: WorkItemState[];
  onOpenCreateTaskWithDate: (dateStr: string, timeRange?: { start: string; end: string }) => void;
  onOpenEditTask: (task: Task) => void;
  canEditTask: (task: Task) => boolean;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onDeleteTask?: (id: string) => void;
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
  onDeleteTask,
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
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [showUndated, setShowUndated] = useState(false);
  const [popoverTarget, setPopoverTarget] = useState<{ task: Task; rect: DOMRect } | null>(null);

  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(getStoredWeekStartDay);

  // Sync weekStartDay from localStorage and Tauri events
  useEffect(() => {
    const handleWeekStartChange = (e: CustomEvent<WeekStartDay>) => {
      if (e.detail === 'monday' || e.detail === 'sunday') {
        setWeekStartDay(e.detail);
      }
    };
    window.addEventListener(WEEK_START_CHANGE_EVENT, handleWeekStartChange as EventListener);

    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      listen<WeekStartDay>(TAURI_WEEK_START_EVENT, (event) => {
        if (event.payload === 'monday' || event.payload === 'sunday') {
          setWeekStartDay(event.payload);
        }
      }).then((fn) => {
        unlisten = fn;
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener(WEEK_START_CHANGE_EVENT, handleWeekStartChange as EventListener);
      unlisten?.();
    };
  }, []);

  // Compute active date boundaries based on viewMode
  const activeWeekDays = useMemo(() => {
    return getWeekDays(currentDate, weekStartDay);
  }, [currentDate, weekStartDay]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const activeRange = useMemo(() => {
    if (viewMode === 'day') {
      const ymd = formatYMD(currentDate);
      return { start: ymd, end: ymd };
    }
    if (viewMode === 'week') {
      return {
        start: formatYMD(activeWeekDays[0]),
        end: formatYMD(activeWeekDays[6]),
      };
    }
    // Month view: full 42-cell span
    const grid = generateCalendarGrid(year, month, weekStartDay);
    return {
      start: grid[0].dateStr,
      end: grid[grid.length - 1].dateStr,
    };
  }, [viewMode, currentDate, activeWeekDays, year, month, weekStartDay]);

  const activeLayout = layout || DEFAULT_PROJECT_LAYOUT;
  const taskToday = useTaskToday();
  const todayDate = useMemo(() => new Date(`${taskToday}T00:00:00`), [taskToday]);

  // Filter tasks via existing taskCalendarLayout utility
  const { tasksByDate, undated } = useMemo(() => {
    return selectCalendarTasks(
      tasks,
      activeLayout,
      searchQuery,
      activeRange.start,
      activeRange.end,
      todayDate
    );
  }, [tasks, activeLayout, searchQuery, activeRange, todayDate]);

  // Navigation handlers
  const handlePrev = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewMode === 'day') d.setDate(d.getDate() - 1);
      else if (viewMode === 'week') d.setDate(d.getDate() - 7);
      else d.setMonth(d.getMonth() - 1);
      return d;
    });
    setPopoverTarget(null);
  };

  const handleNext = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewMode === 'day') d.setDate(d.getDate() + 1);
      else if (viewMode === 'week') d.setDate(d.getDate() + 7);
      else d.setMonth(d.getMonth() + 1);
      return d;
    });
    setPopoverTarget(null);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    setPopoverTarget(null);
  };

  // Keyboard shortcuts (T, D, W, M, Arrows)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 't') {
        e.preventDefault();
        handleToday();
      } else if (key === 'd') {
        e.preventDefault();
        setViewMode('day');
      } else if (key === 'w') {
        e.preventDefault();
        setViewMode('week');
      } else if (key === 'm') {
        e.preventDefault();
        setViewMode('month');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode]);

  // Visible days for TimeGrid & AllDayRow
  const visibleDays: VisibleDay[] = useMemo(() => {
    const todayYMD = formatYMD(new Date());
    const days = viewMode === 'day' ? [currentDate] : activeWeekDays;
    return days.map((dateObj) => {
      const dateStr = formatYMD(dateObj);
      return {
        dateStr,
        dateObj,
        dayName: new Intl.DateTimeFormat(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { weekday: 'short' }).format(dateObj),
        dayNum: dateObj.getDate(),
        isToday: dateStr === todayYMD,
      };
    });
  }, [viewMode, currentDate, activeWeekDays, locale]);

  // Separate all-day tasks from timed tasks for visible days
  const allDayTasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const day of visibleDays) {
      const occurrences = tasksByDate.get(day.dateStr) || [];
      const allDays = occurrences
        .map((o) => o.task)
        .filter((t) => extractTaskTimeRange(t).isAllDay);
      map.set(day.dateStr, allDays);
    }
    return map;
  }, [visibleDays, tasksByDate]);

  const handleOpenCreateWithTime = (dateStr: string, timeRange?: { start: string; end: string }) => {
    onOpenCreateTaskWithDate(dateStr, timeRange);
  };

  return (
    <div className="calendar-view flex min-h-0 min-w-0 flex-1 flex-col bg-canvas text-main overflow-hidden" data-compact={compact}>
      {/* Navigation Header */}
      <CalendarHeader
        currentDate={currentDate}
        viewMode={viewMode}
        onViewModeChange={(m) => {
          setViewMode(m);
          setPopoverTarget(null);
        }}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        weekStartDay={weekStartDay}
        compact={compact}
        unscheduledCount={undated.length}
        showUndated={showUndated}
        onToggleShowUndated={() => setShowUndated((prev) => !prev)}
        filterSlot={
          scope === 'task' && layout && onLayoutChange ? (
            <TaskFilterButton
              tasks={tasks}
              layout={layout}
              onLayoutChange={onLayoutChange}
              projects={projects}
              users={users}
              currentUserId={currentUserId}
              activeView="calendar"
            />
          ) : null
        }
      />

      {/* Filter Summary */}
      {layout && (
        <TaskFilterSummary
          tasks={tasks}
          layout={layout}
          onLayoutChange={onLayoutChange}
          projects={projects}
          users={users}
          currentUserId={currentUserId}
          scope={scope}
        />
      )}

      {/* Undated Tasks Drawer (if toggled) */}
      {(showUndated || layout?.dateFilter.includes('unscheduled')) && undated.length > 0 && (
        <div className="calendar-undated shrink-0 max-h-40 overflow-auto border-b border-edge bg-surface px-4 py-2 select-none">
          <p className="mb-1 text-[11px] font-semibold text-sub">
            {tr('tasks:taskLayoutPanel.noDueDate', { count: undated.length })}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1">
            {undated.map((task) => (
              <button
                type="button"
                key={task.id}
                onClick={() => onOpenEditTask(task)}
                className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs text-main hover:bg-hover transition-colors"
              >
                <PriorityFlag priority={task.priority} />
                <span className="truncate flex-1">{task.title}</span>
                {task.startDate && <span className="text-[10px] text-quiet shrink-0">{task.startDate.slice(0, 10)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Calendar Area: Month or Day/Week Grid */}
      {viewMode === 'month' ? (
        <MonthGrid
          year={year}
          month={month}
          weekStartDay={weekStartDay}
          tasksByDate={tasksByDate}
          projects={projects}
          states={states}
          onTaskClick={(task, rect) => setPopoverTarget({ task, rect })}
          onOpenCreateTaskWithDate={onOpenCreateTaskWithDate}
          onSelectDay={(dateStr) => {
            const parts = dateStr.split('-');
            setCurrentDate(new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
            setViewMode('day');
          }}
          readOnly={readOnly}
          compact={compact}
          showLunar={true}
        />
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {/* Day Headers */}
          <div className="flex h-11 w-full shrink-0 items-center border-b border-edge bg-surface select-none">
            <div className="w-14 shrink-0 border-r border-edge" />
            <div className="flex flex-1 min-w-0">
              {visibleDays.map((d) => (
                <div
                  key={d.dateStr}
                  className="flex flex-1 min-w-0 items-center justify-center gap-1.5 border-r border-edge/60 last:border-r-0"
                >
                  <span className="text-xs text-sub font-medium">{d.dayName}</span>
                  <span
                    className={`text-xs font-bold size-6 rounded-full flex items-center justify-center ${
                      d.isToday ? 'bg-accent text-on-accent' : 'text-main'
                    }`}
                  >
                    {d.dayNum}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* All-Day Lane */}
          <AllDayRow
            days={visibleDays}
            allDayTasksByDate={allDayTasksByDate}
            projects={projects}
            states={states}
            onTaskClick={(task, rect) => setPopoverTarget({ task, rect })}
            onCreateTask={onOpenCreateTaskWithDate}
            unscheduledCount={undated.length}
            showUndated={showUndated}
            onToggleUndated={() => setShowUndated((prev) => !prev)}
            compact={compact}
          />

          {/* 24h Time Grid */}
          <TimeGrid
            days={visibleDays}
            tasks={tasks}
            projects={projects}
            states={states}
            onTaskClick={(task, rect) => setPopoverTarget({ task, rect })}
            onOpenCreateTaskWithDate={handleOpenCreateWithTime}
            onUpdateTask={onUpdateTask}
            canEditTask={canEditTask}
          />
        </div>
      )}

      {/* Task Anchor Popover */}
      <TaskEventPopover
        task={popoverTarget?.task || null}
        triggerRect={popoverTarget?.rect || null}
        onClose={() => setPopoverTarget(null)}
        projects={projects}
        states={states}
        onOpenEditTask={onOpenEditTask}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        canEditTask={canEditTask}
      />
    </div>
  );
};
