import { tr } from '../i18n/core';
/**
 * quickParseHeuristic — Heuristic Natural Language Rule-Based Fallback Parser
 *
 * CALLING SPEC:
 *   const result: QuickParseResult = heuristicParseTask(input, projects, users);
 *
 * TOOL CONTRACT:
 *   Input:  Raw text input, available projects array, available users array.
 *   Output: QuickParseResult object with extracted title, dueDate, priority, etc.
 *   Side effects: None.
 *   Deterministic: Same inputs -> Same output.
 */

import { Priority, Project, QuickParseResult, RecurrenceRule, RecurrenceType, User } from '../types';
import { formatLocalTaskDateTime } from './taskDateTime';

export function heuristicParseTask(
  rawInput: string,
  projects: Project[] = [],
  users: User[] = [],
  referenceDate: Date = new Date()
): QuickParseResult {
  const text = rawInput.trim();
  if (!text) {
    return {
      title: '',
      dueDate: null,
      reminderTime: null,
      priority: 'P3',
      projectName: null,
      assigneeName: null,
      recurrence: 'none',
      recurrenceRule: null,
      tags: [tr('common:labels.quickCapture')],
    };
  }

  let title = text;
  let priority: Priority = 'P3';
  let dueDate: string | null = null;
  let reminderTime: string | null = null;
  let projectName: string | null = null;
  let assigneeName: string | null = null;
  let recurrence: RecurrenceType = 'none';
  let recurrenceRule: RecurrenceRule | null = null;
  const tags: string[] = [tr('common:labels.quickCapture')];

  // 1. Priority Extraction (P1, P2, P3, P4 or keywords)
  if (/\bp1\b|\burgent\b|紧急|加急|特急/i.test(title)) {
    priority = 'P1';
    title = title.replace(/!?\bp1\b|\burgent\b|紧急|加急|特急/gi, '');
  } else if (/\bp2\b|\bhigh priority\b|\bimportant\b|重要|优先/i.test(title)) {
    priority = 'P2';
    title = title.replace(/!?\bp2\b|\bhigh priority\b|\bimportant\b|重要|优先/gi, '');
  } else if (/\bp4\b|\blow priority\b|低优|暂缓|备忘/i.test(title)) {
    priority = 'P4';
    title = title.replace(/!?\bp4\b|\blow priority\b|低优|暂缓|备忘/gi, '');
  } else if (/\b[pP]3\b|普通/.test(title)) {
    priority = 'P3';
    title = title.replace(/\b[pP]3\b|普通/g, '');
  }

  // 2. Project Extraction
  for (const p of projects) {
    if (p.name && title.includes(p.name)) {
      projectName = p.name;
      title = title.replace(p.name, '');
      break;
    }
  }

  // 3. Assignee Extraction
  for (const u of users) {
    if (u.nickname && title.includes(u.nickname)) {
      assigneeName = u.nickname;
      title = title.replace(u.nickname, '');
      break;
    }
  }

  // 4. Recurrence Extraction
  if (/每周([一二三四五六日天])/.test(title)) {
    const match = title.match(/每周([一二三四五六日天])/);
    if (match) {
      recurrence = 'weekly';
      const weekdayMap: Record<string, 1 | 2 | 3 | 4 | 5 | 6 | 7> = {
        一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
      };
      const weekday = weekdayMap[match[1]] || 1;
      recurrenceRule = { interval: 1, daysOfWeek: [weekday] };
      title = title.replace(match[0], '');
    }
  } else if (/工作日|每个工作日/.test(title)) {
    recurrence = 'weekly';
    recurrenceRule = { interval: 1, daysOfWeek: [1, 2, 3, 4, 5] };
    title = title.replace(/每个工作日|工作日/g, '');
  } else if (/每天|每日/.test(title)) {
    recurrence = 'daily';
    recurrenceRule = { interval: 1 };
    title = title.replace(/每天|每日/g, '');
  } else if (/每月/.test(title)) {
    recurrence = 'monthly';
    recurrenceRule = { interval: 1 };
    title = title.replace(/每月/g, '');
  }

  // 5. Date & Time Heuristic
  const now = new Date(referenceDate);
  const targetDate = new Date(referenceDate);
  let hasDate = false;
  let hasTime = false;
  let targetHour = 18;
  let targetMinute = 0;

  if (/今天/.test(title)) {
    hasDate = true;
    title = title.replace(/今天/g, '');
  } else if (/明天/.test(title)) {
    hasDate = true;
    targetDate.setDate(now.getDate() + 1);
    title = title.replace(/明天/g, '');
  } else if (/大后天/.test(title)) {
    hasDate = true;
    targetDate.setDate(now.getDate() + 3);
    title = title.replace(/大后天/g, '');
  } else if (/后天/.test(title)) {
    hasDate = true;
    targetDate.setDate(now.getDate() + 2);
    title = title.replace(/后天/g, '');
  } else if (/下周([一二三四五六日天])/.test(title)) {
    const match = title.match(/下周([一二三四五六日天])/);
    if (match) {
      hasDate = true;
      const weekdayMap: Record<string, number> = {
        一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
      };
      const targetWd = weekdayMap[match[1]] || 1;
      const currentWd = now.getDay() === 0 ? 7 : now.getDay();
      targetDate.setDate(now.getDate() + (7 - currentWd + targetWd));
      title = title.replace(match[0], '');
    }
  }

  // English input is supported independently of the selected interface language.
  const weekdayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const repeating = title.match(/\bevery\s+(?:(\d+)\s+)?(weekdays?|days?|weeks?|months?|years?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (repeating) {
    const unit = repeating[2].toLowerCase();
    const interval = Math.min(999, Math.max(1, Number(repeating[1] || 1)));
    const weekday = weekdayNames.indexOf(unit);
    recurrence = weekday >= 0 || unit.startsWith('week') ? 'weekly' : unit.startsWith('month') ? 'monthly' : unit.startsWith('year') ? 'yearly' : 'daily';
    recurrenceRule = { interval, ...(weekday >= 0 ? { daysOfWeek: [weekday + 1] as RecurrenceRule['daysOfWeek'] } : unit.startsWith('weekday') ? { daysOfWeek: [1, 2, 3, 4, 5] as RecurrenceRule['daysOfWeek'] } : {}) };
    title = title.replace(repeating[0], '');
  }
  const relative = title.match(/\b(day after tomorrow|tomorrow|today)\b/i);
  if (relative) {
    hasDate = true;
    targetDate.setDate(now.getDate() + ({ 'day after tomorrow': 2, tomorrow: 1, today: 0 }[relative[1].toLowerCase()] || 0));
    title = title.replace(relative[0], '');
  }
  const weekday = title.match(/\b(?:(next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekday) {
    const desired = weekdayNames.indexOf(weekday[2].toLowerCase()) + 1;
    const current = now.getDay() || 7;
    const offset = weekday[1]?.toLowerCase() === 'next' ? 7 - current + desired : (desired - current + 7) % 7;
    targetDate.setDate(now.getDate() + offset); hasDate = true;
    title = title.replace(weekday[0], '');
  }
  const englishTime = title.match(/\b(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b|\bat\s+(\d{1,2}):([0-5]\d)\b/i);
  if (englishTime) {
    const hour = Number(englishTime[1] || englishTime[4]);
    if (englishTime[3] ? hour >= 1 && hour <= 12 : hour <= 23) {
      targetHour = englishTime[3] ? hour % 12 + (englishTime[3].toLowerCase() === 'pm' ? 12 : 0) : hour;
      targetMinute = Number(englishTime[2] || englishTime[5] || 0);
      hasTime = true; title = title.replace(englishTime[0], '');
      if (recurrenceRule) recurrenceRule.timeOfDay = `${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')}`;
    }
  }

  // Time extraction: e.g. 上午9点, 下午3点, 晚上8点, 15:30, 9点半
  const timeMatch = title.match(/(?<![\d:：])(上午|中午|下午|晚上)?\s*(\d{1,2})(?:点|:|：)(\d{1,2}|半)?(?:分)?(?![\d:：])/);
  if (!hasTime && timeMatch && (timeMatch[1] || timeMatch[0].includes('点') || timeMatch[0].includes(':'))) {
    const period = timeMatch[1] || '';
    let hour = parseInt(timeMatch[2], 10);
    let minute = 0;
    if (timeMatch[3] === '半') minute = 30;
    else if (timeMatch[3]) minute = parseInt(timeMatch[3], 10);

    if (period === '下午' || period === '晚上') {
      if (hour < 12) hour += 12;
    } else if (period === '上午' && hour === 12) {
      hour = 0;
    }
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      hasTime = true;
      targetHour = hour;
      targetMinute = minute;
      title = title.replace(timeMatch[0], '');
    }
  }

  if (!hasDate && recurrenceRule) {
    hasDate = true;
    const days = recurrenceRule.daysOfWeek;
    if (days?.length) {
      const current = now.getDay() || 7;
      targetDate.setDate(now.getDate() + Math.min(...days.map((day) => (day - current + 7) % 7)));
    }
  }
  if (hasTime && recurrenceRule) recurrenceRule.timeOfDay = `${String(targetHour).padStart(2, '0')}:${String(targetMinute).padStart(2, '0')}`;

  if (hasDate || hasTime) {
    targetDate.setHours(targetHour, targetMinute, 0, 0);
    const formatted = formatLocalTaskDateTime(targetDate, hasTime);
    dueDate = formatted;
    if (hasTime) reminderTime = formatted;
  }

  // Clean title
  title = title
    .replace(/[，,。！？!；;（）()【】[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title) {
    title = text;
  }

  return {
    title,
    dueDate,
    reminderTime,
    priority,
    projectName,
    assigneeName,
    recurrence,
    recurrenceRule,
    tags,
  };
}
