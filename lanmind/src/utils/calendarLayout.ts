/**
 * calendarLayout.ts — Pure functions for 24h calendar time grid & collision layout.
 *
 * CALLING SPEC:
 *   import {
 *     HOUR_HEIGHT,
 *     SNAP_MINUTES,
 *     MIN_TASK_MINUTES,
 *     layoutDay,
 *     minutesToPx,
 *     pxToMinutes,
 *     snap,
 *     clamp,
 *     extractTaskTimeRange,
 *   } from './calendarLayout';
 *
 *   const { isAllDay, startMinutes, endMinutes } = extractTaskTimeRange(task);
 *   const layout = layoutDay(timedTasks);
 *   layout.forEach(({ item, column, columns }) => { ... });
 */

import { Task } from '../types';
import { splitTaskDueDate } from './taskDateTime';

export const HOUR_HEIGHT = 64;
export const SNAP_MINUTES = 15;
export const MIN_TASK_MINUTES = 15;

/** Convert minutes from 00:00 (0..1440) to pixel position in grid. */
export function minutesToPx(minutes: number, hourHeight = HOUR_HEIGHT): number {
  return (minutes / 60) * hourHeight;
}

/** Convert pixel position from top edge to minutes from 00:00 (0..1440). */
export function pxToMinutes(px: number, hourHeight = HOUR_HEIGHT): number {
  return (px / hourHeight) * 60;
}

/** Snap minutes to the nearest interval (default 15 minutes). */
export function snap(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/** Clamp a number between min and max bounds. */
export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/** Parse "HH:mm" string into minutes from 00:00 (e.g. "09:30" -> 570). */
export function parseTimeMinutes(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/** Format minutes from 00:00 (0..1440) into "HH:mm" string. */
export function formatMinutesToTime(minutes: number): string {
  const bounded = clamp(Math.floor(minutes), 0, 1440);
  const h = Math.floor(bounded / 60) % 24;
  const m = bounded % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface TaskTimeRange {
  isAllDay: boolean;
  startMinutes: number;
  endMinutes: number;
}

/**
 * Extracts start and end minutes from a task's startDate and dueDate.
 * If only dueDate has time, default duration is applied (e.g. 60 min).
 * If neither has time, considered all-day.
 */
export function extractTaskTimeRange(
  task: Pick<Task, 'startDate' | 'dueDate'>,
  defaultDurationMinutes = 60
): TaskTimeRange {
  const startParts = splitTaskDueDate(task.startDate);
  const dueParts = splitTaskDueDate(task.dueDate);

  const startTimeMinutes = parseTimeMinutes(startParts.time);
  const dueTimeMinutes = parseTimeMinutes(dueParts.time);

  // If neither has a time specified, treat as all-day
  if (startTimeMinutes === null && dueTimeMinutes === null) {
    return { isAllDay: true, startMinutes: 0, endMinutes: 1440 };
  }

  let start: number;
  let end: number;

  if (startTimeMinutes !== null && dueTimeMinutes !== null) {
    if (startParts.date === dueParts.date) {
      start = startTimeMinutes;
      end = Math.max(startTimeMinutes + MIN_TASK_MINUTES, dueTimeMinutes);
    } else {
      // Cross-day or start is on current day
      start = startTimeMinutes;
      end = Math.min(1440, start + defaultDurationMinutes);
    }
  } else if (startTimeMinutes !== null) {
    start = startTimeMinutes;
    end = Math.min(1440, start + defaultDurationMinutes);
  } else {
    // Only dueTimeMinutes is present
    end = dueTimeMinutes!;
    start = Math.max(0, end - defaultDurationMinutes);
  }

  return {
    isAllDay: false,
    startMinutes: start,
    endMinutes: end,
  };
}

export interface TimedItem {
  startMinutes: number;
  endMinutes: number;
}

export interface PositionedItem<T extends TimedItem> {
  item: T;
  column: number;
  columns: number;
}

/**
 * layoutDay — Greedy interval graph coloring algorithm.
 * Groups transitively overlapping items into clusters and assigns
 * each item to the first available non-colliding column index.
 *
 * TOOL CONTRACT:
 *   Input:  Array of TimedItem (startMinutes, endMinutes)
 *   Output: Array of PositionedItem (with column and total columns in cluster)
 *   Deterministic: Yes
 *   Side effects: None (pure function)
 */
export function layoutDay<T extends TimedItem>(items: T[]): PositionedItem<T>[] {
  if (!items || items.length === 0) return [];

  // Sort: primary by startMinutes ascending, secondary by duration descending
  const sorted = [...items].sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) {
      return a.startMinutes - b.startMinutes;
    }
    const durA = a.endMinutes - a.startMinutes;
    const durB = b.endMinutes - b.startMinutes;
    return durB - durA;
  });

  const out: PositionedItem<T>[] = [];
  let cluster: { item: T; column: number }[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];

  const flush = () => {
    const columns = Math.max(1, columnEnds.length);
    for (const c of cluster) {
      out.push({ item: c.item, column: c.column, columns });
    }
    cluster = [];
    columnEnds = [];
  };

  for (const item of sorted) {
    // If this item starts at or after the cluster ends, close current cluster
    if (item.startMinutes >= clusterEnd && cluster.length > 0) {
      flush();
    }

    // Find the first column where the previous item finished before this item starts
    let assignedCol = columnEnds.findIndex((end) => end <= item.startMinutes);
    if (assignedCol === -1) {
      assignedCol = columnEnds.length;
      columnEnds.push(item.endMinutes);
    } else {
      columnEnds[assignedCol] = item.endMinutes;
    }

    cluster.push({ item, column: assignedCol });
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }

  if (cluster.length > 0) {
    flush();
  }

  return out;
}
