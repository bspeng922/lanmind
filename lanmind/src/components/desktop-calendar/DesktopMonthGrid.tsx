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

import React, { useMemo } from 'react';
import { Task, Project, WeekStartDay } from '../../types';
import { tr } from '../../i18n';
import { generateCalendarGrid, getWeekdayHeaders, formatYMD } from '../../utils/calendarGrid';
import { getLunarDateInfo } from '../../utils/lunar';
import { expandTaskOccurrences, TaskOccurrence } from '../../utils/recurrence';
import { PriorityFlag } from '../PriorityFlag';
import { ThemeCheckbox } from '../ThemeCheckbox';
import { getTaskEventStyle } from '../../utils/calendarTokens';

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
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
              {rowCells.map((cell) => {
                const dayTasks = tasksByDate.get(cell.dateStr) || [];
                const isToday = cell.dateStr === todayYMD;
                const lunar = showLunar ? getLunarDateInfo(cell.dateStr) : null;

                return (
                  <div
                    key={cell.dateStr}
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
                    <div className="flex items-center justify-between text-xs">
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
                    <div className="mt-0.5 flex flex-1 flex-col gap-0.5 overflow-hidden">
                      {dayTasks.slice(0, 3).map((occ) => {
                        const t = occ.task;
                        const isDone = t.status === 'completed';
                        const project = projects.find((p) => p.id === t.projectId);
                        const style = getTaskEventStyle(t, project?.color, !isLight, true);
                        const isUpdating = updatingTaskIds.has(t.id);

                        return (
                          <div
                            key={`${t.id}-${occ.dueDate}`}
                            onClick={() => onTaskClick?.(t)}
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
                                className="size-2.5 shrink-0"
                              />
                            </div>
                            <PriorityFlag priority={t.priority} />
                            <span
                              className="truncate flex-1 font-medium"
                              style={{ color: style.color }}
                            >
                              {t.title}
                            </span>
                          </div>
                        );
                      })}

                      {dayTasks.length > 3 && (
                        <span className="text-[9px] opacity-70 px-1 font-mono">
                          +{dayTasks.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

