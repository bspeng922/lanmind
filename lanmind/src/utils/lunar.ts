/**
 * lunar.ts — Pure Utility Functions for Chinese Lunar Calendar & Solar Terms
 *
 * CALLING SPEC:
 *   import { getLunarDateInfo, formatHeaderDateWithLunar } from './lunar';
 *
 *   const info = getLunarDateInfo('2025-06-21');
 *   // info.label -> '夏至'
 *   // info.isSolarTerm -> true
 *   // info.fullText -> '农历五月廿六'
 *
 *   const header = formatHeaderDateWithLunar(new Date(2025, 5, 29));
 *   // header.fullTitle -> '2025年6月29日 星期日 农历六月初五'
 *
 * TOOL CONTRACT:
 *   Input:  Date instance or 'YYYY-MM-DD' date string
 *   Output: Structured LunarDateInfo object
 *   Side effects: None
 *   Deterministic: Same date input always produces identical LunarDateInfo
 */

import { Solar } from 'lunar-typescript';

export interface LunarDateInfo {
  year: number;
  month: number;
  day: number;
  lunarYearGanZhi: string;
  lunarMonthName: string;
  lunarDayName: string;
  solarTerm?: string;
  festival?: string;
  label: string;
  fullText: string;
  isSolarTerm: boolean;
  isFestival: boolean;
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function parseInputDate(input: Date | string): { year: number; month: number; day: number; dateObj: Date } {
  if (typeof input === 'string') {
    const parts = input.slice(0, 10).split('-');
    if (parts.length === 3) {
      const year = Number.parseInt(parts[0], 10);
      const month = Number.parseInt(parts[1], 10);
      const day = Number.parseInt(parts[2], 10);
      return { year, month, day, dateObj: new Date(year, month - 1, day) };
    }
  }
  const dateObj = input instanceof Date ? input : new Date(input);
  return {
    year: dateObj.getFullYear(),
    month: dateObj.getMonth() + 1,
    day: dateObj.getDate(),
    dateObj,
  };
}

export function getLunarDateInfo(input: Date | string): LunarDateInfo {
  const { year, month, day } = parseInputDate(input);
  const solar = Solar.fromYmd(year, month, day);
  const lunar = solar.getLunar();

  const lunarYearGanZhi = lunar.getYearInGanZhi();
  const lunarMonthName = `${lunar.getMonthInChinese()}月`;
  const lunarDayName = lunar.getDayInChinese();

  const jieQi = lunar.getJieQi();
  const solarTerm = jieQi && jieQi.trim().length > 0 ? jieQi.trim() : undefined;

  const lunarFestivals = lunar.getFestivals();
  const solarFestivals = solar.getFestivals();
  const festival =
    (lunarFestivals && lunarFestivals[0]) ||
    (solarFestivals && solarFestivals[0]) ||
    undefined;

  let label: string;
  let isSolarTerm = false;
  let isFestival = false;

  if (festival) {
    label = festival;
    isFestival = true;
  } else if (solarTerm) {
    label = solarTerm;
    isSolarTerm = true;
  } else if (lunarDayName === '初一') {
    label = lunarMonthName;
  } else {
    label = lunarDayName;
  }

  const festivalOrTerm = festival || solarTerm;
  const fullText = festivalOrTerm
    ? `农历${lunarMonthName}${lunarDayName} · ${festivalOrTerm}`
    : `农历${lunarMonthName}${lunarDayName}`;

  return {
    year,
    month,
    day,
    lunarYearGanZhi,
    lunarMonthName,
    lunarDayName,
    solarTerm,
    festival,
    label,
    fullText,
    isSolarTerm,
    isFestival,
  };
}

export function formatHeaderDateWithLunar(input: Date | string): {
  solarDateText: string;
  weekdayText: string;
  lunarText: string;
  fullTitle: string;
} {
  const { year, month, day, dateObj } = parseInputDate(input);
  const lunar = getLunarDateInfo(dateObj);
  const weekdayText = WEEKDAYS[dateObj.getDay()] || '';
  const solarDateText = `${year}年${month}月${day}日`;
  const lunarText = lunar.fullText;
  const fullTitle = `${solarDateText} ${weekdayText} ${lunarText}`;

  return {
    solarDateText,
    weekdayText,
    lunarText,
    fullTitle,
  };
}
