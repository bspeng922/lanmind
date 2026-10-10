import test from 'node:test';
import assert from 'node:assert/strict';
import { Task } from '../types';
import { compareTasks, DEFAULT_PROJECT_LAYOUT, filterTasksByLayout, matchesTaskDate, normalizeTaskLayout, ProjectLayout } from './taskLayout';
import { selectCalendarTasks } from './taskCalendarLayout';

const now = new Date(2026, 8, 14, 12);
const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'a', title: 'Task', description: '', priority: 'P1', status: 'todo', dueDate: '2026-09-14',
  creatorId: 'me', assigneeId: 'me', projectId: 'project-a', isShared: false, sharedWith: [], subtasks: [], tags: ['product'],
  createdAt: '2026-09-01', updatedAt: '2026-09-10', version: 1, ...overrides,
});
const layout = (patch: Partial<ProjectLayout> = {}) => ({ ...DEFAULT_PROJECT_LAYOUT, ...patch });
const ids = (items: Task[]) => items.map((item) => item.id);

test('migrates scalar preferences, keeps view/group/sort, and validates array preferences', () => {
  const migrated = normalizeTaskLayout({ view: 'timeline', groupMode: 'status', sortMode: 'updatedAt', priorityFilter: 'P2', statusFilter: 'completed', dateFilter: 'tomorrow', tagFilter: 'ALL', showCompleted: true });
  assert.equal(migrated.view, 'timeline');
  assert.equal(migrated.groupMode, 'status');
  assert.equal(migrated.sortDirection, 'desc');
  assert.deepEqual(migrated.priorityFilter, ['P2']);
  assert.deepEqual(migrated.statusFilter, ['completed']);
  assert.deepEqual(migrated.dateFilter, ['tomorrow']);
  assert.deepEqual(migrated.tagFilter, ['ALL']);
  assert.deepEqual(normalizeTaskLayout({ priorityFilter: 'ALL', statusFilter: 'ALL', dateFilter: 'ALL', tagFilter: null }), DEFAULT_PROJECT_LAYOUT);
  assert.deepEqual(normalizeTaskLayout({ priorityFilter: ['P1', 'P1', 'bad', 5], projectFilter: [null, 'a', null, 5], tagFilter: ['', 'ALL'], sortMode: 'bad' }).priorityFilter, ['P1']);
  assert.deepEqual(normalizeTaskLayout({ projectFilter: [null, 'a', null, 5] }).projectFilter, [null, 'a']);
  assert.deepEqual(normalizeTaskLayout(null), DEFAULT_PROJECT_LAYOUT);
});

test('uses OR within a dimension and AND across priorities, statuses, dates, tags, people and projects', () => {
  const tasks = [task(), task({ id: 'b', priority: 'P2', status: 'in_progress', dueDate: '2026-09-15', tags: ['delivery'], assigneeId: 'peer', projectId: 'project-b' }),
    task({ id: 'c', priority: 'P3' }), task({ id: 'd', status: 'blocked' }), task({ id: 'e', dueDate: '2026-09-16' }),
    task({ id: 'f', tags: ['other'] }), task({ id: 'g', assigneeId: 'other' }), task({ id: 'h', projectId: null }),
    task({ id: 'child', parentTaskId: 'a' })];
  const filters = layout({ priorityFilter: ['P1', 'P2'], statusFilter: ['todo', 'in_progress'], dateFilter: ['today', 'tomorrow'], tagFilter: ['product', 'delivery'], assigneeFilter: ['me', 'peer'], projectFilter: ['project-a', 'project-b'] });
  assert.deepEqual(ids(filterTasksByLayout(tasks, filters, '', now)), ['a', 'b']);
  assert.deepEqual(ids(filterTasksByLayout(tasks, filters, 'delivery', now)), ['b']);
  assert.equal(tasks.length, 9);
  assert.deepEqual(ids(filterTasksByLayout([task({ projectId: null, assigneeId: '' })], layout({ projectFilter: [null], assigneeFilter: [''] }), '', now)), ['a']);
});

