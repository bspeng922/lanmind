import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DESKTOP_CALENDAR_DEFAULT_CUSTOM_COLOR,
  DESKTOP_CALENDAR_DEFAULT_OPACITY,
  DESKTOP_CALENDAR_MAX_OPACITY,
  DESKTOP_CALENDAR_MIN_OPACITY,
  DESKTOP_CALENDAR_MIN_HEIGHT,
  DESKTOP_CALENDAR_MIN_WIDTH,
  hexToRgb,
  isLightColor,
  isValidDesktopCalendarSize,
  normalizeDesktopCalendarCustomColor,
  normalizeDesktopCalendarOpacity,
  normalizeDesktopCalendarThemeTone,
  sortDesktopCalendarOccurrences,
} from './desktopCalendar';


test('normalizes desktop calendar opacity to integer bounds', () => {
  assert.equal(normalizeDesktopCalendarOpacity(24.6), 25);
  assert.equal(normalizeDesktopCalendarOpacity(DESKTOP_CALENDAR_MIN_OPACITY - 1), DESKTOP_CALENDAR_MIN_OPACITY);
  assert.equal(normalizeDesktopCalendarOpacity(DESKTOP_CALENDAR_MAX_OPACITY + 1), DESKTOP_CALENDAR_MAX_OPACITY);
});

test('supports a fully transparent pinned calendar', () => {
  assert.equal(normalizeDesktopCalendarOpacity(0), 0);
});

test('uses the configured default for invalid opacity values', () => {
  assert.equal(normalizeDesktopCalendarOpacity(undefined), DESKTOP_CALENDAR_DEFAULT_OPACITY);
  assert.equal(normalizeDesktopCalendarOpacity('not-a-number'), DESKTOP_CALENDAR_DEFAULT_OPACITY);
});

test('rejects transient hidden-window sizes for desktop calendar persistence', () => {
  assert.equal(isValidDesktopCalendarSize(1, 1), false);
  assert.equal(isValidDesktopCalendarSize(DESKTOP_CALENDAR_MIN_WIDTH - 1, DESKTOP_CALENDAR_MIN_HEIGHT), false);
  assert.equal(isValidDesktopCalendarSize(DESKTOP_CALENDAR_MIN_WIDTH, DESKTOP_CALENDAR_MIN_HEIGHT), true);
});

test('sorts unfinished desktop calendar tasks before completed tasks', () => {
  const occurrences = [
    { task: { status: 'completed', priority: 'P1' }, id: 'done' },
    { task: { status: 'todo', priority: 'P3' }, id: 'normal' },
    { task: { status: 'blocked', priority: 'P1' }, id: 'urgent' },
  ];

  assert.deepEqual(
    sortDesktopCalendarOccurrences(occurrences).map((item) => item.id),
    ['urgent', 'normal', 'done'],
  );
  assert.deepEqual(
    sortDesktopCalendarOccurrences(occurrences, false).map((item) => item.id),
    ['urgent', 'normal'],
  );
});

test('normalizes desktop calendar theme tone to valid values or fallback', () => {
  assert.equal(normalizeDesktopCalendarThemeTone('custom'), 'custom');
  assert.equal(normalizeDesktopCalendarThemeTone('dark'), 'custom'); // migrated to custom
  assert.equal(normalizeDesktopCalendarThemeTone('system'), 'system');
  assert.equal(normalizeDesktopCalendarThemeTone('light'), 'system');
  assert.equal(normalizeDesktopCalendarThemeTone('invalid'), 'system');
  assert.equal(normalizeDesktopCalendarThemeTone(null), 'system');
  assert.equal(normalizeDesktopCalendarThemeTone(undefined), 'system');
});

test('normalizes desktop calendar custom color and checks luminance', () => {
  assert.equal(normalizeDesktopCalendarCustomColor('#0f172a'), '#0f172a');
  assert.equal(normalizeDesktopCalendarCustomColor('#fff'), '#ffffff');
  assert.equal(normalizeDesktopCalendarCustomColor('#1E293B'), '#1e293b');
  assert.equal(normalizeDesktopCalendarCustomColor('invalid'), DESKTOP_CALENDAR_DEFAULT_CUSTOM_COLOR);
  assert.equal(normalizeDesktopCalendarCustomColor(null), DESKTOP_CALENDAR_DEFAULT_CUSTOM_COLOR);

  assert.deepEqual(hexToRgb('#0f172a'), { r: 15, g: 23, b: 42 });
  assert.deepEqual(hexToRgb('#ffffff'), { r: 255, g: 255, b: 255 });

  assert.equal(isLightColor('#ffffff'), true);
  assert.equal(isLightColor('#f8fafc'), true);
  assert.equal(isLightColor('#0f172a'), false);
  assert.equal(isLightColor('#000000'), false);
});

