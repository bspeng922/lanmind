/**
 * reportDateRange — Pure deterministic calculation and filtering tools for LLM Report Studio.
 *
 * CALLING SPEC:
 *   const { startDate, endDate } = getReportDateRange(type, referenceDate, periodPreset);
 *   const periodTasks = filterTasksForPeriod(tasks, {
 *     currentUserId: string,
 *     startDate: string,
 *     endDate: string,
 *     selectedProjectId?: string,
 *   });
 *   const stats = calculateTaskStats(tasks);
 *   const html = renderReportMarkdown(markdown);
 *   const prompt = reportPromptFor(type);
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  PPTTemplate,
  Priority,
  ReportSourceTask,
  ReportType,
  Task,
  TaskStatus,
} from '../types';

export type ReportPeriodPreset = 'current' | 'previous';

export interface FilterPeriodTasksOptions {
  currentUserId: string;
  startDate: string;
  endDate: string;
  selectedProjectId?: string;
}

export interface TaskPeriodStats {
  total: number;
  completed: number;
  inProgress: number;
  blocked: number;
  todo: number;
}

export const REPORT_TYPES: Array<{ id: ReportType; label: string }> = [
  { id: 'daily', label: '日报' },
  { id: 'weekly', label: '周报' },
  { id: 'monthly', label: '月报' },
  { id: 'quarterly', label: '季报' },
  { id: 'semi_annual', label: '半年报' },
  { id: 'annual', label: '年报' },
];

export const BUILTIN_PPT_TEMPLATES: PPTTemplate[] = [
  {
    id: 'tpl-executive',
    name: '经营汇报',
    description: '结论先行、数据支撑、风险与动作闭环。',
    theme: 'business',
    primaryColor: '#111827',
    secondaryColor: '#64748b',
    backgroundColor: '#ffffff',
    textColor: '#111827',
    cardBgColor: '#f8fafc',
    accentColor: '#ea580c',
    fontFamily: 'Microsoft YaHei',
    slidesLayout: [{ slideType: 'cover' }, { slideType: 'summary' }, { slideType: 'content' }, { slideType: 'roadmap' }],
  },
  {
    id: 'tpl-business',
    name: '商务蓝',
    description: '适合周报、月报和管理层汇报。',
    theme: 'business',
    primaryColor: '#1d4ed8',
    secondaryColor: '#334155',
    backgroundColor: '#f8fafc',
    textColor: '#0f172a',
    cardBgColor: '#ffffff',
    accentColor: '#0ea5e9',
    fontFamily: 'Aptos',
    slidesLayout: [{ slideType: 'cover' }, { slideType: 'summary' }, { slideType: 'content' }, { slideType: 'roadmap' }],
  },
  {
    id: 'tpl-tech',
    name: '科技青',
    description: '适合研发、产品和技术成果展示。',
    theme: 'tech',
    primaryColor: '#164e63',
    secondaryColor: '#0f766e',
    backgroundColor: '#f0fdfa',
    textColor: '#164e63',
    cardBgColor: '#ffffff',
    accentColor: '#14b8a6',
    fontFamily: 'Aptos',
    slidesLayout: [{ slideType: 'cover' }, { slideType: 'summary' }, { slideType: 'content' }, { slideType: 'roadmap' }],
  },
  {
    id: 'tpl-minimalist',
    name: '极简白',
    description: '高对比黑白排版，留白充足、适合快速阅读。',
    theme: 'minimalist',
    primaryColor: '#0f172a',
    secondaryColor: '#475569',
    backgroundColor: '#f8fafc',
    textColor: '#1e293b',
    cardBgColor: '#ffffff',
    accentColor: '#2563eb',
    fontFamily: 'Arial',
    slidesLayout: [{ slideType: 'cover' }, { slideType: 'summary' }, { slideType: 'content' }, { slideType: 'roadmap' }],
  },
];

export const REPORT_PROMPT_GUIDANCE: Record<ReportType, string> = {
  daily: '围绕今日最重要的 3—5 件工作生成日报。先给一句结论，再写完成、进行中、阻塞和明日动作。每项工作都写清行动、结果、影响；没有证据的效果不要补写。整体控制在 300—500 字。',
  weekly: '围绕本周最重要的结果生成周报。按成果、关键进展、问题与风险、下周优先级组织；标题结论先行，工作事项按主题归并，不要照搬任务清单。整体控制在 500—800 字。',
  monthly: '围绕月度目标和重点项目生成月报。说明已交付成果、里程碑进展、偏差原因和下月重点；用可核验事实说明业务影响，不编造完成率、金额或同比数据。整体控制在 800—1200 字。',
  quarterly: '围绕季度目标达成和重点项目组合生成季报。突出阶段成果、关键偏差、资源与风险复盘、下一季度动作；每个章节只承担一个管理沟通任务。整体控制在 1000—1600 字。',
  semi_annual: '围绕半年阶段成果和能力沉淀生成半年报。说明战略目标进展、机制或方法沉淀、未完成事项及下半年优先级；结论先行，避免空泛表态。整体控制在 1200—1800 字。',
  annual: '围绕年度贡献和下一年度规划生成年报。按年度总览、重大成果、关键项目复盘、经验沉淀、未完成事项和明年计划组织；只使用任务证据，不能虚构经营指标。整体控制在 1500—2200 字。',
};

export const DEFAULT_PPT_PROMPT =
  '生成一套 4—6 页的管理汇报 PPT，采用“核心结论—成果证据—进展与偏差—风险应对—下一阶段行动”的叙事。每页只有一个沟通任务，标题写结论，单页最多 4 个要点；优先使用数据卡、时间线或柱状图表达证据，避免大段文字和任务清单。';

export const reportPromptFor = (type: ReportType) =>
  `你是严谨的工作汇报策划助手。\n${REPORT_PROMPT_GUIDANCE[type]}\n使用金字塔结构：先给听众最需要记住的一句话，再用成果、进展、风险和计划支撑它。每条事实尽量写出“行动—结果—影响—下一动作”，未来事项只能放在计划中。风险按严重程度排序，写清影响和应对。没有证据的人员、金额、比例、完成率、同比环比不得推算。输出中文，表达专业、具体、克制。`;

export const TASK_STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  todo: { label: '待处理', className: 'border-subtle text-sub' },
  in_progress: { label: '进行中', className: 'border-sky-500/30 text-info' },
  completed: { label: '已完成', className: 'border-emerald-500/30 text-success' },
  blocked: { label: '已阻塞', className: 'border-rose-500/30 text-danger' },
};

export const renderReportMarkdown = (markdown: string): string =>
  DOMPurify.sanitize(marked.parse(markdown, { gfm: true, breaks: true }) as string);

export const formatDateValue = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getReportDateRange = (
  type: ReportType,
  referenceDate = new Date(),
  periodPreset: ReportPeriodPreset = 'current',
): { startDate: string; endDate: string } => {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const day = referenceDate.getDate();
  const periodOffset = periodPreset === 'previous' ? -1 : 0;
  let start = new Date(year, month, day + periodOffset);
  let end = new Date(year, month, day + periodOffset);

  if (type === 'weekly') {
    const daysSinceMonday = (referenceDate.getDay() + 6) % 7;
    start = new Date(year, month, day - daysSinceMonday + periodOffset * 7);
    end = new Date(year, month, day + 6 - daysSinceMonday + periodOffset * 7);
  } else if (type === 'monthly') {
    start = new Date(year, month + periodOffset, 1);
    end = new Date(year, month + periodOffset + 1, 0);
  } else if (type === 'quarterly') {
    const qStart = Math.floor(month / 3) * 3;
    start = new Date(year, qStart + periodOffset * 3, 1);
    end = new Date(year, qStart + periodOffset * 3 + 3, 0);
  } else if (type === 'semi_annual') {
    const hStart = month < 6 ? 0 : 6;
    start = new Date(year, hStart + periodOffset * 6, 1);
    end = new Date(year, hStart + periodOffset * 6 + 6, 0);
  } else if (type === 'annual') {
    start = new Date(year + periodOffset, 0, 1);
    end = new Date(year + periodOffset, 11, 31);
  }

  return { startDate: formatDateValue(start), endDate: formatDateValue(end) };
};

const extractDateOnly = (dateStr?: string | null): string | null => {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  return trimmed.length >= 10 ? trimmed.slice(0, 10) : null;
};

const STATUS_PRIORITY_ORDER: Record<TaskStatus, number> = {
  in_progress: 1,
  blocked: 2,
  todo: 3,
  completed: 4,
};

const PRIORITY_ORDER: Record<Priority, number> = {
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};

/**
 * Filter and sort local tasks matching the selected report period and scope.
 */
