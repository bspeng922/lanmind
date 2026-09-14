import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Task, Project, TaskStatus, WeekStartDay } from '../types';
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Plus,
  Repeat,
  X,
  Pin,
  CheckCircle2,
  Clock,
  Circle,
  AlertOctagon,
} from 'lucide-react';
import { expandTaskOccurrences, formatRecurrenceLabel, TaskOccurrence } from '../utils/recurrence';
import { splitTaskDueDate } from '../utils/taskDateTime';
import { getLunarDateInfo } from '../utils/lunar';
import { ApiService } from '../services/api';
import {
  generateCalendarGrid,
  getStoredWeekStartDay,
  getWeekdayHeaders,
  WEEK_START_CHANGE_EVENT,
  TAURI_WEEK_START_EVENT,
} from '../utils/calendarGrid';

interface CalendarViewProps {
  tasks: Task[];
  projects: Project[];
  onOpenCreateTaskWithDate: (dateStr: string) => void;
  onOpenEditTask: (task: Task) => void;
  canEditTask: (task: Task) => boolean;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
}

export const CalendarView: React.FC<CalendarViewProps> = ({
  tasks,
  projects,
  onOpenCreateTaskWithDate,
  onOpenEditTask,
  canEditTask,
  onUpdateTask,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [gridHeight, setGridHeight] = useState(0);
  const calendarGridRef = useRef<HTMLDivElement>(null);
  const [showLunar, setShowLunar] = useState<boolean>(() => {
    return localStorage.getItem('lanmind_show_lunar') !== 'false';
  });
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(getStoredWeekStartDay);
  const [isDesktopPinned, setIsDesktopPinned] = useState(false);

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
    let unlistenState: (() => void) | undefined;
    let unlistenWeekStart: (() => void) | undefined;
    if (isTauri()) {
      ApiService.isDesktopCalendarVisible().then(setIsDesktopPinned).catch(() => {});
      listen<boolean>('desktop-calendar://state-changed', (event) => {
        setIsDesktopPinned(Boolean(event.payload));
      }).then((fn) => {
        unlistenState = fn;
      }).catch(() => {});
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
      unlistenState?.();
      unlistenWeekStart?.();
    };
  }, []);

  const handleToggleDesktopCalendar = async () => {
    if (!isTauri()) return;
    try {
      const active = await ApiService.toggleDesktopCalendar();
      setIsDesktopPinned(active);
    } catch (e) {
      console.error('Failed to toggle desktop calendar', e);
    }
  };

  const formatDateKey = (date: Date) => {
    const dateYear = date.getFullYear();
    const dateMonth = String(date.getMonth() + 1).padStart(2, '0');
    const dateDay = String(date.getDate()).padStart(2, '0');
    return `${dateYear}-${dateMonth}-${dateDay}`;
  };

  const taskDateKey = (dueDate: string | null) => {
    if (!dueDate) return null;
    const match = dueDate.match(/^\d{4}-\d{2}-\d{2}/);
    return match?.[0] || null;
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Helper for calendar days
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonthDays = new Date(year, month, 0).getDate();

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

  const todayFormatted = formatDateKey(new Date());
  const monthStart = formatDateKey(new Date(year, month, 1));
  const monthEnd = formatDateKey(new Date(year, month + 1, 0));
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, TaskOccurrence[]>();
    tasks.forEach((task) => {
      expandTaskOccurrences(task, monthStart, monthEnd).forEach((occurrence) => {
        const existing = grouped.get(occurrence.dateKey) || [];
        existing.push(occurrence);
        grouped.set(occurrence.dateKey, existing);
      });
    });
    return grouped;
  }, [tasks, monthStart, monthEnd]);
  const unscheduledTaskCount = tasks.filter((task) => !taskDateKey(task.dueDate)).length;
  const selectedDayTasks = selectedDate ? tasksByDate.get(selectedDate) || [] : [];
  const estimatedCellHeight = ((gridHeight || 560) - 20) / 6;
  const visibleTaskLimit = Math.max(
    1,
    Math.min(6, Math.floor((estimatedCellHeight - 54) / 20)),
  );

  const handleToggleStatus = (task: Task) => {
    if (!canEditTask(task)) return;
    const statusCycle: Record<TaskStatus, TaskStatus> = {
      todo: 'in_progress',
      in_progress: 'completed',
      completed: 'todo',
      blocked: 'in_progress',
    };
    onUpdateTask(task.id, { status: statusCycle[task.status] || 'todo' });
  };

  const getStatusIcon = (status: TaskStatus, interactive = true, size: 'sm' | 'md' = 'sm') => {
    const iconSizeClass = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';
    const interactionClass = interactive
      ? 'cursor-pointer hover:scale-110 transition-transform'
      : 'cursor-not-allowed opacity-60';
    switch (status) {
      case 'completed':
        return <CheckCircle2 className={`${iconSizeClass} text-success shrink-0 ${interactionClass}`} />;
      case 'in_progress':
        return <Clock className={`${iconSizeClass} text-info shrink-0 ${interactionClass} ${interactive ? 'animate-pulse' : ''}`} />;
      case 'blocked':
        return <AlertOctagon className={`${iconSizeClass} text-danger shrink-0 ${interactionClass}`} />;
      default:
        return <Circle className={`${iconSizeClass} text-sub shrink-0 ${interactionClass} ${interactive ? 'hover:text-info' : ''}`} />;
    }
  };

  useEffect(() => {
    const grid = calendarGridRef.current;
    if (!grid) return;
    const updateHeight = () => setGridHeight(grid.clientHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full bg-canvas text-main overflow-hidden">
      {/* Calendar Navigation Header */}
      <div className="bg-surface border-b border-edge p-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <CalendarIcon className="w-5 h-5 text-info" />
          <h2 className="text-base font-bold text-main">
            {year} 年 {month + 1} 月 日历排期
          </h2>
          {unscheduledTaskCount > 0 && (
            <span className="rounded border border-subtle bg-card px-2 py-0.5 text-[10px] text-sub">
              未排期 {unscheduledTaskCount}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {isTauri() && (
            <button
              onClick={handleToggleDesktopCalendar}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs border rounded-lg transition-colors font-medium ${
                isDesktopPinned
                  ? 'bg-blue-600/20 text-info border-blue-500/40 hover:bg-blue-600/30'
                  : 'bg-card hover:bg-hover text-main border-subtle'
              }`}
              title="在桌面显示透明日历，双击日期可快速记录备忘任务"
            >
              <Pin className="w-3.5 h-3.5" />
              <span>{isDesktopPinned ? '已钉在桌面' : '钉到桌面'}</span>
            </button>
          )}
          <button
            onClick={goToToday}
            className="px-2.5 py-1 text-xs bg-card hover:bg-hover text-main border border-subtle rounded-lg transition-colors font-medium"
          >
            今天
          </button>
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
      <div className="grid grid-cols-7 bg-surface/60 border-b border-edge text-center py-2 text-xs font-semibold text-sub">
        {getWeekdayHeaders(weekStartDay, 'bilingual').map((header) => (
          <div key={header}>{header}</div>
        ))}
      </div>

      {/* Calendar Days Grid */}
      <div
        ref={calendarGridRef}
        className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-x-px gap-y-1 overflow-y-auto bg-card/80"
      >
        {gridCells.map((cell, index) => {
          if (!cell.isCurrentMonth) {
            const lunar = showLunar ? getLunarDateInfo(cell.dateStr) : null;
            return (
              <div key={cell.dateStr || index} className="min-h-[92px] bg-canvas/40 p-2 text-xs text-quiet select-none">
                <div className="flex items-center gap-1.5">
                  <span>{cell.dayNum}</span>
                  {lunar && <span className="text-[10px] text-quiet">{lunar.label}</span>}
                </div>
              </div>
            );
          }

          const dayTasks = tasksByDate.get(cell.dateStr) || [];
          const isToday = cell.dateStr === todayFormatted;

          return (
            <div
              key={cell.dateStr}
              className={`group flex min-h-[90px] flex-col justify-between overflow-hidden border-t border-edge/50 bg-surface/90 p-2 transition-colors hover:bg-hover/80 ${
                isToday ? 'bg-info/10 ring-1 ring-blue-500/50' : ''
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button
                      type="button"
                      onClick={() => setSelectedDate(cell.dateStr)}
                      className={`text-xs font-bold w-6 h-6 shrink-0 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                        isToday
                          ? 'bg-blue-600 text-on-solid shadow-panel shadow-blue-500/40 hover:bg-blue-500 hover:scale-110'
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
                    onClick={() => onOpenCreateTaskWithDate(cell.dateStr)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-sub hover:text-info hover:bg-hover rounded transition-all"
                    title="在该日期新建任务"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Day Tasks List */}
                <div className="mt-1 space-y-0.5 overflow-hidden">
                  {dayTasks.slice(0, visibleTaskLimit).map((occurrence) => {
                    const t = occurrence.task;
                    const dueTime = splitTaskDueDate(occurrence.dueDate).time;
                    const priorityColor =
                      t.priority === 'P1'
                        ? 'border-l-rose-500 bg-danger/10 text-danger'
                        : t.priority === 'P2'
                        ? 'border-l-amber-500 bg-warning/10 text-warning'
                        : t.priority === 'P3'
                        ? 'border-l-blue-500 bg-info/10 text-info'
                        : 'border-l-slate-600 bg-card/60 text-sub';

                    return (
                      <div
                        key={`${t.id}-${occurrence.dueDate}`}
                        onClick={() => canEditTask(t) && onOpenEditTask(t)}
                        className={`group/task flex items-center gap-1 truncate rounded border-l-2 px-1 py-0.5 text-[11px] leading-4 transition-all ${canEditTask(t) ? 'cursor-pointer hover:scale-[1.01]' : 'cursor-default opacity-75'} ${priorityColor} ${
                          t.status === 'completed' ? 'line-through opacity-60' : ''
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
                          title={
                            t.status === 'todo'
                              ? '点击开始任务（设为进行中）'
                              : t.status === 'in_progress'
                                ? '点击完成任务'
                                : t.status === 'completed'
                                  ? '点击恢复为待办'
                                  : '切换状态'
                          }
                        >
                          {getStatusIcon(t.status, canEditTask(t), 'sm')}
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
                      className="w-full rounded px-1 py-0.5 text-left text-[10px] font-medium text-info transition-colors hover:bg-blue-500/10 hover:text-info"
                    >
                      查看全部
                    </button>
                  )}
                </div>
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
            aria-label={`${selectedDate} 的任务`}
          >
            <div className="flex items-center justify-between border-b border-edge px-4 py-3">
              <div>
                <h3 className="text-sm font-bold text-main">{selectedDate} 的任务</h3>
                <p className="mt-0.5 text-[11px] text-quiet">共 {selectedDayTasks.length} 项</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onOpenCreateTaskWithDate(selectedDate);
                    setSelectedDate(null);
                  }}
                  className="flex h-8 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-on-solid transition-colors hover:bg-blue-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  新建任务
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-sub transition-colors hover:bg-hover hover:text-main"
                  title="关闭当天任务"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
              {selectedDayTasks.length === 0 ? (
                <div className="py-10 text-center text-xs text-quiet">当天暂无任务</div>
              ) : (
                selectedDayTasks.map((occurrence) => {
                  const task = occurrence.task;
                  const dueTime = splitTaskDueDate(occurrence.dueDate).time;
                  const project = projects.find((item) => item.id === task.projectId);
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
                            ? 'bg-rose-500'
                            : task.priority === 'P2'
                              ? 'bg-amber-500'
                              : task.priority === 'P3'
                                ? 'bg-blue-500'
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
                        title={
                          task.status === 'todo'
                            ? '点击开始任务（设为进行中）'
                            : task.status === 'in_progress'
                              ? '点击完成任务'
                              : task.status === 'completed'
                                ? '点击恢复为待办'
                                : '切换状态'
                        }
                      >
                        {getStatusIcon(task.status, canEditTask(task), 'md')}
                      </button>
                      <div
                        onClick={() => {
                          if (canEditTask(task)) {
                            onOpenEditTask(task);
                            setSelectedDate(null);
                          }
                        }}
                        className={`min-w-0 flex-1 ${canEditTask(task) ? 'cursor-pointer' : 'cursor-default'}`}
                        title={canEditTask(task) ? '点击编辑任务详情' : undefined}
                      >
                        <span
                          className={`block truncate text-xs font-semibold text-main ${
                            task.status === 'completed' ? 'line-through opacity-60' : ''
                          }`}
                        >
                          {task.title}
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-[10px] text-quiet">
                          {dueTime && <span className="font-mono">{dueTime}</span>}
                          {project && <span className="truncate">{project.name}</span>}
                          <span>{task.priority}</span>
                          {task.recurrence && task.recurrence !== 'none' && (
                            <span>{formatRecurrenceLabel(task.recurrence, task.recurrenceRule, task.dueDate)}</span>
                          )}
                        </span>
                      </div>
                      {canEditTask(task) && (
                        <div className="flex items-center gap-1.5">
                          {task.status === 'todo' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onUpdateTask(task.id, { status: 'in_progress' });
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-blue-500/15 text-info border border-blue-500/30 hover:bg-blue-500/25 transition-colors"
                              title="开始任务"
                            >
                              <Clock className="w-3.5 h-3.5" />
                              <span>开始</span>
                            </button>
                          )}
                          {task.status === 'in_progress' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onUpdateTask(task.id, { status: 'completed' });
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-emerald-500/15 text-success border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
                              title="完成任务"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>完成</span>
                            </button>
                          )}
                          {task.status === 'completed' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onUpdateTask(task.id, { status: 'todo' });
                              }}
                              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-card text-sub border border-subtle hover:bg-hover hover:text-main transition-colors"
                              title="恢复待办"
                            >
                              <span>恢复待办</span>
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
