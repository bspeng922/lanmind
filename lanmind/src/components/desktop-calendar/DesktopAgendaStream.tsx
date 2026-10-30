/**
 * DesktopAgendaStream.tsx — 3-Day compact agenda stream for desktop wallpaper widget.
 *
 * CALLING SPEC:
 *   <DesktopAgendaStream
 *     currentDate={currentDate}
 *     tasks={tasks}
 *     projects={projects}
 *     showCompleted={showCompleted}
 *     isLight={isLight}
 *     showLunar={showLunar}
 *     onToggleTask={handleToggleTask}
 *     onOpenNewTask={handleOpenNewTask}
 *   />
 */

import React, { useMemo } from 'react';
import { Plus, CheckCircle2, Clock, Calendar } from 'lucide-react';
import { tr } from '../../i18n';
import { Task, Project } from '../../types';
import { PriorityFlag } from '../PriorityFlag';
import { ThemeCheckbox } from '../ThemeCheckbox';
import { expandTaskOccurrences, TaskOccurrence } from '../../utils/recurrence';
import { formatYMD } from '../../utils/calendarGrid';
import { getLunarDateInfo } from '../../utils/lunar';
import { splitTaskDueDate } from '../../utils/taskDateTime';
import { extractTaskTimeRange, formatMinutesToTime } from '../../utils/calendarLayout';
import { getTaskEventStyle } from '../../utils/calendarTokens';

interface DesktopAgendaStreamProps {
  currentDate: Date;
  tasks: Task[];
  projects?: Project[];
  showCompleted: boolean;
  isLight: boolean;
  showLunar?: boolean;
  onToggleTask: (task: Task) => void;
  onOpenNewTask: (dateStr: string) => void;
  onTaskClick?: (task: Task) => void;
  updatingTaskIds?: Set<string>;
}

