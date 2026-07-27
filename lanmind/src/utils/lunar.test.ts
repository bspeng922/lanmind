import test from 'node:test';
import assert from 'node:assert/strict';
import { getLunarDateInfo, formatHeaderDateWithLunar } from './lunar';

test('getLunarDateInfo correctly calculates solar terms like 夏至', () => {
  const info = getLunarDateInfo('2025-06-21');
  assert.equal(info.solarTerm, '夏至');
  assert.equal(info.label, '夏至');
  assert.equal(info.isSolarTerm, true);
});

test('getLunarDateInfo correctly calculates solar term 小暑', () => {
  const info = getLunarDateInfo('2025-07-07');
  assert.equal(info.solarTerm, '小暑');
  assert.equal(info.label, '小暑');
  assert.equal(info.isSolarTerm, true);
});

test('getLunarDateInfo correctly identifies festivals like 建党节', () => {
  const info = getLunarDateInfo('2025-07-01');
  assert.equal(info.festival, '建党节');
  assert.equal(info.label, '建党节');
  assert.equal(info.isFestival, true);
});

test('getLunarDateInfo formats full lunar text matching screenshot', () => {
  // Screenshot shows: 2025年6月29日 星期日 农历六月初五
  const info = getLunarDateInfo('2025-06-29');
  assert.equal(info.fullText, '农历六月初五');
  assert.equal(info.label, '初五');

  const header = formatHeaderDateWithLunar('2025-06-29');
  assert.equal(header.fullTitle, '2025年6月29日 星期日 农历六月初五');
});
