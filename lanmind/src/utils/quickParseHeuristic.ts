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
  users: User[] = []
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
      tags: ['快捷录入'],
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
  const tags: string[] = ['快捷录入'];

  // 1. Priority Extraction (P1, P2, P3, P4 or keywords)
  if (/\b[pP]1\b|紧急|加急|特急/.test(title)) {
    priority = 'P1';
    title = title.replace(/\b[pP]1\b|紧急|加急|特急/g, '');
  } else if (/\b[pP]2\b|重要|优先/.test(title)) {
    priority = 'P2';
    title = title.replace(/\b[pP]2\b|重要|优先/g, '');
  } else if (/\b[pP]4\b|低优|暂缓|备忘/.test(title)) {
    priority = 'P4';
    title = title.replace(/\b[pP]4\b|低优|暂缓|备忘/g, '');
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
  const now = new Date();
  const targetDate = new Date();
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
  } else if (/后天/.test(title)) {
    hasDate = true;
    targetDate.setDate(now.getDate() + 2);
    title = title.replace(/后天/g, '');
  } else if (/大后天/.test(title)) {
    hasDate = true;
    targetDate.setDate(now.getDate() + 3);
    title = title.replace(/大后天/g, '');
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

  // Time extraction: e.g. 上午9点, 下午3点, 晚上8点, 15:30, 9点半
  const timeMatch = title.match(/(上午|中午|下午|晚上)?\s*(\d{1,2})(?:点|:|：)?(\d{1,2}|半)?(?:分)?/);
  if (timeMatch && (timeMatch[1] || timeMatch[0].includes('点') || timeMatch[0].includes(':'))) {
    hasTime = true;
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
    targetHour = hour;
    targetMinute = minute;
    title = title.replace(timeMatch[0], '');
  }

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
