/**
 * MonthGrid.tsx — 42-day month grid with lunar festivals & polished task chips.
 *
 * CALLING SPEC:
 *   <MonthGrid
 *     year={year}
 *     month={month}
 *     weekStartDay={weekStartDay}
 *     tasksByDate={tasksByDate}
 *     projects={projects}
 *     states={states}
 *     onTaskClick={(task, rect) => ...}
 *     onOpenCreateTaskWithDate={(dateStr) => ...}
 *     onSelectDay={(dateStr) => ...}
 *     readOnly={readOnly}
 *     compact={compact}
 *   />
 */

import React, { useEffect, useRef, useState } from 'react';
import { Plus, X, Clock, AlertOctagon, Circle, CheckCircle2 } from 'lucide-react';
import { tr } from '../../i18n';
import { Task, Project, WorkItemState, WeekStartDay } from '../../types';
import { TaskOccurrence } from '../../utils/recurrence';
import { formatYMD, generateCalendarGrid, getWeekdayHeaders } from '../../utils/calendarGrid';
import { getLunarDateInfo } from '../../utils/lunar';
import { isCompleted, resolveTaskGroup, isBlocked } from '../../utils/workItemState';
import { splitTaskDueDate } from '../../utils/taskDateTime';
import { getTaskEventStyle } from '../../utils/calendarTokens';

interface MonthGridProps {
  year: number;
  month: number;
  weekStartDay: WeekStartDay;
  tasksByDate: Map<string, TaskOccurrence[]>;
  projects?: Project[];
  states?: WorkItemState[];
  onTaskClick: (task: Task, rect: DOMRect) => void;
  onOpenCreateTaskWithDate: (dateStr: string) => void;
  onSelectDay?: (dateStr: string) => void;
  readOnly?: boolean;
  compact?: boolean;
  showLunar?: boolean;
}

export function MonthGrid({
  year,
  month,
  weekStartDay,
  tasksByDate,
  projects = [],
  states = [],
  onTaskClick,
  onOpenCreateTaskWithDate,
  onSelectDay,
  readOnly = false,
  compact = false,
  showLunar = true,
}: MonthGridProps) {
  const taskAreaRef = useRef<HTMLDivElement>(null);
  const [taskAreaHeight, setTaskAreaHeight] = useState(0);

  const todayFormatted = formatYMD(new Date());
  const gridCells = generateCalendarGrid(year, month, weekStartDay);
  const weekdayHeaders = getWeekdayHeaders(weekStartDay, 'bilingual');

  const minimumCellHeight = compact ? 76 : 100;
  const firstCurrentMonthIndex = gridCells.findIndex((cell) => cell.isCurrentMonth);

  useEffect(() => {
    const area = taskAreaRef.current;
    if (!area) return;
    const updateHeight = () => setTaskAreaHeight(area.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(area);
    return () => observer.disconnect();
  }, [year, month, weekStartDay, compact]);

  const getVisibleTaskLimit = (taskCount: number) => {
    if (taskAreaHeight <= 0) return 2;
    const rowHeight = 22;
    const moreHeight = 18;
    const maxFittingRows = Math.max(1, Math.floor(taskAreaHeight / rowHeight));
    if (taskCount <= maxFittingRows) return taskCount;
    return Math.max(1, Math.floor((taskAreaHeight - moreHeight) / rowHeight));
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-card/70 overflow-hidden">
      {/* Days of Week Header Bar */}
      <div
        className={`grid shrink-0 grid-cols-7 bg-surface/80 border-b border-edge text-center text-xs font-semibold text-sub select-none ${
          compact ? 'py-1.5' : 'py-2'
        }`}
      >
        {weekdayHeaders.map((header) => (
          <div key={header}>{header}</div>
        ))}
      </div>

      {/* 42-day matrix */}
      <div
        className="calendar-days-grid grid min-h-0 flex-1 grid-cols-7 gap-px overflow-y-auto bg-edge/40"
        style={{ gridTemplateRows: `repeat(6, minmax(${minimumCellHeight}px, 1fr))` }}
      >
        {gridCells.map((cell, index) => {
          if (!cell.isCurrentMonth) {
            const lunar = showLunar ? getLunarDateInfo(cell.dateStr) : null;
            return (
              <div
                key={cell.dateStr || index}
                className={`${compact ? 'p-1.5' : 'p-2'} min-w-0 bg-canvas/30 text-xs text-quiet select-none`}
              >
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
              onDoubleClick={(e) => {
                if (e.target === e.currentTarget && !readOnly) {
                  onOpenCreateTaskWithDate(cell.dateStr);
                }
              }}
              className={`calendar-day group flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface p-1.5 transition-colors hover:bg-hover/80 ${
                isToday ? 'bg-info/10 ring-1 ring-accent/50' : ''
              }`}
            >
              {/* Day header: Number, Lunar, Plus button */}
              <div className={`flex shrink-0 items-center justify-between ${compact ? 'h-[20px]' : 'h-[24px]'}`}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <button
                    type="button"
                    onClick={() => onSelectDay?.(cell.dateStr)}
                    aria-label={tr('calendar:calendarView.viewTasksFor', { value0: cell.dateStr })}
                    className={`text-xs font-bold ${
                      compact ? 'h-5 w-5' : 'h-6 w-6'
                    } shrink-0 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                      isToday
                        ? 'bg-accent text-on-accent shadow-sm'
                        : 'text-sub hover:bg-hover hover:text-main'
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

                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onOpenCreateTaskWithDate(cell.dateStr)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-sub hover:text-info hover:bg-hover rounded transition-all"
                    title={tr('calendar:calendarView.createATaskOnThisDate')}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Tasks list */}
              <div
                ref={index === firstCurrentMonthIndex ? taskAreaRef : undefined}
                className="calendar-day-tasks mt-1 flex min-h-0 flex-1 flex-col gap-1 overflow-hidden"
              >
                {dayTasks.slice(0, visibleTaskLimit).map((occurrence) => {
                  const t = occurrence.task;
                  const project = projects.find((p) => p.id === t.projectId);
                  const style = getTaskEventStyle(t, project?.color);
                  const dueTime = splitTaskDueDate(occurrence.dueDate).time;
                  const completed = isCompleted(t, states);

                  return (
                    <button
                      key={`${t.id}-${occurrence.dueDate}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTaskClick(t, e.currentTarget.getBoundingClientRect());
                      }}
                      style={{
                        backgroundColor: style.background,
                        borderColor: style.borderColor,
                        color: style.color,
                      }}
                      className={`flex h-5 shrink-0 items-center gap-1 overflow-hidden rounded border px-1.5 text-left text-[11px] leading-4 transition-all hover:brightness-95 active:scale-[0.99] ${
                        completed ? 'line-through opacity-60' : ''
                      }`}
                    >
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: style.dotColor }}
                      />
                      <span className="truncate flex-1 font-medium">{t.title}</span>
                      {dueTime && (
                        <span className="text-[10px] opacity-75 shrink-0 whitespace-nowrap">{dueTime}</span>
                      )}
                    </button>
                  );
                })}

                {/* More tasks indicator */}
                {dayTasks.length > visibleTaskLimit && (
                  <button
                    type="button"
                    onClick={() => onSelectDay?.(cell.dateStr)}
                    className="mt-auto text-[10px] text-quiet hover:text-accent font-medium text-left px-1 py-0.5 rounded hover:bg-hover/60 transition-colors"
                  >
                    +{dayTasks.length - visibleTaskLimit} {tr('calendar:calendarView.more')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

