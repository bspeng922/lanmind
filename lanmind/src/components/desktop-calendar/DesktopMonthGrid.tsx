/**
 * DesktopMonthGrid.tsx — 42-cell wallpaper-friendly desktop month grid.
 *
 * CALLING SPEC:
 *   <DesktopMonthGrid
 *     currentDate={currentDate}
 *     tasks={tasks}
 *     projects={projects}
 *     weekStartDay={weekStartDay}
 *     showCompleted={showCompleted}
 *     isLight={isLight}
 *     showLunar={showLunar}
 *     onToggleTask={handleToggleTask}
 *     onOpenNewTask={handleOpenNewTask}
 *     updatingTaskIds={updatingTaskIds}
 *   />
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { Task, Project, WeekStartDay } from '../../types';
import { tr } from '../../i18n';
import { generateCalendarGrid, getWeekdayHeaders, formatYMD } from '../../utils/calendarGrid';
import { getLunarDateInfo } from '../../utils/lunar';
import { expandTaskOccurrences, TaskOccurrence } from '../../utils/recurrence';
import { splitTaskDueDate } from '../../utils/taskDateTime';
import { PriorityFlag } from '../PriorityFlag';
import { ThemeCheckbox } from '../ThemeCheckbox';
import { getTaskEventStyle } from '../../utils/calendarTokens';

const CHIP_HEIGHT = 18; // h-4.5 (18px)
const CHIP_GAP = 2; // gap-0.5 (2px)
const CHIP_STEP = CHIP_HEIGHT + CHIP_GAP;
const MORE_BUTTON_HEIGHT = 16; // h-4 (16px)

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getVisibleTaskLimit(taskCount: number, areaHeight: number): number {
  if (taskCount <= 0) return 0;
  if (areaHeight <= 0) return Math.min(taskCount, 3);

  const maxWithoutMore = Math.max(0, Math.floor((areaHeight + CHIP_GAP) / CHIP_STEP));
  if (taskCount <= maxWithoutMore) {
    return taskCount;
  }

  if (areaHeight < MORE_BUTTON_HEIGHT) {
    return 0;
  }

  const maxWithMore = Math.max(0, Math.floor((areaHeight - MORE_BUTTON_HEIGHT) / CHIP_STEP));
  return Math.min(taskCount - 1, maxWithMore);
}

interface DayPopoverPosition {
  top: number;
  left: number;
  originClass: string;
}

interface DesktopMonthGridProps {
  currentDate: Date;
  tasks: Task[];
  projects?: Project[];
  weekStartDay: WeekStartDay;
  showCompleted: boolean;
  isLight: boolean;
  showLunar?: boolean;
  onToggleTask: (task: Task) => void;
  onOpenNewTask: (dateStr: string) => void;
  onTaskClick?: (task: Task) => void;
  updatingTaskIds?: Set<string>;
}

export function DesktopMonthGrid({
  currentDate,
  tasks,
  projects = [],
  weekStartDay,
  showCompleted,
  isLight,
  showLunar = true,
  onToggleTask,
  onOpenNewTask,
  onTaskClick,
  updatingTaskIds = new Set(),
}: DesktopMonthGridProps) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const todayYMD = formatYMD(new Date());

  const taskAreaRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [taskAreaHeight, setTaskAreaHeight] = useState(0);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<DayPopoverPosition | null>(null);

  const gridCells = useMemo(() => {
    return generateCalendarGrid(year, month, weekStartDay);
  }, [year, month, weekStartDay]);

  const weekdayHeaders = useMemo(() => {
    return getWeekdayHeaders(weekStartDay, 'short');
  }, [weekStartDay]);

  // Expand occurrences for the 42 cells
  const tasksByDate = useMemo(() => {
    if (gridCells.length === 0) return new Map<string, TaskOccurrence[]>();
    const start = gridCells[0].dateStr;
    const end = gridCells[gridCells.length - 1].dateStr;

    const map = new Map<string, TaskOccurrence[]>();
    for (const t of tasks) {
      const occurrences = expandTaskOccurrences(t, start, end);
      for (const occ of occurrences) {
        const isDone = occ.task.status === 'completed';
        if (!showCompleted && isDone) continue;
        const list = map.get(occ.dateKey) || [];
        list.push(occ);
        map.set(occ.dateKey, list);
      }
    }
    return map;
  }, [gridCells, tasks, showCompleted]);

  const closeDayPopover = useCallback(() => {
    setExpandedDay(null);
    setPopoverPos(null);
  }, []);

  // Dynamically observe cell task-area height so visible chip count adapts to window resize
  useEffect(() => {
    const area = taskAreaRef.current;
    if (!area) return;

    const updateHeight = () => {
      setTaskAreaHeight(area.clientHeight);
    };

    updateHeight();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateHeight);
      observer.observe(area);
    }
    window.addEventListener('resize', updateHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, [year, month, weekStartDay]);

  // Close day popover on month switch
  useEffect(() => {
    closeDayPopover();
  }, [year, month, weekStartDay, closeDayPopover]);

  // Dismiss day popover on outside click, Escape, or window resize
  useEffect(() => {
    if (!expandedDay) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (popoverRef.current?.contains(target)) return;
      if (target?.closest('[data-desktop-cal-more]')) return;
      closeDayPopover();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDayPopover();
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', closeDayPopover);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', closeDayPopover);
    };
  }, [expandedDay, closeDayPopover]);

  const openDayPopover = useCallback(
    (dateStr: string, triggerEl: HTMLElement) => {
      if (expandedDay === dateStr) {
        closeDayPopover();
        return;
      }

      const rect = triggerEl.getBoundingClientRect();
      const dayCount = tasksByDate.get(dateStr)?.length ?? 1;
      const popoverWidth = Math.min(272, Math.max(220, window.innerWidth - 16));
      const estimatedHeight = Math.min(300, 54 + dayCount * 30);
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const openLeft = rect.left + popoverWidth + margin > vw;
      const openUp =
        rect.bottom + 4 + estimatedHeight + margin > vh &&
        rect.top - 4 - estimatedHeight >= margin;

      const left = openLeft
        ? Math.max(margin, rect.right - popoverWidth)
        : Math.max(margin, Math.min(rect.left, vw - popoverWidth - margin));
      const top = openUp
        ? Math.max(margin, rect.top - estimatedHeight - 4)
        : Math.max(margin, Math.min(rect.bottom + 4, vh - estimatedHeight - margin));

      const originClass = openUp
        ? openLeft
          ? 'origin-bottom-right'
          : 'origin-bottom-left'
        : openLeft
        ? 'origin-top-right'
        : 'origin-top-left';

      setPopoverPos({ top, left, originClass });
      setExpandedDay(dateStr);
    },
    [expandedDay, closeDayPopover, tasksByDate]
  );

  const expandedTasks = expandedDay ? tasksByDate.get(expandedDay) || [] : [];
  const expandedLunar = expandedDay && showLunar ? getLunarDateInfo(expandedDay) : null;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden select-none">
      {/* Weekday headers row */}
      <div
        className={`grid shrink-0 grid-cols-[32px_repeat(7,1fr)] border-b text-center text-[11px] font-semibold py-1.5 ${
          isLight ? 'border-black/10 text-slate-700 bg-white/30' : 'border-white/10 text-slate-300 bg-black/20'
        }`}
      >
        <div className="opacity-50">#</div>
        {weekdayHeaders.map((header) => (
          <div key={header}>{header}</div>
        ))}
      </div>

      {/* 6 rows x 7 days grid */}
      <div className="grid min-h-0 flex-1 grid-cols-[32px_repeat(7,1fr)] grid-rows-6 gap-px bg-white/5 overflow-hidden">
        {Array.from({ length: 6 }).map((_, rowIndex) => {
          const rowCells = gridCells.slice(rowIndex * 7, (rowIndex + 1) * 7);
          const firstCell = rowCells[0];
          const weekNum = getWeekNumber(firstCell.dateObj);

          return (
            <React.Fragment key={`row-${rowIndex}`}>
              {/* Week Number column */}
              <div
                className={`flex items-center justify-center text-[10px] font-mono border-r ${
                  isLight
                    ? 'border-black/10 text-slate-500 bg-white/20'
                    : 'border-white/10 text-slate-400 bg-black/20'
                }`}
              >
                {weekNum}
              </div>

              {/* 7 day cells */}
              {rowCells.map((cell, cellIndex) => {
                const dayTasks = tasksByDate.get(cell.dateStr) || [];
                const visibleLimit = getVisibleTaskLimit(dayTasks.length, taskAreaHeight);
                const hiddenCount = Math.max(0, dayTasks.length - visibleLimit);
                const isToday = cell.dateStr === todayYMD;
                const lunar = showLunar ? getLunarDateInfo(cell.dateStr) : null;

                return (
                  <div
                    key={cell.dateStr}
                    data-desktop-cal-date={cell.dateStr}
                    onDoubleClick={() => onOpenNewTask(cell.dateStr)}
                    className={`group/cell relative flex min-h-0 min-w-0 flex-col p-1 border-r border-b transition-colors ${
                      isLight ? 'border-black/5 hover:bg-black/5' : 'border-white/5 hover:bg-white/5'
                    } ${
                      !cell.isCurrentMonth
                        ? 'opacity-40'
                        : isToday
                        ? isLight
                          ? 'bg-accent/15 ring-1 ring-accent/40'
                          : 'bg-accent/25 ring-1 ring-accent/50'
                        : ''
                    }`}
                  >
                    {/* Day number & Lunar text */}
                    <div className="flex h-4 shrink-0 items-center justify-between text-xs">
                      <span
                        className={`size-4 rounded-full flex items-center justify-center text-[11px] font-bold ${
                          isToday
                            ? 'bg-accent text-on-accent'
                            : isLight
                            ? 'text-slate-800'
                            : 'text-slate-200'
                        }`}
                      >
                        {cell.dayNum}
                      </span>

                      {lunar && cell.isCurrentMonth && (
                        <span
                          className={`text-[9px] truncate max-w-[45px] ${
                            lunar.isFestival
                              ? 'text-amber-400 font-semibold'
                              : isLight
                              ? 'text-slate-500'
                              : 'text-slate-400'
                          }`}
                          title={lunar.fullText}
                        >
                          {lunar.label}
                        </span>
                      )}
                    </div>

                    {/* Task chips list */}
                    <div
                      ref={rowIndex === 0 && cellIndex === 0 ? taskAreaRef : undefined}
                      className="mt-0.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden"
                    >
                      {dayTasks.slice(0, visibleLimit).map((occ) => {
                        const t = occ.task;
                        const isDone = t.status === 'completed';
                        const project = projects.find((p) => p.id === t.projectId);
                        const style = getTaskEventStyle(t, project?.color, !isLight, true);
                        const isUpdating = updatingTaskIds.has(t.id);

                        return (
                          <div
                            key={`${t.id}-${occ.dueDate}`}
                            data-desktop-cal-task={t.id}
                            onClick={() => onTaskClick?.(t)}
                            onDoubleClick={(e) => e.stopPropagation()}
                            style={{
                              backgroundColor: style.background,
                              borderColor: style.borderColor,
                            }}
                            className={`flex h-4.5 shrink-0 items-center gap-1 rounded border px-1 text-[10px] leading-none transition-all cursor-pointer hover:brightness-110 active:scale-[0.98] ${
                              isDone ? 'opacity-50 line-through' : ''
                            }`}
                          >
                            <div onClick={(e) => e.stopPropagation()} className="shrink-0 flex items-center">
                              <ThemeCheckbox
                                checked={isDone}
                                disabled={isUpdating}
                                onChange={() => onToggleTask(t)}
                                size="xs"
                                ariaLabel={t.title}
                                className="desktop-cal-checkbox shrink-0"
                              />
                            </div>
                            <PriorityFlag priority={t.priority} />
                            <span
                              className="truncate flex-1 min-w-0 font-medium"
                              style={{ color: style.color }}
                            >
                              {t.title}
                            </span>
                          </div>
                        );
                      })}

                      {hiddenCount > 0 && (
                        <button
                          type="button"
                          data-desktop-cal-more={cell.dateStr}
                          aria-label={tr('calendar:calendarView.viewAllTasksFor', {
                            value0: cell.dateStr,
                            value1: dayTasks.length,
                          })}
                          title={tr('calendar:desktopCalendarWindow.viewAllTasksForThisDate')}
                          onClick={(e) => {
                            e.stopPropagation();
                            openDayPopover(cell.dateStr, e.currentTarget);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                          className={`flex h-4 shrink-0 items-center rounded px-1 text-left text-[9.5px] font-medium leading-none transition-colors cursor-pointer ${
                            isLight
                              ? 'text-slate-600 hover:bg-black/10 hover:text-slate-900'
                              : 'text-slate-300 hover:bg-white/15 hover:text-white'
                          }`}
                        >
                          <span className="truncate">
                            {visibleLimit > 0
                              ? `+${hiddenCount} ${tr('calendar:calendarView.more')}`
                              : tr('calendar:calendarView.total', { value0: dayTasks.length })}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>

      {/* Day All-Tasks Popover (Portal) */}
      {expandedDay &&
        popoverPos &&
        createPortal(
          <div
            ref={popoverRef}
            data-theme={isLight ? 'light' : 'dark'}
            data-no-drag="true"
            role="dialog"
            aria-label={tr('calendar:calendarView.tasksFor', { value0: expandedDay })}
            style={{
              top: popoverPos.top,
              left: popoverPos.left,
              transition: 'none',
            }}
            className={`desktop-cal-day-popover fixed z-50 w-[264px] max-w-[calc(100vw-16px)] rounded-xl border p-2.5 shadow-2xl backdrop-blur-md select-none ${
              popoverPos.originClass
            } ${
              isLight
                ? 'border-black/10 bg-white/95 text-slate-800'
                : 'border-white/15 bg-slate-900/95 text-slate-100'
            }`}
          >
            <div
              className={`flex items-center justify-between gap-2 pb-2 border-b ${
                isLight ? 'border-black/10' : 'border-white/10'
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-semibold truncate">{expandedDay}</span>
                {expandedLunar && (
                  <span
                    className={`text-[10px] shrink-0 ${
                      expandedLunar.isFestival
                        ? 'text-amber-500 font-semibold'
                        : isLight
                        ? 'text-slate-500'
                        : 'text-slate-400'
                    }`}
                  >
                    {expandedLunar.label}
                  </span>
                )}
                <span
                  className={`text-[10px] shrink-0 rounded px-1 py-0.5 font-mono ${
                    isLight ? 'bg-black/5 text-slate-600' : 'bg-white/10 text-slate-300'
                  }`}
                >
                  {tr('calendar:calendarView.total', { value0: expandedTasks.length })}
                </span>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    const targetDate = expandedDay;
                    closeDayPopover();
                    onOpenNewTask(targetDate);
                  }}
                  title={tr('calendar:calendarView.createATaskOnThisDate')}
                  aria-label={tr('calendar:calendarView.createATaskOnThisDate')}
                  className={`rounded p-1 transition-colors cursor-pointer ${
                    isLight
                      ? 'text-slate-500 hover:bg-black/10 hover:text-slate-900'
                      : 'text-slate-400 hover:bg-white/15 hover:text-white'
                  }`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={closeDayPopover}
                  title={tr('calendar:calendarView.closeDailyTasks')}
                  aria-label={tr('calendar:calendarView.closeDailyTasks')}
                  className={`rounded p-1 transition-colors cursor-pointer ${
                    isLight
                      ? 'text-slate-500 hover:bg-black/10 hover:text-slate-900'
                      : 'text-slate-400 hover:bg-white/15 hover:text-white'
                  }`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="mt-2 flex max-h-[220px] flex-col gap-1 overflow-y-auto pr-0.5">
              {expandedTasks.length === 0 ? (
                <div
                  className={`py-3 text-center text-xs ${
                    isLight ? 'text-slate-400' : 'text-slate-500'
                  }`}
                >
                  {tr('calendar:calendarView.noTasksOnThisDate')}
                </div>
              ) : (
                expandedTasks.map((occ) => {
                  const t = occ.task;
                  const isDone = t.status === 'completed';
                  const project = projects.find((p) => p.id === t.projectId);
                  const style = getTaskEventStyle(t, project?.color, !isLight, true);
                  const isUpdating = updatingTaskIds.has(t.id);
                  const dueTime = splitTaskDueDate(occ.dueDate).time;

                  return (
                    <div
                      key={`pop-${t.id}-${occ.dueDate}`}
                      data-desktop-cal-popover-task={t.id}
                      onClick={() => {
                        closeDayPopover();
                        onTaskClick?.(t);
                      }}
                      style={{
                        backgroundColor: style.background,
                        borderColor: style.borderColor,
                      }}
                      className={`flex min-h-6 shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] leading-tight transition-all cursor-pointer hover:brightness-110 ${
                        isDone ? 'opacity-50 line-through' : ''
                      }`}
                    >
                      <div onClick={(e) => e.stopPropagation()} className="shrink-0 flex items-center">
                        <ThemeCheckbox
                          checked={isDone}
                          disabled={isUpdating}
                          onChange={() => onToggleTask(t)}
                          size="xs"
                          ariaLabel={t.title}
                          className="desktop-cal-checkbox shrink-0"
                        />
                      </div>
                      <PriorityFlag priority={t.priority} />
                      <span
                        className="truncate flex-1 min-w-0 font-medium"
                        style={{ color: style.color }}
                      >
                        {t.title}
                      </span>
                      {dueTime && (
                        <span
                          className="shrink-0 text-[10px] font-mono opacity-75"
                          style={{ color: style.color }}
                        >
                          {dueTime}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