test('explicit status selections override default completed and abandoned visibility', () => {
  const tasks = [task(), task({ id: 'done', status: 'completed' }), task({ id: 'abandoned', status: 'abandoned' })];
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout(), '', now)), ['a']);
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout({ showCompleted: true }), '', now)), ['a', 'done']);
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout({ statusFilter: ['completed', 'abandoned'] }), '', now)), ['done', 'abandoned']);
});

test('relative dates use local day boundaries, exclude terminal tasks from overdue, and distinguish start-only tasks', () => {
  const boundary = new Date(2026, 11, 31, 23, 59);
  assert.equal(matchesTaskDate(task({ dueDate: '2027-01-01T08:00' }), ['tomorrow'], boundary), true);
  assert.equal(matchesTaskDate(task({ dueDate: '2026-09-13', status: 'completed' }), ['overdue'], now), false);
  assert.equal(matchesTaskDate(task({ dueDate: null, startDate: '2026-09-14' }), ['unscheduled'], now), false);
  assert.equal(matchesTaskDate(task({ dueDate: null }), ['unscheduled'], now), true);
  assert.equal(matchesTaskDate(task({ dueDate: '2026-09-15' }), ['upcoming'], now), true);
});

test('sorting supports both directions, stable ties, missing dates last, and default input order', () => {
  const tasks = [task({ id: 'z', dueDate: null }), task({ id: 'b', dueDate: '2026-09-15' }), task({ id: 'a' }), task({ id: 'c' })];
  assert.deepEqual(ids([...tasks].sort((a, b) => compareTasks(a, b, layout({ sortMode: 'dueDate' })))), ['a', 'c', 'b', 'z']);
  assert.deepEqual(ids([...tasks].sort((a, b) => compareTasks(a, b, layout({ sortMode: 'dueDate', sortDirection: 'desc' })))), ['b', 'a', 'c', 'z']);
  assert.deepEqual(ids(filterTasksByLayout(tasks, layout(), '', now)), ['z', 'b', 'a', 'c']);
  assert.deepEqual(ids(filterTasksByLayout([task({ id: 'later', startDate: '2026-09-15' }), task({ id: 'earlier', startDate: '2026-09-13' })], layout({ sortMode: 'startDate' }), '', now)), ['earlier', 'later']);
});

test('calendar filters actual recurring occurrences rather than the old anchor date', () => {
  const repeating = task({ id: 'repeat', recurrence: 'daily', dueDate: '2026-09-01T09:00' });
  const result = selectCalendarTasks([repeating, task({ id: 'once' })], layout({ dateFilter: ['today', 'tomorrow'], sortMode: 'dueDate' }), '', '2026-09-01', '2026-09-30', now);
  assert.deepEqual([...result.tasksByDate.keys()].sort(), ['2026-09-14', '2026-09-15']);
  assert.deepEqual(result.tasksByDate.get('2026-09-14')!.map((item) => item.task.id), ['once', 'repeat']);
  assert.equal(result.tasksByDate.get('2026-09-15')![0].dueDate, '2026-09-15T09:00');
  assert.equal(selectCalendarTasks([repeating], layout({ dateFilter: ['today'] }), '', '2026-10-01', '2026-10-31', now).tasksByDate.size, 0);
});

test('calendar includes undated and start-only tasks, but unscheduled filters only fully undated tasks', () => {
  const tasks = [task({ id: 'undated', dueDate: null }), task({ id: 'start-only', dueDate: null, startDate: '2026-09-14' })];
  assert.deepEqual(ids(selectCalendarTasks(tasks, layout(), '', '2026-09-01', '2026-09-30', now).undated), ['undated', 'start-only']);
  assert.deepEqual(ids(selectCalendarTasks(tasks, layout({ dateFilter: ['unscheduled'] }), '', '2026-09-01', '2026-09-30', now).undated), ['undated']);
});
