import assert from 'node:assert/strict';
import test from 'node:test';
import { Task } from '../types';
import {
  alignDueDateToRecurrence,
  calculateNextDueDate,
  expandTaskOccurrences,
  formatRecurrenceLabel,
} from './recurrence';

const task = (overrides: Partial<Task>): Task => ({
  id: 'task-recurrence-test',
  title: '循环测试',
  description: '',
  priority: 'P3',
  status: 'todo',
  dueDate: '2026-08-03T08:00',
  recurrence: 'weekly',
  recurrenceRule: { interval: 1, daysOfWeek: [1], timeOfDay: '08:00' },
  reminderTime: null,
  creatorId: 'user-1',
  assigneeId: 'user-1',
  projectId: null,
  isShared: false,
  sharedWith: [],
  subtasks: [],
  tags: [],
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  version: 1,
  ...overrides,
});

test('aligns a weekly rule to the nearest selected weekday and time', () => {
  assert.equal(
    alignDueDateToRecurrence(
      '2026-08-04T09:00',
      'weekly',
      { interval: 1, daysOfWeek: [1], timeOfDay: '08:00' }
    ),
    '2026-08-10T08:00'
  );
});

test('expands workdays without weekends', () => {
  const occurrences = expandTaskOccurrences(
    task({ recurrenceRule: { interval: 1, daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: '08:00' } }),
    '2026-08-03',
    '2026-08-09'
  );
  assert.deepEqual(occurrences.map((item) => item.dateKey), [
    '2026-08-03',
    '2026-08-04',
    '2026-08-05',
    '2026-08-06',
    '2026-08-07',
  ]);
});

test('supports multiple weekdays in every second week', () => {
  const current = task({
    dueDate: '2026-08-05T08:00',
    recurrenceRule: { interval: 2, daysOfWeek: [1, 3], timeOfDay: '08:00' },
  });
  assert.equal(
    calculateNextDueDate(
      current.dueDate,
      'weekly',
      current.recurrenceRule,
      '2026-08-05T08:00'
    ),
    '2026-08-17T08:00'
  );
});

test('clamps monthly day 31 and restores it in the next valid month', () => {
  const rule = { interval: 1, dayOfMonth: 31, timeOfDay: null };
  const february = calculateNextDueDate('2026-01-31', 'monthly', rule, '2026-01-31');
  assert.equal(february, '2026-02-28');
  assert.equal(calculateNextDueDate(february, 'monthly', rule, february), '2026-03-31');
});

test('clamps February 29 in common years and restores leap day', () => {
  const rule = { interval: 1, monthOfYear: 2, dayOfMonth: 29, timeOfDay: null };
  assert.equal(calculateNextDueDate('2024-02-29', 'yearly', rule, '2024-02-29'), '2025-02-28');
  assert.equal(calculateNextDueDate('2027-02-28', 'yearly', rule, '2027-02-28'), '2028-02-29');
});

test('skips missed periods and returns only the nearest future occurrence', () => {
  assert.equal(
    calculateNextDueDate(
      '2026-01-05T08:00',
      'weekly',
      { interval: 1, daysOfWeek: [1], timeOfDay: '08:00' },
      '2026-02-04T12:00'
    ),
    '2026-02-09T08:00'
  );
});

test('completed recurring tasks do not project virtual future occurrences', () => {
  const occurrences = expandTaskOccurrences(
    task({ status: 'completed' }),
    '2026-08-01',
    '2026-08-31'
  );
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].isVirtual, false);
});

test('formats complete Chinese recurrence summaries', () => {
  assert.equal(
    formatRecurrenceLabel(
      'weekly',
      { interval: 1, daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: '08:00' },
      '2026-08-03T08:00'
    ),
    '每周的周一至周五 08:00'
  );
  assert.equal(
    formatRecurrenceLabel(
      'yearly',
      { interval: 1, monthOfYear: 8, dayOfMonth: 12, timeOfDay: null },
      '2026-08-12'
    ),
    '每年 8 月 12 日'
  );
});
