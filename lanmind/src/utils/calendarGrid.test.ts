import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateCalendarGrid,
  getWeekdayHeaders,
  formatYMD,
} from './calendarGrid';

test('generates exactly 42 cells for any given month', () => {
  const gridMon = generateCalendarGrid(2026, 8, 'monday'); // Month 8 is September
  assert.equal(gridMon.length, 42);

  const gridSun = generateCalendarGrid(2026, 8, 'sunday');
  assert.equal(gridSun.length, 42);

  // February in a non-leap year (e.g., 2027)
  const gridFeb = generateCalendarGrid(2027, 1, 'monday');
  assert.equal(gridFeb.length, 42);
});

test('aligns correctly with Monday as first day of week for September 2026', () => {
  // 2026-09-01 is Tuesday
  const grid = generateCalendarGrid(2026, 8, 'monday');

  // Leading day: Monday 2026-08-31
  assert.equal(grid[0].dateStr, '2026-08-31');
  assert.equal(grid[0].dayNum, 31);
  assert.equal(grid[0].isCurrentMonth, false);

  // First day of current month: Tuesday 2026-09-01
  assert.equal(grid[1].dateStr, '2026-09-01');
  assert.equal(grid[1].dayNum, 1);
  assert.equal(grid[1].isCurrentMonth, true);

  // Last day of September: 2026-09-30 (Wednesday)
  // 1 leading day + 30 days = 31 days total. Index 30 is 2026-09-30.
  assert.equal(grid[30].dateStr, '2026-09-30');
  assert.equal(grid[30].dayNum, 30);
  assert.equal(grid[30].isCurrentMonth, true);

  // Trailing day: 2026-10-01 (Thursday)
  assert.equal(grid[31].dateStr, '2026-10-01');
  assert.equal(grid[31].dayNum, 1);
  assert.equal(grid[31].isCurrentMonth, false);

  // Last cell (index 41): 42 - 31 = 11 trailing days -> 2026-10-11
  assert.equal(grid[41].dateStr, '2026-10-11');
  assert.equal(grid[41].dayNum, 11);
  assert.equal(grid[41].isCurrentMonth, false);
});

test('aligns correctly with Sunday as first day of week for September 2026', () => {
  // 2026-09-01 is Tuesday
  const grid = generateCalendarGrid(2026, 8, 'sunday');

  // Leading days: Sunday 2026-08-30, Monday 2026-08-31
  assert.equal(grid[0].dateStr, '2026-08-30');
  assert.equal(grid[0].dayNum, 30);
  assert.equal(grid[0].isCurrentMonth, false);

  assert.equal(grid[1].dateStr, '2026-08-31');
  assert.equal(grid[1].dayNum, 31);
  assert.equal(grid[1].isCurrentMonth, false);

  // First day of current month: Tuesday 2026-09-01
  assert.equal(grid[2].dateStr, '2026-09-01');
  assert.equal(grid[2].dayNum, 1);
  assert.equal(grid[2].isCurrentMonth, true);

  // Last day of September: 2026-09-30
  // 2 leading days + 30 days = 32 days total. Index 31 is 2026-09-30.
  assert.equal(grid[31].dateStr, '2026-09-30');
  assert.equal(grid[31].dayNum, 30);
  assert.equal(grid[31].isCurrentMonth, true);

  // Trailing day: 2026-10-01
  assert.equal(grid[32].dateStr, '2026-10-01');
  assert.equal(grid[32].dayNum, 1);
  assert.equal(grid[32].isCurrentMonth, false);

  // Last cell (index 41): 2026-10-10
  assert.equal(grid[41].dateStr, '2026-10-10');
  assert.equal(grid[41].dayNum, 10);
  assert.equal(grid[41].isCurrentMonth, false);
});

test('returns appropriate weekday headers for all formats and weekStart settings', () => {
  const monBilingual = getWeekdayHeaders('monday', 'bilingual');
  assert.deepEqual(monBilingual, ['周一 Mon', '周二 Tue', '周三 Wed', '周四 Thu', '周五 Fri', '周六 Sat', '周日 Sun']);

  const sunBilingual = getWeekdayHeaders('sunday', 'bilingual');
  assert.deepEqual(sunBilingual, ['周日 Sun', '周一 Mon', '周二 Tue', '周三 Wed', '周四 Thu', '周五 Fri', '周六 Sat']);

  const monFull = getWeekdayHeaders('monday', 'full');
  assert.deepEqual(monFull, ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']);

  const sunFull = getWeekdayHeaders('sunday', 'full');
  assert.deepEqual(sunFull, ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']);

  const monShort = getWeekdayHeaders('monday', 'short');
  assert.deepEqual(monShort, ['一', '二', '三', '四', '五', '六', '日']);

  const sunShort = getWeekdayHeaders('sunday', 'short');
  assert.deepEqual(sunShort, ['日', '一', '二', '三', '四', '五', '六']);
});

test('formats Date instance to YYYY-MM-DD correctly', () => {
  const d = new Date(2026, 0, 5); // 2026-01-05
  assert.equal(formatYMD(d), '2026-01-05');
});