export function DesktopAgendaStream({
  currentDate,
  tasks,
  projects = [],
  showCompleted,
  isLight,
  showLunar = true,
  onToggleTask,
  onOpenNewTask,
  onTaskClick,
  updatingTaskIds = new Set(),
}: DesktopAgendaStreamProps) {
  const todayYMD = formatYMD(new Date());

  // 3 consecutive days
  const agendaDays = useMemo(() => {
    const list: { dateStr: string; dateObj: Date; label: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + i);
      const dateStr = formatYMD(d);

      let label = '';
      if (dateStr === todayYMD) {
        label = tr('calendar:calendarView.today');
      } else if (i === 1 && formatYMD(new Date(Date.now() + 86400000)) === dateStr) {
        label = tr('calendar:calendarView.tomorrow');
      } else if (i === 2 && formatYMD(new Date(Date.now() + 172800000)) === dateStr) {
        label = tr('calendar:calendarView.dayAfterTomorrow');
      } else {
        label = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(d);
      }

      list.push({ dateStr, dateObj: d, label });
    }
    return list;
  }, [currentDate, todayYMD]);

  // Expand occurrences for the 3-day window
  const tasksByDate = useMemo(() => {
    if (agendaDays.length === 0) return new Map<string, TaskOccurrence[]>();
    const start = agendaDays[0].dateStr;
    const end = agendaDays[agendaDays.length - 1].dateStr;

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

    // Sort each day's occurrences by start time then priority
    for (const list of map.values()) {
      list.sort((a, b) => {
        const timeA = extractTaskTimeRange(a.task);
        const timeB = extractTaskTimeRange(b.task);
        if (timeA.isAllDay !== timeB.isAllDay) {
          return timeA.isAllDay ? -1 : 1;
        }
        return timeA.startMinutes - timeB.startMinutes;
      });
    }

    return map;
  }, [agendaDays, tasks, showCompleted]);

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 p-3 overflow-y-auto select-none">
      {agendaDays.map((day) => {
        const dayTasks = tasksByDate.get(day.dateStr) || [];
        const isToday = day.dateStr === todayYMD;
        const lunar = showLunar ? getLunarDateInfo(day.dateStr) : null;
        const m = day.dateObj.getMonth() + 1;
        const d = day.dateObj.getDate();

        return (
          <div
            key={day.dateStr}
            className={`flex flex-col rounded-xl border p-2.5 transition-all ${
              isToday
                ? isLight
                  ? 'bg-white/70 border-accent/40 shadow-xs'
                  : 'bg-black/35 border-accent/50 shadow-xs'
                : isLight
                ? 'bg-white/40 border-black/10'
                : 'bg-black/20 border-white/10'
            }`}
          >
            {/* Day Header */}
            <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${
                    isToday
                      ? 'bg-accent text-on-accent'
                      : isLight
                      ? 'bg-black/10 text-slate-800'
                      : 'bg-white/15 text-slate-200'
                  }`}
                >
                  {day.label} {m}/{d}
                </span>
                {lunar && (
                  <span
                    className={`text-[11px] font-medium ${
                      lunar.isFestival
                        ? 'text-amber-400 font-semibold'
                        : isLight
                        ? 'text-slate-600'
                        : 'text-slate-400'
                    }`}
                  >
                    {lunar.label}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => onOpenNewTask(day.dateStr)}
                className={`p-1 rounded-md transition-colors ${
                  isLight
                    ? 'hover:bg-black/10 text-slate-600'
                    : 'hover:bg-white/15 text-slate-300'
                }`}
                title={tr('calendar:calendarView.createATaskOnThisDate')}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Task list for this day */}
            <div className="mt-1.5 flex flex-col gap-1">
              {dayTasks.length === 0 ? (
                <button
                  type="button"
                  onClick={() => onOpenNewTask(day.dateStr)}
                  className={`flex items-center gap-1.5 py-1.5 px-2 rounded-lg text-xs transition-colors text-left border border-dashed border-transparent hover:border-current/20 ${
                    isLight ? 'text-slate-400 hover:text-slate-600' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Plus className="h-3 w-3" />
                  <span>{tr('calendar:calendarView.noTasksOnThisDate', { defaultValue: '暂无任务，点击添加' })}</span>
                </button>
              ) : (
                dayTasks.map((occurrence) => {
                  const t = occurrence.task;
                  const project = projects.find((p) => p.id === t.projectId);
                  const style = getTaskEventStyle(t, project?.color, !isLight, true);
                  const isDone = t.status === 'completed';
                  const timeRange = extractTaskTimeRange(t);
                  const isUpdating = updatingTaskIds.has(t.id);

                  return (
                    <div
                      key={`${t.id}-${occurrence.dueDate}`}
                      onClick={() => onTaskClick?.(t)}
                      style={{
                        backgroundColor: style.background,
                        borderColor: style.borderColor,
                      }}
                      className={`group flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs transition-all cursor-pointer hover:brightness-105 active:scale-[0.99] ${
                        isDone ? 'opacity-50 line-through' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div onClick={(e) => e.stopPropagation()} className="shrink-0 flex items-center">
                          <ThemeCheckbox
                            checked={isDone}
                            disabled={isUpdating}
                            onChange={() => onToggleTask(t)}
                            className="shrink-0"
                          />
                        </div>
                        <PriorityFlag priority={t.priority} />
                        <span
                          className="truncate font-medium flex-1"
                          style={{ color: style.color }}
                        >
                          {t.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 text-[10px] opacity-80">
                        {project && (
                          <span
                            className="truncate max-w-[80px] rounded px-1 font-semibold"
                            style={{
                              backgroundColor: `${project.color || '#3b82f6'}30`,
                              color: isLight ? project.color : '#e2e8f0',
                            }}
                          >
                            {project.name}
                          </span>
                        )}
                        <span className="font-mono">
                          {timeRange.isAllDay
                            ? tr('calendar:calendarView.allDay', { defaultValue: '全天' })
                            : `${formatMinutesToTime(timeRange.startMinutes)}`}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

