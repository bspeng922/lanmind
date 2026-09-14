/**
 * calendarGrid — Pure-function calendar matrix generation and weekday headers.
 *
 * CALLING SPEC:
 *   const grid: CalendarGridCell[] = generateCalendarGrid(year, month, weekStart);
 *   const headers: string[] = getWeekdayHeaders(weekStart, format);
 *   const currentWeekStart: WeekStartDay = getStoredWeekStartDay();
 *   setStoredWeekStartDay('monday' | 'sunday');
 *
 * TOOL CONTRACT:
 *   Input:  year (number), month (0-11 number), weekStart ('monday' | 'sunday')
 *   Output: Array of 42 CalendarGridCell objects (6 weeks x 7 days)
 *   Side effects: None (in pure calculation functions)
 *   Deterministic: Same inputs -> Same output
 */

import { WeekStartDay } from '../types';

export interface CalendarGridCell {
  dateStr: string;
  dayNum: number;
  isCurrentMonth: boolean;
  dateObj: Date;
}

export type WeekdayHeaderFormat = 'short' | 'full' | 'bilingual';

export const WEEK_START_STORAGE_KEY = 'lanmind_week_start_day';
export const WEEK_START_CHANGE_EVENT = 'lanmind-week-start-change';
export const TAURI_WEEK_START_EVENT = 'lanmind://week-start-changed';

const MONDAY_HEADERS: Record<WeekdayHeaderFormat, string[]> = {
  bilingual: ['周一 Mon', '周二 Tue', '周三 Wed', '周四 Thu', '周五 Fri', '周六 Sat', '周日 Sun'],
  full: ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'],
  short: ['一', '二', '三', '四', '五', '六', '日'],
};

const SUNDAY_HEADERS: Record<WeekdayHeaderFormat, string[]> = {
  bilingual: ['周日 Sun', '周一 Mon', '周二 Tue', '周三 Wed', '周四 Thu', '周五 Fri', '周六 Sat'],
  full: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
  short: ['日', '一', '二', '三', '四', '五', '六'],
};

export function formatYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getWeekdayHeaders(weekStart: WeekStartDay, format: WeekdayHeaderFormat): string[] {
  return weekStart === 'sunday' ? SUNDAY_HEADERS[format] : MONDAY_HEADERS[format];
}

export function generateCalendarGrid(
  year: number,
  month: number,
  weekStart: WeekStartDay
): CalendarGridCell[] {
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const leadingDays = weekStart === 'sunday' ? firstDayOfMonth : (firstDayOfMonth + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const gridCells: CalendarGridCell[] = [];

  // 1. Leading days from previous month
  for (let i = leadingDays - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const dateObj = new Date(year, month - 1, dayNum);
    gridCells.push({
      dateStr: formatYMD(dateObj),
      dayNum,
      isCurrentMonth: false,
      dateObj,
    });
  }

  // 2. Days in current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    gridCells.push({
      dateStr: formatYMD(dateObj),
      dayNum: d,
      isCurrentMonth: true,
      dateObj,
    });
  }

  // 3. Trailing days from next month to complete 42 cells (6 rows x 7 cols)
  const remaining = 42 - gridCells.length;
  for (let d = 1; d <= remaining; d++) {
    const dateObj = new Date(year, month + 1, d);
    gridCells.push({
      dateStr: formatYMD(dateObj),
      dayNum: d,
      isCurrentMonth: false,
      dateObj,
    });
  }

  return gridCells;
}

export function getStoredWeekStartDay(): WeekStartDay {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 'monday';
  }
  const stored = window.localStorage.getItem(WEEK_START_STORAGE_KEY);
  return stored === 'sunday' ? 'sunday' : 'monday';
}

export function setStoredWeekStartDay(weekStart: WeekStartDay): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(WEEK_START_STORAGE_KEY, weekStart);
    window.dispatchEvent(new CustomEvent(WEEK_START_CHANGE_EVENT, { detail: weekStart }));
    try {
      import('@tauri-apps/api/core').then(({ isTauri }) => {
        if (isTauri()) {
          import('@tauri-apps/api/event').then(({ emit }) => {
            void emit(TAURI_WEEK_START_EVENT, weekStart).catch(() => {});
          }).catch(() => {});
        }
      }).catch(() => {});
    } catch {
      // Ignore in non-Tauri environments
    }
  }
}
