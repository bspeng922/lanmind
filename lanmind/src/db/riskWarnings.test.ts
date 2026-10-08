import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Task } from '../types';

test('risk warnings exclude terminal tasks and update when active tasks are abandoned or restored', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-08T08:00:00Z') });
  const originalDirectory = process.cwd();
  const temporaryRoot = realpathSync(tmpdir());
  const testDirectory = mkdtempSync(join(temporaryRoot, 'lanmind-risk-'));
  assert.equal(dirname(testDirectory), temporaryRoot);
  process.chdir(testDirectory);
  try {
    const { SQLiteStore } = await import('./sqlite-store');
    const store = new SQLiteStore();
    const operator = 'risk-user@test';
    const create = (status: Task['status'], dueDate: string | null, priority: Task['priority'] = 'P2') => store.createTask({
      title: `risk-${status}-${dueDate}`, description: '', status, priority, dueDate,
      creatorId: operator, assigneeId: operator, projectId: null, isShared: false, sharedWith: [],
    }, operator);
    for (const status of ['completed', 'abandoned'] as const) {
      for (const dueDate of ['2026-10-01T08:00:00Z', '2026-10-08T20:00:00Z']) {
        create(status, dueDate, 'P1');
      }
    }
    assert.deepEqual(store.getRiskWarnings(), []);
    assert.equal(store.getTasks().length, 4);

    const overdueIds: string[] = [];
    const imminentIds: string[] = [];
    for (const status of ['todo', 'in_progress', 'blocked'] as const) {
      overdueIds.push(create(status, '2026-10-01T08:00:00Z').id);
      imminentIds.push(create(status, '2026-10-08T20:00:00Z').id);
    }
    const blocked = create('blocked', null, 'P1');
    const warnings = store.getRiskWarnings();
    assert.equal(warnings.length, 3);
    for (const [type, expected] of [
      ['overdue', overdueIds], ['imminent', imminentIds], ['unassigned_p1', [blocked.id]],
    ] as const) {
      assert.deepEqual([...warnings.find((warning) => warning.type === type)!.relatedTaskIds].sort(), [...expected].sort());
    }

    const taskId = overdueIds[0];
    store.updateTask(taskId, { status: 'abandoned' }, operator);
    assert.ok(store.getRiskWarnings().every((warning) => !warning.relatedTaskIds.includes(taskId)));
    store.updateTask(taskId, { status: 'todo' }, operator);
    assert.ok(store.getRiskWarnings().some((warning) => warning.relatedTaskIds.includes(taskId)));
  } finally {
    process.chdir(originalDirectory);
    rmSync(testDirectory, { recursive: true, force: true });
  }
});
