import { RecurrenceRule, RecurrenceType, RecurrenceWeekday, Task } from '../types';
import {
  combineTaskDueDate,
  formatLocalTaskDateTime,
  parseTaskDateTime,
  splitTaskDueDate,
} from './taskDateTime';

export interface TaskOccurrence {
  task: Task;
  dateKey: string;
  dueDate: string;
  isVirtual: boolean;
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_LABELS: Record<RecurrenceWeekday, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
};

function isoWeekday(date: Date): RecurrenceWeekday {
  return (date.getDay() === 0 ? 7 : date.getDay()) as RecurrenceWeekday;
}

function positiveInteger(value: unknown, fallback: number, max = 999): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : fallback;
}

function ruleTime(rule: RecurrenceRule, fallback: Date): [number, number] {
  const value = rule.timeOfDay;
  if (value && TIME_PATTERN.test(value)) {
    const [hour, minute] = value.split(':').map(Number);
    return [hour, minute];
  }
  return [fallback.getHours(), fallback.getMinutes()];
}

function atRuleTime(date: Date, rule: RecurrenceRule, fallback: Date): Date {
  const [hour, minute] = ruleTime(rule, fallback);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function monthOccurrence(
  year: number,
  monthIndex: number,
  dayOfMonth: number,
  rule: RecurrenceRule,
  fallback: Date
): Date {
  const day = Math.min(dayOfMonth, lastDayOfMonth(year, monthIndex));
  return atRuleTime(new Date(year, monthIndex, day), rule, fallback);
}

function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - (isoWeekday(monday) - 1));
  return monday;
}

function serializeOccurrence(date: Date, rule: RecurrenceRule): string {
  return formatLocalTaskDateTime(date, Boolean(rule.timeOfDay));
}

export function normalizeRecurrenceRule(
  recurrence: RecurrenceType,
  value: RecurrenceRule | null | undefined,
  dueDate?: string | null
): RecurrenceRule | null {
  if (recurrence === 'none') return null;

  const anchor = parseTaskDateTime(dueDate) || new Date();
  const dueTime = splitTaskDueDate(dueDate).time;
  const interval = positiveInteger(value?.interval, 1);
  const timeOfDay = value?.timeOfDay === null
    ? null
    : value?.timeOfDay && TIME_PATTERN.test(value.timeOfDay)
      ? value.timeOfDay
      : dueTime || null;
  const base: RecurrenceRule = { interval, timeOfDay };

  if (recurrence === 'weekly') {
    const requestedDays = Array.isArray(value?.daysOfWeek) ? value.daysOfWeek : [];
    const days = Array.from(
      new Set(
        requestedDays.filter(
          (day): day is RecurrenceWeekday => Number.isInteger(day) && day >= 1 && day <= 7
        )
      )
    ).sort((left, right) => left - right);
    return { ...base, daysOfWeek: days.length > 0 ? days : [isoWeekday(anchor)] };
  }

  if (recurrence === 'monthly') {
    return { ...base, dayOfMonth: positiveInteger(value?.dayOfMonth, anchor.getDate(), 31) };
  }

  if (recurrence === 'yearly') {
    const monthOfYear = positiveInteger(value?.monthOfYear, anchor.getMonth() + 1, 12);
    return {
      ...base,
      monthOfYear,
      dayOfMonth: positiveInteger(value?.dayOfMonth, anchor.getDate(), 31),
    };
  }

  return base;
}

