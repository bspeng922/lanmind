import assert from 'node:assert/strict';
import test from 'node:test';
import { getTaskTagUsage } from './taskTags';

test('counts each tag once per task and ignores blank values', () => {
  const result = getTaskTagUsage([
    { tags: ['产品', '产品', ' 设计'] },
    { tags: ['产品', '', ' 设计 '] },
    { tags: ['研发'] },
  ]);

  assert.deepEqual(result, [
    { tag: '产品', count: 2 },
    { tag: '设计', count: 2 },
    { tag: '研发', count: 1 },
  ]);
});

test('keeps first-seen order when tags have the same usage count', () => {
  assert.deepEqual(
    getTaskTagUsage([{ tags: ['后续', '当前'] }, { tags: ['当前', '后续'] }]),
    [
      { tag: '后续', count: 2 },
      { tag: '当前', count: 2 },
    ],
  );
});
