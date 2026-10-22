/**
 * taskModalOptions — Dropdown option definitions for TaskModal
 *
 * CALLING SPEC:
 *   import {
 *     PRIORITY_OPTIONS,
 *     stateOptions,
 *     REMINDER_OPTIONS,
 *     RECURRENCE_OPTIONS,
 *     WEEKDAY_OPTIONS,
 *     HOUR_OPTIONS,
 *     MINUTE_OPTIONS,
 *   } from './taskModalOptions';
 *
 *   stateOptions(states)  // states: WorkItemState[] — 项目自定义状态，可为空数组。为空时返回空列表。
 */
import { tr } from '../i18n';
import { ThemeSelectOption } from './ThemeSelect';
import { RecurrenceWeekday, StateGroup, WorkItemState } from '../types';
import { sortStates } from '../utils/workItemState';

export const PRIORITY_OPTIONS: ThemeSelectOption[] = [
  { value: 'P1', get label() { return tr("tasks:taskModal.p1Urgent"); }, tone: 'rose', indicator: 'flag' },
  { value: 'P2', get label() { return tr("tasks:taskModal.p2High"); }, tone: 'amber', indicator: 'flag' },
  { value: 'P3', get label() { return tr("tasks:taskModal.p3Normal"); }, tone: 'blue', indicator: 'flag' },
  { value: 'P4', get label() { return tr("tasks:taskModal.p4Low"); }, tone: 'slate', indicator: 'flag' },
];

/** 状态组到下拉指示点色调的映射。与 STATE_GROUP_COLORS 的语义一致。 */
const STATE_GROUP_TONES: Record<StateGroup, NonNullable<ThemeSelectOption['tone']>> = {
  backlog: 'slate',
  unstarted: 'blue',
  started: 'amber',
  completed: 'emerald',
  cancelled: 'rose',
};

/**
 * 由状态列表生成状态下拉选项。排序与看板、筛选器一致：先按状态组，再按组内序号。
 * 展示名用状态自己的名称（项目自定义），色调由状态组决定。
 */
export const stateOptions = (states: WorkItemState[]): ThemeSelectOption[] =>
  sortStates(states).map((state) => ({
    value: state.id,
    label: state.name,
    tone: STATE_GROUP_TONES[state.group],
  }));

export const REMINDER_OPTIONS: ThemeSelectOption[] = [
  { value: 'none', get label() { return tr("tasks:taskModal.noReminder"); }, tone: 'slate' },
  { value: '0', get label() { return tr("tasks:taskModal.atDueTime"); }, tone: 'blue' },
  { value: '5', get label() { return tr("tasks:taskModal.5MinutesBefore"); }, tone: 'amber' },
  { value: '10', get label() { return tr("tasks:taskModal.10MinutesBefore"); }, tone: 'amber' },
  { value: '15', get label() { return tr("tasks:taskModal.15MinutesBefore"); }, tone: 'amber' },
  { value: '30', get label() { return tr("tasks:taskModal.30MinutesBefore"); }, tone: 'amber' },
  { value: '60', get label() { return tr('tasks:taskEditor.oneHourBefore'); }, tone: 'amber' },
  { value: '1440', get label() { return tr('tasks:taskEditor.oneDayBefore'); }, tone: 'amber' },
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
    return { value, get label() { return tr("tasks:taskModal.h", { value0: value }); }, tone: 'blue' as const };
  }),
];

export const MINUTE_OPTIONS: ThemeSelectOption[] = Array.from({ length: 60 }, (_, minute) => {
  const value = String(minute).padStart(2, '0');
  return { value, get label() { return tr("tasks:taskModal.min", { value0: value }); }, tone: 'blue' as const };
});
