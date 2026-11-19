import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCSVRows, resolveImportedStateGroup } from './importUtils';

test('CSV import preserves quoted multiline descriptions from task exports', () => {
  const markdown = 'First line\r\n\r\n  - [ ] One, "quoted" item\nLast line';
  const csv = '\uFEFFID,Title,Description,Priority,DueDate,StateGroup,Status,AssigneeId,ProjectId\r\n'
    + `"a","Planning, phase 1","${markdown.replaceAll('"', '""')}","P1","2026-12-01","unstarted","todo","user","project"\r\n`
    + '"b","Second task","","P4","","cancelled","abandoned","user","project"';

  assert.deepEqual(parseCSVRows(csv), [
    { title: 'Planning, phase 1', description: markdown, priority: 'P1', dueDate: '2026-12-01', stateGroup: 'unstarted', status: 'todo' },
    { title: 'Second task', description: '', priority: 'P4', dueDate: undefined, stateGroup: 'cancelled', status: 'abandoned' },
  ]);
});

test('task imports respect explicit groups and handle legacy statuses when the group is absent', () => {
  for (const group of ['backlog', 'unstarted', 'started', 'completed', 'cancelled']) {
    assert.equal(resolveImportedStateGroup(group, 'todo'), group);
  }
  assert.equal(resolveImportedStateGroup('', 'in_progress'), 'started');
  assert.equal(resolveImportedStateGroup(undefined, 'completed'), 'completed');
  assert.equal(resolveImportedStateGroup(undefined, 'abandoned'), 'cancelled');
  assert.equal(resolveImportedStateGroup(undefined, '未完成'), 'unstarted');
  assert.equal(resolveImportedStateGroup(undefined, 'constructor'), 'unstarted');
  assert.equal(parseCSVRows('标题,状态\r老任务,已完成')[0]?.stateGroup, 'completed');
});

test('an unterminated CSV field does not return a misleading partial batch', () => {
  assert.deepEqual(parseCSVRows('Title,Description\nFirst,Valid\nSecond,"Incomplete\nThird,Missing'), []);
});

test('CSV imports keep metadata out of missing title and description fields', () => {
  assert.equal(parseCSVRows('Title,StateGroup\nFirst,completed')[0]?.description, '');
  assert.equal(parseCSVRows('StateGroup,Title\ncompleted,First')[0]?.description, '');
  assert.deepEqual(parseCSVRows('Status,Description\ncompleted,Title is missing'), []);
  assert.equal(parseCSVRows('Custom header,Other header\nFirst,Details')[0]?.description, 'Details');
});
