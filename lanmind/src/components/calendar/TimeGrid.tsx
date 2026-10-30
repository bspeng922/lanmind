/**
 * TimeGrid.tsx — 24h Interactive calendar time grid with collision layout & direct drag.
 *
 * CALLING SPEC:
 *   <TimeGrid
 *     days={visibleDays}
 *     tasks={tasks}
 *     projects={projects}
 *     states={states}
 *     onTaskClick={(task, rect) => ...}
 *     onOpenCreateTaskWithDate={(dateStr) => ...}
 *     onUpdateTask={(id, updates) => ...}
 *     canEditTask={(task) => ...}
 *   />
 */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Task, Project, WorkItemState } from '../../types';
import { PriorityFlag } from '../PriorityFlag';
import { TwoLineTitle } from './TwoLineTitle';
import {
  HOUR_HEIGHT,
  MIN_TASK_MINUTES,
  SNAP_MINUTES,
  clamp,
  extractTaskTimeRange,
  formatMinutesToTime,
  layoutDay,
  minutesToPx,
  pxToMinutes,
  snap,
} from '../../utils/calendarLayout';
import { getTaskEventStyle } from '../../utils/calendarTokens';
import { isCompleted } from '../../utils/workItemState';
import { formatYMD } from '../../utils/calendarGrid';
import { combineTaskDueDate, splitTaskDueDate } from '../../utils/taskDateTime';
import { getLunarDateInfo } from '../../utils/lunar';

const HOURS = Array.from({ length: 23 }, (_, i) => i + 1); // 1..23
const DRAG_THRESHOLD = 4;

export interface VisibleDay {
  dateStr: string;
  dateObj: Date;
  dayName: string;
  dayNum: number;
  isToday: boolean;
}

interface DragState {
  type: 'create' | 'move' | 'resize';
  task?: Task;
  dayIndex: number;
  anchorMinutes: number;
  currentMinutes: number;
  startMinutes: number;
  endMinutes: number;
  grabOffsetMinutes: number;
  moved: boolean;
}

interface TimeGridProps {
  days: VisibleDay[];
  tasks: Task[];
  projects?: Project[];
  states?: WorkItemState[];
  onTaskClick: (task: Task, rect: DOMRect) => void;
  onOpenCreateTaskWithDate: (dateStr: string, timeRange?: { start: string; end: string }) => void;
  onUpdateTask?: (id: string, updates: Partial<Task>) => void;
  canEditTask?: (task: Task) => boolean;
  showLunar?: boolean;
}

