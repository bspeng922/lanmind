/**
 * taskModalOptions — Dropdown option definitions for TaskModal
 *
 * CALLING SPEC:
 *   import {
 *     PRIORITY_OPTIONS,
 *     STATUS_OPTIONS,
 *     REMINDER_OPTIONS,
 *     RECURRENCE_OPTIONS,
 *     WEEKDAY_OPTIONS,
 *     HOUR_OPTIONS,
 *     MINUTE_OPTIONS,
 *   } from './taskModalOptions';
 */
import { tr } from '../i18n';
import { ThemeSelectOption } from './ThemeSelect';
import { RecurrenceWeekday } from '../types';

export const PRIORITY_OPTIONS: ThemeSelectOption[] = [
  { value: 'P1', get label() { return tr("tasks:taskModal.p1Urgent"); }, tone: 'rose', indicator: 'flag' },
  { value: 'P2', get label() { return tr("tasks:taskModal.p2High"); }, tone: 'amber', indicator: 'flag' },
  { value: 'P3', get label() { return tr("tasks:taskModal.p3Normal"); }, tone: 'blue', indicator: 'flag' },
  { value: 'P4', get label() { return tr("tasks:taskModal.p4Low"); }, tone: 'slate', indicator: 'flag' },
];

export const STATUS_OPTIONS: ThemeSelectOption[] = [
  { value: 'todo', get label() { return tr("tasks:taskModal.notStarted"); }, tone: 'slate' },
  { value: 'in_progress', get label() { return tr("tasks:taskModal.inProgress"); }, tone: 'blue' },
  { value: 'completed', get label() { return tr("tasks:taskModal.completed"); }, tone: 'emerald' },
  { value: 'blocked', get label() { return tr("tasks:taskModal.blocked"); }, tone: 'rose' },
  { value: 'abandoned', get label() { return tr("tasks:taskModal.abandoned"); }, tone: 'slate' },
];

export const REMINDER_OPTIONS: ThemeSelectOption[] = [
  { value: 'none', get label() { return tr("tasks:taskModal.noReminder"); }, tone: 'slate' },
  { value: '0', get label() { return tr("tasks:taskModal.atDueTime"); }, tone: 'blue' },
  { value: '5', get label() { return tr("tasks:taskModal.5MinutesBefore"); }, tone: 'amber' },
  { value: '10', get label() { return tr("tasks:taskModal.10MinutesBefore"); }, tone: 'amber' },
  { value: '15', get label() { return tr("tasks:taskModal.15MinutesBefore"); }, tone: 'amber' },
  { value: '30', get label() { return tr("tasks:taskModal.30MinutesBefore"); }, tone: 'amber' },
];

export const RECURRENCE_OPTIONS: ThemeSelectOption[] = [
  { value: 'none', get label() { return tr("tasks:taskModal.doesNotRepeat"); }, tone: 'slate' },
  { value: 'daily', get label() { return tr("tasks:taskModal.daily"); }, tone: 'blue' },
  { value: 'weekly', get label() { return tr("tasks:taskModal.weekly"); }, tone: 'blue' },
  { value: 'monthly', get label() { return tr("tasks:taskModal.monthly"); }, tone: 'blue' },
  { value: 'yearly', get label() { return tr("tasks:taskModal.yearly"); }, tone: 'blue' },
];

export const WEEKDAY_OPTIONS: Array<{ value: RecurrenceWeekday; label: string }> = [
  { value: 1, get label() { return tr("tasks:taskModal.mon"); } },
  { value: 2, get label() { return tr("tasks:taskModal.tue"); } },
  { value: 3, get label() { return tr("tasks:taskModal.wed"); } },
  { value: 4, get label() { return tr("tasks:taskModal.thu"); } },
  { value: 5, get label() { return tr("tasks:taskModal.fri"); } },
  { value: 6, get label() { return tr("tasks:taskModal.sat"); } },
  { value: 7, get label() { return tr("tasks:taskModal.sun"); } },
];

export const HOUR_OPTIONS: ThemeSelectOption[] = [
  { value: '', get label() { return tr("tasks:taskModal.notSet"); }, tone: 'slate' },
  ...Array.from({ length: 24 }, (_, hour) => {
    const value = String(hour).padStart(2, '0');
    return { value, label: tr("tasks:taskModal.h", { value0: value }), tone: 'blue' as const };
  }),
];

export const MINUTE_OPTIONS: ThemeSelectOption[] = Array.from({ length: 60 }, (_, minute) => {
  const value = String(minute).padStart(2, '0');
  return { value, label: tr("tasks:taskModal.min", { value0: value }), tone: 'blue' as const };
});