export const filterTasksForPeriod = (
  tasks: Task[],
  options: FilterPeriodTasksOptions,
): Task[] => {
  const { currentUserId, startDate, endDate, selectedProjectId } = options;

  return tasks
    .filter((task) => {
      // 1. User scope check: creator, assignee, or shared member
      const isPersonalScope =
        task.creatorId === currentUserId ||
        task.assigneeId === currentUserId ||
        (Array.isArray(task.sharedWith) && task.sharedWith.includes(currentUserId));

      if (!isPersonalScope) return false;

      // 2. Project scope filter
      if (selectedProjectId && task.projectId !== selectedProjectId) {
        return false;
      }

      const createdDay = extractDateOnly(task.createdAt);
      const updatedDay = extractDateOnly(task.updatedAt);
      const dueDay = extractDateOnly(task.dueDate);

      // 3. Relevant conditions during the period
      const createdInPeriod = Boolean(createdDay && createdDay >= startDate && createdDay <= endDate);
      const updatedInPeriod = Boolean(updatedDay && updatedDay >= startDate && updatedDay <= endDate);
      const dueInPeriod = Boolean(dueDay && dueDay >= startDate && dueDay <= endDate);
      const overdueAsOfEnd = Boolean(
        task.status !== 'completed' && dueDay && dueDay <= endDate
      );
      const activeInPeriod = Boolean(
        (task.status === 'in_progress' || task.status === 'blocked') &&
          createdDay &&
          createdDay <= endDate
      );

      return createdInPeriod || updatedInPeriod || dueInPeriod || overdueAsOfEnd || activeInPeriod;
    })
    .sort((a, b) => {
      const statusDiff =
        (STATUS_PRIORITY_ORDER[a.status] || 99) - (STATUS_PRIORITY_ORDER[b.status] || 99);
      if (statusDiff !== 0) return statusDiff;

      const priorityDiff =
        (PRIORITY_ORDER[a.priority] || 99) - (PRIORITY_ORDER[b.priority] || 99);
      if (priorityDiff !== 0) return priorityDiff;

      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
};

/**
 * Calculate summary counts by task status for a list of tasks.
 */
export const calculateTaskStats = (
  tasks: Array<{ status: TaskStatus }>,
): TaskPeriodStats => {
  const stats: TaskPeriodStats = {
    total: tasks.length,
    completed: 0,
    inProgress: 0,
    blocked: 0,
    todo: 0,
  };
  for (const t of tasks) {
    if (t.status === 'completed') stats.completed++;
    else if (t.status === 'in_progress') stats.inProgress++;
    else if (t.status === 'blocked') stats.blocked++;
    else if (t.status === 'todo') stats.todo++;
  }
  return stats;
};
