import test from 'node:test';
import assert from 'node:assert/strict';
import {
  minutesToPx,
  pxToMinutes,
  snap,
  clamp,
  parseTimeMinutes,
  formatMinutesToTime,
  layoutDay,
  extractTaskTimeRange,
  HOUR_HEIGHT,
} from './calendarLayout';
import { Task } from '../types';

test('calendarLayout — coordinate conversion & math helpers', () => {
  assert.equal(minutesToPx(60), HOUR_HEIGHT);
  assert.equal(minutesToPx(30), HOUR_HEIGHT / 2);
  assert.equal(pxToMinutes(HOUR_HEIGHT), 60);

  assert.equal(snap(14), 15);
  assert.equal(snap(7), 0);
  assert.equal(snap(23), 30);

  assert.equal(clamp(-5, 0, 100), 0);
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(50, 0, 100), 50);

  assert.equal(parseTimeMinutes('09:30'), 570);
  assert.equal(parseTimeMinutes('00:00'), 0);
  assert.equal(parseTimeMinutes('23:59'), 1439);
  assert.equal(parseTimeMinutes('invalid'), null);

  assert.equal(formatMinutesToTime(570), '09:30');
  assert.equal(formatMinutesToTime(0), '00:00');
  assert.equal(formatMinutesToTime(1439), '23:59');
});

test('calendarLayout — extractTaskTimeRange', () => {
  const allDayTask: Pick<Task, 'startDate' | 'dueDate'> = {
    dueDate: '2026-10-29',
  };
  const range1 = extractTaskTimeRange(allDayTask);
  assert.equal(range1.isAllDay, true);

  const timedTask: Pick<Task, 'startDate' | 'dueDate'> = {
    startDate: '2026-10-29T10:00',
    dueDate: '2026-10-29T11:30',
  };
  const range2 = extractTaskTimeRange(timedTask);
  assert.equal(range2.isAllDay, false);
  assert.equal(range2.startMinutes, 600);
  assert.equal(range2.endMinutes, 690);

  const dueOnlyTask: Pick<Task, 'startDate' | 'dueDate'> = {
    dueDate: '2026-10-29T15:00',
  };
  const range3 = extractTaskTimeRange(dueOnlyTask, 60);
  assert.equal(range3.isAllDay, false);
  assert.equal(range3.startMinutes, 840); // 15:00 - 60 min = 14:00
  assert.equal(range3.endMinutes, 900); // 15:00
});

test('calendarLayout — layoutDay empty and non-overlapping cases', () => {
  assert.deepEqual(layoutDay([]), []);

  const single = [{ id: 'a', startMinutes: 60, endMinutes: 120 }];
  const res1 = layoutDay(single);
  assert.equal(res1.length, 1);
  assert.equal(res1[0].column, 0);
  assert.equal(res1[0].columns, 1);

  const nonOverlapping = [
    { id: 'a', startMinutes: 60, endMinutes: 120 },
    { id: 'b', startMinutes: 120, endMinutes: 180 },
    { id: 'c', startMinutes: 200, endMinutes: 240 },
  ];
  const res2 = layoutDay(nonOverlapping);
  assert.equal(res2.length, 3);
  assert.equal(res2[0].column, 0);
  assert.equal(res2[0].columns, 1);
  assert.equal(res2[1].column, 0);
  assert.equal(res2[1].columns, 1);
  assert.equal(res2[2].column, 0);
  assert.equal(res2[2].columns, 1);
});

test('calendarLayout — layoutDay two concurrent overlapping items', () => {
  const overlapping = [
    { id: 'a', startMinutes: 60, endMinutes: 180 },
    { id: 'b', startMinutes: 90, endMinutes: 150 },
  ];
  const res = layoutDay(overlapping);
  assert.equal(res.length, 2);
  assert.equal(res[0].column, 0);
  assert.equal(res[0].columns, 2);
  assert.equal(res[1].column, 1);
  assert.equal(res[1].columns, 2);
});

test('calendarLayout — layoutDay transitive overlap cluster with column reuse', () => {
  // A: 10:00 - 12:00 (col 0)
  // B: 10:30 - 11:30 (col 1)
  // C: 11:30 - 12:30 (starts when B ends, so can reuse col 1! Total cols = 2)
  const items = [
    { id: 'A', startMinutes: 600, endMinutes: 720 },
    { id: 'B', startMinutes: 630, endMinutes: 690 },
    { id: 'C', startMinutes: 690, endMinutes: 750 },
  ];
  const res = layoutDay(items);
  assert.equal(res.length, 3);

  const itemA = res.find((r) => r.item.id === 'A')!;
  const itemB = res.find((r) => r.item.id === 'B')!;
  const itemC = res.find((r) => r.item.id === 'C')!;

  assert.equal(itemA.column, 0);
  assert.equal(itemB.column, 1);
  assert.equal(itemC.column, 1); // reuses col 1!

  assert.equal(itemA.columns, 2);
  assert.equal(itemB.columns, 2);
  assert.equal(itemC.columns, 2);
});
