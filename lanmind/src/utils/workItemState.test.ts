import test from 'node:test';
import assert from 'node:assert/strict';
import type { StateGroup, WorkItemState } from '../types';
import { nextMainPathState } from './workItemState';

const makeState = (
  id: string,
  name: string,
  group: StateGroup,
  sequence: number,
  isDefault = false,
  projectId: string | null = 'p1',
): WorkItemState => ({
  id,
  name,
  group,
  sequence,
  isDefault,
  projectId,
  color: '#3f76ff',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

const DEFAULT_STATES: WorkItemState[] = [
  makeState('s-backlog', 'Backlog', 'backlog', 0, true),
  makeState('s-todo', 'Todo', 'unstarted', 1, true),
  makeState('s-progress', 'In Progress', 'started', 2, true),
  makeState('s-blocked', 'Blocked', 'started', 3, false),
  makeState('s-done', 'Done', 'completed', 4, true),
  makeState('s-cancelled', 'Cancelled', 'cancelled', 5, true),
];

test('nextMainPathState skips Blocked and Cancelled along the main workflow path', () => {
  const advance = (stateId: string, stateGroup: StateGroup, stateName: string) =>
    nextMainPathState({ projectId: 'p1', stateId, stateGroup, stateName, status: 'todo' }, DEFAULT_STATES)?.id;

  assert.equal(advance('s-backlog', 'backlog', 'Backlog'), 's-todo');
  assert.equal(advance('s-todo', 'unstarted', 'Todo'), 's-progress');
  assert.equal(advance('s-progress', 'started', 'In Progress'), 's-done');
  assert.equal(advance('s-done', 'completed', 'Done'), 's-todo');
  assert.equal(advance('s-blocked', 'started', 'Blocked'), 's-progress');
  assert.equal(advance('s-cancelled', 'cancelled', 'Cancelled'), 's-todo');
});

test('nextMainPathState advances through custom started states while still skipping Chinese blocked state', () => {
  const customStates: WorkItemState[] = [
    makeState('c-todo', '待开发', 'unstarted', 0, true),
    makeState('c-dev', '开发中', 'started', 1, true),
    makeState('c-review', '待评审', 'started', 2, false),
    makeState('c-blocked', '已阻塞', 'started', 3, false),
    makeState('c-done', '已完成', 'completed', 4, true),
    makeState('c-closed', '已归档', 'completed', 5, false),
    makeState('c-cancel', '已放弃', 'cancelled', 6, true),
  ];

  const advance = (stateId: string, stateGroup: StateGroup, stateName: string) =>
    nextMainPathState({ projectId: 'p1', stateId, stateGroup, stateName, status: 'todo' }, customStates)?.id;

  assert.equal(advance('c-todo', 'unstarted', '待开发'), 'c-dev');
  assert.equal(advance('c-dev', 'started', '开发中'), 'c-review');
  assert.equal(advance('c-review', 'started', '待评审'), 'c-done');
  assert.equal(advance('c-done', 'completed', '已完成'), 'c-todo');
  assert.equal(advance('c-closed', 'completed', '已归档'), 'c-todo');
  assert.equal(advance('c-blocked', 'started', '已阻塞'), 'c-dev');
  assert.equal(advance('c-cancel', 'cancelled', '已放弃'), 'c-todo');
});