export function TimeGrid({
  days,
  tasks,
  projects = [],
  states = [],
  onTaskClick,
  onOpenCreateTaskWithDate,
  onUpdateTask,
  canEditTask,
  showLunar = true,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number; target: Element | null } | null>(null);

  const [drag, setDrag] = useState<DragState | null>(null);

  // Decision 1: Default scroll position to 07:00 ~ 08:00
  useLayoutEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const currentHour = now.getHours();
      const initialHour = currentHour >= 7 && currentHour <= 22 ? Math.max(6, currentHour - 1) : 7;
      scrollRef.current.scrollTop = initialHour * HOUR_HEIGHT;
    }
  }, []);

  // Now-line calculation (current time minutes from 00:00)
  const [nowMinutes, setNowMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Filter and compute layout for each day
  const dayColumns = useMemo(() => {
    return days.map((day, dayIndex) => {
      // Find all timed tasks for this day
      const dayTasks = tasks.filter((t) => {
        const dueParts = splitTaskDueDate(t.dueDate);
        const startParts = splitTaskDueDate(t.startDate);
        const matchesDate = dueParts.date === day.dateStr || startParts.date === day.dateStr;
        if (!matchesDate) return false;
        const timeRange = extractTaskTimeRange(t);
        return !timeRange.isAllDay;
      });

      // Prepare items for collision layout
      const timedItems = dayTasks.map((t) => {
        // If this task is being moved or resized, apply live drag preview
        if (drag && drag.moved && drag.task?.id === t.id) {
          if (drag.dayIndex === dayIndex) {
            return {
              task: t,
              startMinutes: drag.startMinutes,
              endMinutes: drag.endMinutes,
            };
          }
        }
        const range = extractTaskTimeRange(t);
        return {
          task: t,
          startMinutes: range.startMinutes,
          endMinutes: range.endMinutes,
        };
      });

      // If dragging to move a task into this day from another day
      if (
        drag &&
        drag.moved &&
        drag.type === 'move' &&
        drag.task &&
        drag.dayIndex === dayIndex &&
        !timedItems.some((it) => it.task.id === drag.task!.id)
      ) {
        timedItems.push({
          task: drag.task,
          startMinutes: drag.startMinutes,
          endMinutes: drag.endMinutes,
        });
      }

      return layoutDay(timedItems);
    });
  }, [days, tasks, drag]);

  // Coordinate mapping helper
  function pointToSlot(clientX: number, clientY: number) {
    if (!bodyRef.current) return { dayIndex: 0, minutes: 0 };
    const rect = bodyRef.current.getBoundingClientRect();
    const colWidth = rect.width / days.length;
    const dayIndex = clamp(Math.floor((clientX - rect.left) / colWidth), 0, days.length - 1);
    const minutes = clamp(pxToMinutes(clientY - rect.top), 0, 1440);
    return { dayIndex, minutes };
  }

  // Pointer event handlers
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const eventCard = target.closest<HTMLElement>('[data-task-id]');
    const isResize = Boolean(target.closest('[data-resize]'));
    const { dayIndex, minutes } = pointToSlot(e.clientX, e.clientY);

    pointerStartRef.current = { x: e.clientX, y: e.clientY, target: eventCard };
    e.currentTarget.setPointerCapture(e.pointerId);

    if (eventCard) {
      const taskId = eventCard.dataset.taskId;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const range = extractTaskTimeRange(task);
      const editable = canEditTask ? canEditTask(task) : true;

      if (!editable) return;

      setDrag({
        type: isResize ? 'resize' : 'move',
        task,
        dayIndex,
        anchorMinutes: minutes,
        currentMinutes: minutes,
        startMinutes: range.startMinutes,
        endMinutes: range.endMinutes,
        grabOffsetMinutes: minutes - range.startMinutes,
        moved: false,
      });
    } else {
      const snapped = snap(minutes);
      setDrag({
        type: 'create',
        dayIndex,
        anchorMinutes: snapped,
        currentMinutes: snapped + 60,
        startMinutes: snapped,
        endMinutes: snapped + 60,
        grabOffsetMinutes: 0,
        moved: false,
      });
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag || !pointerStartRef.current) return;
    const dist = Math.hypot(e.clientX - pointerStartRef.current.x, e.clientY - pointerStartRef.current.y);
    const moved = drag.moved || dist > DRAG_THRESHOLD;
    if (!moved) return;

    const { dayIndex, minutes } = pointToSlot(e.clientX, e.clientY);

    if (drag.type === 'create') {
      const s = Math.min(drag.anchorMinutes, snap(minutes));
      const end = Math.max(drag.anchorMinutes, snap(minutes), s + MIN_TASK_MINUTES);
      setDrag({ ...drag, moved: true, dayIndex, startMinutes: s, endMinutes: end });
    } else if (drag.type === 'move' && drag.task) {
      const duration = drag.endMinutes - drag.startMinutes;
      const s = clamp(snap(minutes - drag.grabOffsetMinutes), 0, 1440 - duration);
      setDrag({
        ...drag,
        moved: true,
        dayIndex,
        startMinutes: s,
        endMinutes: s + duration,
      });
    } else if (drag.type === 'resize' && drag.task) {
      const end = clamp(snap(minutes), drag.startMinutes + MIN_TASK_MINUTES, 1440);
      setDrag({ ...drag, moved: true, endMinutes: end });
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const curDrag = drag;
    const start = pointerStartRef.current;
    setDrag(null);
    pointerStartRef.current = null;

    if (!curDrag) return;

    if (curDrag.type === 'create') {
      const targetDay = days[curDrag.dayIndex];
      if (curDrag.moved) {
        onOpenCreateTaskWithDate(targetDay.dateStr, {
          start: formatMinutesToTime(curDrag.startMinutes),
          end: formatMinutesToTime(curDrag.endMinutes),
        });
      } else {
        const slotStart = clamp(Math.floor(curDrag.anchorMinutes / 30) * 30, 0, 1380);
        onOpenCreateTaskWithDate(targetDay.dateStr, {
          start: formatMinutesToTime(slotStart),
          end: formatMinutesToTime(slotStart + 60),
        });
      }
      return;
    }

    if (!curDrag.moved) {
      // Clean click on task: open TaskEventPopover
      if (curDrag.task && start?.target) {
        onTaskClick(curDrag.task, start.target.getBoundingClientRect());
      }
      return;
    }

    // Drag ended: apply update to task
    if (curDrag.task && onUpdateTask) {
      const targetDay = days[curDrag.dayIndex];
      const newStartDate = combineTaskDueDate(targetDay.dateStr, formatMinutesToTime(curDrag.startMinutes));
      const newDueDate = combineTaskDueDate(targetDay.dateStr, formatMinutesToTime(curDrag.endMinutes));
      onUpdateTask(curDrag.task.id, {
        startDate: newStartDate,
        dueDate: newDueDate,
      });
    }
  }

  return (
    <div
      ref={scrollRef}
      className="relative flex flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden bg-canvas select-none"
    >
      <div className="relative flex min-w-full flex-col" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
        {/* Hour Grid Lines */}
        <div className="pointer-events-none absolute inset-y-0 right-0 left-14" aria-hidden>
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute inset-x-0 h-px border-b border-edge/40"
              style={{ top: `${h * HOUR_HEIGHT}px` }}
            />
          ))}
        </div>

        {/* Left Sticky Time Axis */}
        <div className="sticky left-0 z-20 h-full w-14 shrink-0 bg-surface/90 border-r border-edge select-none" aria-hidden>
          {HOURS.map((h) => (
            <span
              key={h}
              className="absolute right-2 text-[11px] text-quiet font-medium"
              style={{ top: `${h * HOUR_HEIGHT - 8}px` }}
            >
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>

        {/* Day Columns Container */}
        <div
          ref={bodyRef}
          className="absolute inset-y-0 left-14 right-0 flex h-full"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
        >
          {days.map((day, dayIndex) => {
            const layoutItems = dayColumns[dayIndex] || [];
            return (
              <div
                key={day.dateStr}
                className="relative h-full flex-1 border-r border-edge/40 last:border-r-0"
              >
                {/* Now Line (if day is today) */}
                {day.isToday && nowMinutes >= 0 && nowMinutes <= 1440 && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-30 flex items-center"
                    style={{ top: `${minutesToPx(nowMinutes) - 4}px` }}
                    aria-label="Now indicator"
                  >
                    <span className="-ml-1.5 size-2.5 rounded-full bg-danger ring-2 ring-danger/30 animate-pulse" />
                    <span className="h-[2px] flex-1 bg-danger shadow-sm" />
                  </div>
                )}

                {/* Timed Task Cards */}
                {layoutItems.map(({ item, column, columns }) => {
                  const project = projects.find((p) => p.id === item.task.id);
                  const style = getTaskEventStyle(item.task, project?.color);
                  const completed = isCompleted(item.task, states);
                  const height = Math.max(20, minutesToPx(item.endMinutes - item.startMinutes) - 2);
                  const isBeingDragged = drag?.moved && drag.task?.id === item.task.id;

                  return (
                    <div
                      key={item.task.id}
                      data-task-id={item.task.id}
                      style={{
                        top: `${minutesToPx(item.startMinutes) + 1}px`,
                        height: `${height}px`,
                        left: `calc((100% - 4px) * ${column / columns} + 2px)`,
                        width: `calc((100% - 4px) / ${columns} - ${columns > 1 ? 2 : 0}px)`,
                        backgroundColor: style.background,
                        borderColor: style.borderColor,
                        color: style.color,
                        zIndex: isBeingDragged ? 40 : 10 + column,
                      }}
                      className={`group absolute flex flex-col justify-between overflow-hidden rounded-md border p-1.5 shadow-xs outline-none transition-shadow ${
                        isBeingDragged
                          ? 'opacity-90 shadow-xl cursor-grabbing ring-2 ring-accent'
                          : 'cursor-grab hover:shadow-md'
                      } ${completed ? 'opacity-65 line-through' : ''}`}
                    >
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <PriorityFlag priority={item.task.priority} />
                          <span className="text-[10px] font-semibold opacity-80 whitespace-nowrap">
                            {formatMinutesToTime(item.startMinutes)} - {formatMinutesToTime(item.endMinutes)}
                          </span>
                        </div>
                        {height >= 40 ? (
                          <TwoLineTitle text={item.task.title} className="mt-0.5 text-xs font-semibold leading-tight line-clamp-2" />
                        ) : (
                          <span className="truncate text-xs font-medium leading-tight">{item.task.title}</span>
                        )}
                      </div>

                      {/* Bottom Resize Handle */}
                      <span
                        data-resize
                        aria-hidden
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize hover:bg-accent/40"
                      />
                    </div>
                  );
                })}

                {/* Ghost indicator when dragging to create */}
                {drag?.type === 'create' && drag.dayIndex === dayIndex && (
                  <div
                    className="pointer-events-none absolute z-30 flex flex-col justify-start rounded-md border-2 border-dashed border-accent bg-accent/20 p-1.5 text-accent shadow-sm"
                    style={{
                      top: `${minutesToPx(drag.startMinutes)}px`,
                      height: `${Math.max(20, minutesToPx(drag.endMinutes - drag.startMinutes))}px`,
                      left: '2px',
                      right: '2px',
                    }}
                  >
                    <span className="text-[11px] font-bold">
                      {formatMinutesToTime(drag.startMinutes)} - {formatMinutesToTime(drag.endMinutes)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