/** Align a user-provided start boundary to the nearest matching occurrence. */
export function alignDueDateToRecurrence(
  dueDate: string | null | undefined,
  recurrence: RecurrenceType,
  value?: RecurrenceRule | null
): string {
  const boundary = parseTaskDateTime(dueDate) || new Date();
  const rule = normalizeRecurrenceRule(recurrence, value, dueDate);
  if (!rule) return dueDate || formatLocalTaskDateTime(boundary, false);

  if (recurrence === 'daily') {
    let candidate = atRuleTime(boundary, rule, boundary);
    if (candidate < boundary) candidate.setDate(candidate.getDate() + 1);
    return serializeOccurrence(candidate, rule);
  }

  if (recurrence === 'weekly') {
    const selected = rule.daysOfWeek || [isoWeekday(boundary)];
    for (let offset = 0; offset <= 7; offset += 1) {
      const date = new Date(boundary.getFullYear(), boundary.getMonth(), boundary.getDate() + offset);
      if (!selected.includes(isoWeekday(date))) continue;
      const candidate = atRuleTime(date, rule, boundary);
      if (candidate >= boundary) return serializeOccurrence(candidate, rule);
    }
  }

  if (recurrence === 'monthly') {
    const targetDay = rule.dayOfMonth || boundary.getDate();
    for (let offset = 0; offset <= 1; offset += 1) {
      const targetMonth = new Date(boundary.getFullYear(), boundary.getMonth() + offset, 1);
      const candidate = monthOccurrence(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        targetDay,
        rule,
        boundary
      );
      if (candidate >= boundary) return serializeOccurrence(candidate, rule);
    }
  }

  if (recurrence === 'yearly') {
    const month = (rule.monthOfYear || boundary.getMonth() + 1) - 1;
    const day = rule.dayOfMonth || boundary.getDate();
    for (let offset = 0; offset <= 1; offset += 1) {
      const candidate = monthOccurrence(boundary.getFullYear() + offset, month, day, rule, boundary);
      if (candidate >= boundary) return serializeOccurrence(candidate, rule);
    }
  }

  return serializeOccurrence(boundary, rule);
}

function nextOccurrenceDate(
  current: Date,
  recurrence: RecurrenceType,
  rule: RecurrenceRule,
  after: Date
): Date {
  const interval = rule.interval;

  if (recurrence === 'daily') {
    const candidate = atRuleTime(current, rule, current);
    do {
      candidate.setDate(candidate.getDate() + interval);
    } while (candidate <= after);
    return candidate;
  }

  if (recurrence === 'weekly') {
    const selected = rule.daysOfWeek || [isoWeekday(current)];
    const anchorMonday = mondayOf(current);
    for (let cycle = 0; cycle < 10_000; cycle += 1) {
      const cycleMonday = new Date(anchorMonday);
      cycleMonday.setDate(cycleMonday.getDate() + cycle * interval * 7);
      for (const weekday of selected) {
        const date = new Date(cycleMonday);
        date.setDate(date.getDate() + weekday - 1);
        const candidate = atRuleTime(date, rule, current);
        if (candidate > current && candidate > after) return candidate;
      }
    }
  }

  if (recurrence === 'monthly') {
    const day = rule.dayOfMonth || current.getDate();
    for (let step = 1; step < 10_000; step += 1) {
      const targetMonth = new Date(current.getFullYear(), current.getMonth() + step * interval, 1);
      const candidate = monthOccurrence(
        targetMonth.getFullYear(),
        targetMonth.getMonth(),
        day,
        rule,
        current
      );
      if (candidate > after) return candidate;
    }
  }

  if (recurrence === 'yearly') {
    const month = (rule.monthOfYear || current.getMonth() + 1) - 1;
    const day = rule.dayOfMonth || current.getDate();
    for (let step = 1; step < 10_000; step += 1) {
      const candidate = monthOccurrence(
        current.getFullYear() + step * interval,
        month,
        day,
        rule,
        current
      );
      if (candidate > after) return candidate;
    }
  }

  const fallback = new Date(after);
  fallback.setDate(fallback.getDate() + 1);
  return atRuleTime(fallback, rule, current);
}

