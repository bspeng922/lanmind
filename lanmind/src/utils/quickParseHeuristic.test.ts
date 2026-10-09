import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicParseTask } from './quickParseHeuristic';
import { i18n } from '../i18n/core';

const friday = new Date(2026, 9, 9, 10, 0);
const parse = (input: string) => heuristicParseTask(input, [], [], friday);
after(() => { void i18n.changeLanguage('zh-CN'); });

test('English relative dates, priorities and 12-hour time work offline', () => {
  const result = parse('Urgent review draft tomorrow at 3:30 PM');
  assert.equal(result.title, 'review draft');
  assert.equal(result.priority, 'P1');
  assert.equal(result.dueDate, '2026-10-10T15:30');
  assert.equal(parse('Call today 12 am').dueDate, '2026-10-09T00:00');
  assert.equal(parse('Call day after tomorrow at 12 pm').dueDate, '2026-10-11T12:00');
  assert.equal(parse('Review next Monday at 09:15').dueDate, '2026-10-12T09:15');
});

test('recurrence includes the first date and works in both input languages', () => {
  const weekly = parse('Standup every Monday at 9 am');
  assert.equal(weekly.title, 'Standup');
  assert.equal(weekly.dueDate, '2026-10-12T09:00');
  assert.deepEqual(weekly.recurrenceRule, { interval: 1, daysOfWeek: [1], timeOfDay: '09:00' });
  assert.equal(parse('Backup every 2 days').recurrenceRule?.interval, 2);
  assert.deepEqual(parse('Standup every weekday').recurrenceRule?.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.equal(parse('每周一上午9点开会').dueDate, '2026-10-12T09:00');
});

test('Chinese input remains supported in an English interface', async () => {
  await i18n.changeLanguage('en-US');
  const result = parse('明天下午3点半提交报告 P2');
  assert.equal(result.title, '提交报告');
  assert.equal(result.dueDate, '2026-10-10T15:30');
  assert.equal(result.priority, 'P2');
  assert.equal(parse('大后天提交报告').dueDate, '2026-10-12');
  assert.equal(parse('Review report 2 at 15:30').dueDate, '2026-10-09T15:30');
});

test('invalid times do not silently roll over to another day', () => {
  for (const input of ['Review at 25:70', 'Review at 29:30', 'Review at 13 pm', 'Review 125:30']) {
    assert.equal(parse(input).dueDate, null, input);
    assert.equal(parse(input).title, input, input);
  }
  assert.equal(parse('This is a document').dueDate, null);
});
