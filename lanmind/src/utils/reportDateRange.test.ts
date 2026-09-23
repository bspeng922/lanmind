import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTaskStats,
  filterTasksForPeriod,
  getReportDateRange,
} from './reportDateRange';
import { Task } from '../types';

const mockTask = (overrides: Partial<Task>): Task => ({
  id: 'task-1',
  title: 'Test task',
  description: 'Test description',
  priority: 'P2',
  status: 'todo',
  dueDate: null,
  creatorId: 'user1',
  assigneeId: 'user1',
  projectId: null,
  isShared: false,
  sharedWith: [],
  subtasks: [],
  tags: [],
  createdAt: '2026-09-20T10:00:00Z',
  updatedAt: '2026-09-20T10:00:00Z',
  version: 1,
  ...overrides,
});

test('getReportDateRange computes daily range correctly', () => {
  const refDate = new Date(2026, 8, 23); // 2026-09-23
  const current = getReportDateRange('daily', refDate, 'current');
  assert.equal(current.startDate, '2026-09-23');
  assert.equal(current.endDate, '2026-09-23');

  const previous = getReportDateRange('daily', refDate, 'previous');
  assert.equal(previous.startDate, '2026-09-22');
  assert.equal(previous.endDate, '2026-09-22');
});

test('getReportDateRange computes weekly range starting on Monday', () => {
  // 2026-09-23 is Wednesday
  const refDate = new Date(2026, 8, 23);
  const current = getReportDateRange('weekly', refDate, 'current');
  assert.equal(current.startDate, '2026-09-21'); // Monday
  assert.equal(current.endDate, '2026-09-27'); // Sunday
});

test('getReportDateRange computes monthly range', () => {
  const refDate = new Date(2026, 8, 23);
  const current = getReportDateRange('monthly', refDate, 'current');
  assert.equal(current.startDate, '2026-09-01');
  assert.equal(current.endDate, '2026-09-30');
});

test('filterTasksForPeriod includes only relevant user tasks', () => {
  const tasks = [
    mockTask({ id: 't1', creatorId: 'user1', updatedAt: '2026-09-23T10:00:00Z' }),
    mockTask({ id: 't2', creatorId: 'other', assigneeId: 'user1', updatedAt: '2026-09-23T10:00:00Z' }),
    mockTask({ id: 't3', creatorId: 'other', sharedWith: ['user1'], updatedAt: '2026-09-23T10:00:00Z' }),
    mockTask({ id: 't4', creatorId: 'other', assigneeId: 'other', sharedWith: [], updatedAt: '2026-09-23T10:00:00Z' }),
  ];

  const result = filterTasksForPeriod(tasks, {
    currentUserId: 'user1',
    startDate: '2026-09-23',
    endDate: '2026-09-23',
  });

  const ids = result.map((t) => t.id);
  assert.deepEqual(ids, ['t1', 't2', 't3']);
});

test('filterTasksForPeriod filters by selected project', () => {
  const tasks = [
    mockTask({ id: 't1', projectId: 'prj-a', updatedAt: '2026-09-23T10:00:00Z' }),
    mockTask({ id: 't2', projectId: 'prj-b', updatedAt: '2026-09-23T10:00:00Z' }),
  ];

  const result = filterTasksForPeriod(tasks, {
    currentUserId: 'user1',
    startDate: '2026-09-23',
    endDate: '2026-09-23',
    selectedProjectId: 'prj-a',
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, 't1');
});

test('filterTasksForPeriod matches created, updated, due, and active tasks', () => {
  const tasks = [
    // Created in period
    mockTask({ id: 't1', createdAt: '2026-09-23T08:00:00Z', updatedAt: '2026-09-23T08:00:00Z', status: 'completed' }),
    // Updated in period
    mockTask({ id: 't2', createdAt: '2026-09-01T08:00:00Z', updatedAt: '2026-09-23T12:00:00Z', status: 'completed' }),
    // Due in period
    mockTask({ id: 't3', createdAt: '2026-09-01T08:00:00Z', updatedAt: '2026-09-01T08:00:00Z', dueDate: '2026-09-23', status: 'todo' }),
    // Active ongoing task (in_progress) created before period
    mockTask({ id: 't4', createdAt: '2026-09-10T08:00:00Z', updatedAt: '2026-09-10T08:00:00Z', status: 'in_progress' }),
    // Irrelevant old task already completed in the past
    mockTask({ id: 't5', createdAt: '2026-08-01T08:00:00Z', updatedAt: '2026-08-05T08:00:00Z', status: 'completed' }),
  ];

  const result = filterTasksForPeriod(tasks, {
    currentUserId: 'user1',
    startDate: '2026-09-23',
    endDate: '2026-09-23',
  });

  const ids = result.map((t) => t.id);
  assert.ok(ids.includes('t1'), 't1 created in period should be included');
  assert.ok(ids.includes('t2'), 't2 updated in period should be included');
  assert.ok(ids.includes('t3'), 't3 due in period should be included');
  assert.ok(ids.includes('t4'), 't4 active ongoing should be included');
  assert.ok(!ids.includes('t5'), 't5 completed long ago should be excluded');
});

test('calculateTaskStats aggregates counts accurately', () => {
  const tasks = [
    { status: 'completed' as const },
    { status: 'completed' as const },
    { status: 'in_progress' as const },
    { status: 'blocked' as const },
    { status: 'todo' as const },
  ];

  const stats = calculateTaskStats(tasks);
  assert.deepEqual(stats, {
    total: 5,
    completed: 2,
    inProgress: 1,
    blocked: 1,
    todo: 1,
  });
});
