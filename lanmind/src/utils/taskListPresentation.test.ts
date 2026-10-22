import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTaskListDate, isTaskOverdue, taskDescriptionPreview } from './taskListPresentation';

test('list dates retain saved times and distinguish dates in other years', () => {
  const now = new Date(2026, 9, 21);
  assert.equal(formatTaskListDate('2026-10-21T18:00', now), '10/21 18:00');
  assert.equal(formatTaskListDate('2026-10-21', now), '10/21');
  assert.equal(formatTaskListDate('2027-01-03T09:05', now), '2027/01/03 09:05');
  assert.equal(formatTaskListDate('2025-12-31', now), '2025/12/31');
  assert.equal(formatTaskListDate(null, now), '');
  assert.equal(formatTaskListDate('invalid', now), '');
});

test('all-day due dates expire at the following local midnight', () => {
  assert.equal(isTaskOverdue('2026-10-21', new Date(2026, 9, 21, 23, 59)), false);
  assert.equal(isTaskOverdue('2026-10-21', new Date(2026, 9, 22, 0, 0)), true);
  assert.equal(isTaskOverdue('2026-10-21T18:00', new Date(2026, 9, 21, 18, 1)), true);
  assert.equal(isTaskOverdue('2026-10-21T18:00', new Date(2026, 9, 21, 17, 59)), false);
  assert.equal(isTaskOverdue(null), false);
  assert.equal(isTaskOverdue('invalid'), false);
});

test('description previews retain prose and link labels without repeating checklist contents or URLs', () => {
  const preview = taskDescriptionPreview('# Release **check**\n\nRead the [guide](https://example.com/a).\n\n- [ ] Install\n- [x] Upgrade\n\n![Screenshot](data:image/png;base64,abc)\n\n`v2` is ready.');
  assert.match(preview, /Release check/);
  assert.match(preview, /Read the guide/);
  assert.match(preview, /v2 is ready/);
  assert.doesNotMatch(preview, /Install|Upgrade|https:|base64|Screenshot|\*\*/);
  assert.equal(taskDescriptionPreview('- [ ] One\n- [x] Two'), '');
  assert.equal(taskDescriptionPreview(''), '');
  assert.equal(taskDescriptionPreview('核对**安装**与[升级说明](https://example.com)。'), '核对安装与升级说明。');
});
