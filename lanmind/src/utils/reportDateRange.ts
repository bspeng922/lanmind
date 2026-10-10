import { tr } from "../i18n";
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
  { id: 'daily', get label() { return tr("common:reportDateRange.dailyReport"); } },
  { id: 'weekly', get label() { return tr("common:reportDateRange.weeklyReport"); } },
  { id: 'monthly', get label() { return tr("common:reportDateRange.monthlyReport"); } },
  { id: 'quarterly', get label() { return tr("common:reportDateRange.quarterlyReport"); } },
  { id: 'semi_annual', get label() { return tr("common:reportDateRange.halfYearReport"); } },
  { id: 'annual', get label() { return tr("common:reportDateRange.annualReport"); } },
];

export const BUILTIN_PPT_TEMPLATES: PPTTemplate[] = [
  {
    id: 'tpl-executive',
    get name() { return tr("common:reportDateRange.executive"); },
    get description() { return tr("common:reportDateRange.leadWithConclusionsEvidenceRisksAndActions"); },
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
    get name() { return tr("common:reportDateRange.businessBlue"); },
    get description() { return tr("common:reportDateRange.forWeeklyMonthlyAndManagementReports"); },
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
    get name() { return tr("common:reportDateRange.techTeal"); },
    get description() { return tr("common:reportDateRange.forEngineeringProductAndTechnicalResults"); },
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
    get name() { return tr("common:reportDateRange.minimalWhite"); },
    get description() { return tr("common:reportDateRange.highContrastAndGenerousSpacingForEasy"); },
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
  get daily() { return tr("common:reportDateRange.createADailyReportCoveringThe3"); },
  get weekly() { return tr("common:reportDateRange.createAWeeklyReportOrganizedByResults"); },
  get monthly() { return tr("common:reportDateRange.createAMonthlyReportCoveringDeliveredOutcomes"); },
  get quarterly() { return tr("common:reportDateRange.createAQuarterlyReportCoveringOutcomesKey"); },
  get semi_annual() { return tr("common:reportDateRange.createAHalfYearReportCoveringOutcomes"); },
  get annual() { return tr("common:reportDateRange.createAnAnnualReportCoveringContributionsMajor"); },
};

export const DEFAULT_PPT_PROMPT =
  '生成一套 4—6 页的管理汇报 PPT，采用“核心结论—成果证据—进展与偏差—风险应对—下一阶段行动”的叙事。每页只有一个沟通任务，标题写结论，单页最多 4 个要点；优先使用数据卡、时间线或柱状图表达证据，避免大段文字和任务清单。';
export const defaultPptPrompt = () => tr('reports:prompts.presentation');

export const reportPromptFor = (type: ReportType) =>
  tr("common:reportDateRange.youAreARigorousWorkReportAssistant", { value0: REPORT_PROMPT_GUIDANCE[type] });

export const TASK_STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  todo: { get label() { return tr("common:reportDateRange.toDo"); }, className: 'border-subtle text-sub' },
  in_progress: { get label() { return tr("common:reportDateRange.inProgress"); }, className: 'border-sky-500/30 text-info' },
  completed: { get label() { return tr("common:reportDateRange.completed"); }, className: 'border-emerald-500/30 text-success' },
  blocked: { get label() { return tr("common:reportDateRange.blocked"); }, className: 'border-rose-500/30 text-danger' },
  abandoned: { get label() { return tr("common:reportDateRange.abandoned"); }, className: 'border-subtle text-quiet' },
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
  abandoned: 5,
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
      // Subtasks describe their parent's work and must not be counted twice.
      if (task.parentTaskId) return false;

      // Abandoned tasks are discarded/cancelled and must not be counted in work reports.
      if (task.status === 'abandoned') return false;

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
    total: 0,
    completed: 0,
    inProgress: 0,
    blocked: 0,
    todo: 0,
  };
  for (const t of tasks) {
    if (t.status === 'abandoned') continue;
    stats.total++;
    if (t.status === 'completed') stats.completed++;
    else if (t.status === 'in_progress') stats.inProgress++;
    else if (t.status === 'blocked') stats.blocked++;
    else if (t.status === 'todo') stats.todo++;
  }
  return stats;
};