export function expandTaskOccurrences(
  task: Task,
  rangeStart: string,
  rangeEnd: string
): TaskOccurrence[] {
  const anchor = parseTaskDateTime(task.dueDate);
  const start = parseTaskDateTime(rangeStart);
  const end = parseTaskDateTime(`${rangeEnd}T23:59`);
  if (!anchor || !start || !end) return [];

  const recurrence = task.status === 'completed' ? 'none' : task.recurrence || 'none';
  const time = splitTaskDueDate(task.dueDate).time;
  if (recurrence === 'none') {
    if (anchor < start || anchor > end) return [];
    const dateKey = formatLocalTaskDateTime(anchor, false);
    return [{ task, dateKey, dueDate: combineTaskDueDate(dateKey, time) || dateKey, isVirtual: false }];
  }

  const rule = normalizeRecurrenceRule(recurrence, task.recurrenceRule, task.dueDate);
  if (!rule) return [];
  const occurrences: TaskOccurrence[] = [];
  let date = anchor;
  for (let index = 0; index < 5000 && date <= end; index += 1) {
    if (date >= start) {
      const dateKey = formatLocalTaskDateTime(date, false);
      occurrences.push({
        task,
        dateKey,
        dueDate: combineTaskDueDate(dateKey, rule.timeOfDay || time) || dateKey,
        isVirtual: index > 0,
      });
    }
    date = nextOccurrenceDate(date, recurrence, rule, date);
  }
  return occurrences;
}

export function calculateNextDueDate(
  currentDueDate: string | null | undefined,
  recurrence: RecurrenceType,
  recurrenceRule?: RecurrenceRule | null,
  after: Date | string = new Date()
): string {
  if (!recurrence || recurrence === 'none') {
    return currentDueDate || formatLocalTaskDateTime(new Date(), false);
  }

  const baseDate = parseTaskDateTime(currentDueDate) || new Date();
  if (isNaN(baseDate.getTime())) {
    const today = new Date();
    return formatLocalTaskDateTime(today, false);
  }

  const rule = normalizeRecurrenceRule(recurrence, recurrenceRule, currentDueDate);
  if (!rule) return currentDueDate || formatLocalTaskDateTime(baseDate, false);
  const requestedBoundary = typeof after === 'string' ? parseTaskDateTime(after) : after;
  const boundary = requestedBoundary && requestedBoundary > baseDate ? requestedBoundary : baseDate;
  const nextDate = nextOccurrenceDate(baseDate, recurrence, rule, boundary);
  return serializeOccurrence(nextDate, rule);
}

export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  none: '不重复',
  daily: '每天重复',
  weekly: '每周重复',
  monthly: '每月重复',
  yearly: '每年重复',
};

export function formatRecurrenceLabel(
  recurrence: RecurrenceType | null | undefined,
  recurrenceRule?: RecurrenceRule | null,
  dueDate?: string | null
): string {
  const type = recurrence && ['daily', 'weekly', 'monthly', 'yearly'].includes(recurrence)
    ? recurrence
    : 'none';
  const rule = normalizeRecurrenceRule(type, recurrenceRule, dueDate);
  if (!rule) return RECURRENCE_LABELS.none;

  const interval = rule.interval;
  let label = '';
  if (type === 'daily') {
    label = interval === 1 ? '每天' : `每 ${interval} 天`;
  } else if (type === 'weekly') {
    const days = rule.daysOfWeek || [];
    const dayLabel = days.length === 5 && days.every((day, index) => day === index + 1)
      ? '周一至周五'
      : days.map((day) => WEEKDAY_LABELS[day]).join('、');
    if (interval === 1 && days.length === 1) label = `每${dayLabel}`;
    else if (interval === 1) label = `每周的${dayLabel}`;
    else label = `每 ${interval} 周的${dayLabel}`;
  } else if (type === 'monthly') {
    label = interval === 1
      ? `每月 ${rule.dayOfMonth} 号`
      : `每 ${interval} 月的 ${rule.dayOfMonth} 号`;
  } else if (type === 'yearly') {
    label = interval === 1
      ? `每年 ${rule.monthOfYear} 月 ${rule.dayOfMonth} 日`
      : `每 ${interval} 年的 ${rule.monthOfYear} 月 ${rule.dayOfMonth} 日`;
  }
  return rule.timeOfDay ? `${label} ${rule.timeOfDay}` : label;
}
