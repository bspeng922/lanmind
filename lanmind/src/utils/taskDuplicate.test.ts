import test from 'node:test';
import assert from 'node:assert/strict';
import { Task } from '../types';
import { buildTaskDuplicate } from './taskDuplicate';

const parent: Task = {
  id: 'parent', title: '原任务', description: '保留正文\n\n![资料](lanmind-attachment:image)\n\n- [x] 检查\n\n```md\n- [x] 示例\n```',
  priority: 'P2', status: 'completed', progress: 100, dueDate: '2026-10-10', creatorId: 'old-user', assigneeId: 'member',
  projectId: 'project', isShared: true, sharedWith: [], subtasks: [{ id: 'check', title: '检查', completed: true }], tags: ['验收'],
  attachments: [{ id: 'image', name: '资料.png', size: 4, type: 'image/png', dataUrl: 'data:image/png;base64,dGVzdA==', addedAt: '2026-10-08' }],
  createdAt: '2026-10-08', updatedAt: '2026-10-08', version: 1,
};

test('copies the whole family with fresh IDs, reset progress and working image references', () => {
  const child = { ...parent, id: 'child', parentTaskId: parent.id, title: '独立子任务', recurrence: 'weekly' as const, reminderTime: '2026-10-10T09:00' };
  const tasks = [parent, child, { ...parent, id: 'unrelated', title: '其他任务' }];
  const original = structuredClone(tasks);
  const copy = buildTaskDuplicate(parent, tasks, 'current-user');
  assert.equal(copy.task.title, '原任务（副本）');
  assert.equal(copy.task.status, 'todo');
  assert.equal(copy.task.progress, 0);
  assert.equal(copy.task.parentTaskId, null);
  assert.equal(copy.task.creatorId, 'current-user');
  assert.equal(copy.childTasks.length, 1);
  const copiedChild = copy.childTasks[0];
  assert.equal(copiedChild.title, child.title);
  assert.equal(copiedChild.status, 'todo');
  assert.equal(copiedChild.progress, 0);
  assert.equal(copiedChild.id, undefined);
  assert.equal(copiedChild.version, undefined);
  assert.deepEqual(copiedChild.tags, child.tags);
  assert.equal(copiedChild.recurrence, 'weekly');
  assert.equal(copiedChild.reminderTime, child.reminderTime);
  for (const task of [copy.task, copiedChild]) {
    assert.equal(task.subtasks?.[0].completed, false);
    assert.notEqual(task.subtasks?.[0].id, parent.subtasks[0].id);
    assert.notEqual(task.attachments?.[0].id, 'image');
    assert.equal(task.attachments?.[0].dataUrl, parent.attachments![0].dataUrl);
    assert.ok(task.description.includes(`lanmind-attachment:${task.attachments![0].id}`));
    assert.ok(task.description.includes('- [ ] 检查'));
    assert.ok(task.description.includes('```md\n- [x] 示例\n```'));
  }
  assert.notEqual(copy.task.attachments![0].id, copiedChild.attachments![0].id);
  assert.deepEqual(tasks, original);
});

test('copying a child creates an independent task and migrates legacy checklist content', () => {
  const child = { ...parent, id: 'child', parentTaskId: 'parent', description: '旧版说明', attachments: [] };
  const copy = buildTaskDuplicate(child, [parent, child], 'current-user');
  assert.equal(copy.task.parentTaskId, null);
  assert.equal(copy.childTasks.length, 0);
  assert.equal(copy.task.description, '旧版说明\n\n- [ ] 检查');
});
