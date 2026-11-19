/**
 * importUtils — Pure function utilities, samples, and parsers for Task Import.
 *
 * CALLING SPEC:
 *   const tasks = parseCSVRows(csvText);
 *
 * TOOL CONTRACT:
 *   - Deterministic: parses CSV text according to RFC-4180 into structured Task candidates.
 *   - Pure: no side-effects, no global state.
 */

import type { Priority, StateGroup, TaskStatus } from '../../types';
import { GROUP_TO_LEGACY_STATUS, STATE_GROUPS, legacyStatusToGroup } from '../../utils/workItemState';

export interface MigrationLog {
  id: string;
  projectName: string;
  fileName: string;
  format: 'CSV' | 'JSON';
  status: 'Finished' | 'Failed';
  summary: string;
  importedCount: number;
  startTime: string;
}

export const IMPORT_HISTORY_STORAGE_KEY = 'lanmind_import_history';

export const SAMPLE_CSV_CONTENT = `title,description,priority,dueDate,stateGroup
设计用户登录与注册页面,完成多设备响应式高保真UI与交互设计,P1,2026-10-25,started
搭建局域网端对端同步网关,支持局域网自动多播发现与加密同步,P1,2026-10-28,unstarted
编写核心数据模型单元测试,补充工作区与工作项状态迁移用例,P2,2026-10-30,backlog
`;

export const SAMPLE_JSON_CONTENT = JSON.stringify(
  [
    {
      title: '设计用户登录与注册页面',
      description: '完成多设备响应式高保真UI与交互设计',
      priority: 'P1',
      dueDate: '2026-10-25',
      stateGroup: 'started',
    },
    {
      title: '搭建局域网端对端同步网关',
      description: '支持局域网自动多播发现与加密同步',
      priority: 'P1',
      dueDate: '2026-10-28',
      stateGroup: 'unstarted',
    },
    {
      title: '编写核心数据模型单元测试',
      description: '补充工作区与工作项状态迁移用例',
      priority: 'P2',
      dueDate: '2026-10-30',
      stateGroup: 'backlog',
    },
  ],
  null,
  2
);

export interface ParsedImportTask {
  title: string;
  description: string;
  priority: Priority;
  dueDate?: string;
  status: TaskStatus;
  stateGroup: StateGroup;
}

function readCSVRecords(text: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;

  const finishField = () => {
    row.push(quoted ? field : field.trim());
    field = '';
    quoted = false;
  };
  const finishRow = () => {
    finishField();
    if (row.some((value) => value.trim())) records.push(row);
    row = [];
  };

  for (let i = text.startsWith('\uFEFF') ? 1 : 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (char === '"' && !quoted && !field.trim()) {
      field = '';
      quoted = true;
      inQuotes = true;
    } else if (char === ',') {
      finishField();
    } else if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (!quoted || char.trim()) {
      field += char;
    }
  }

  if (inQuotes) return [];
  finishRow();
  return records;
}

export function resolveImportedStateGroup(value: unknown, status?: unknown): StateGroup {
  const group = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const canonical = STATE_GROUPS.find((candidate) => candidate === group);
  if (canonical) return canonical;

  const rawStatus = typeof status === 'string' && status.trim() ? status : group;
  const key = rawStatus.trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (key) {
    case 'done':
    case '已完成':
    case '完成':
      return 'completed';
    case 'doing':
    case '进行中':
    case '处理中':
      return 'started';
    case '待办池':
    case '需求池':
    case '积压':
      return 'backlog';
    case 'canceled':
    case '已取消':
    case '取消':
    case '已放弃':
      return 'cancelled';
    default:
      return STATE_GROUPS.find((candidate) => candidate === key) ?? legacyStatusToGroup(key);
  }
}

export function parseCSVRows(text: string): ParsedImportTask[] {
  const [header, ...rows] = readCSVRecords(text);
  if (!header) return [];
  const headers = header.map((column) => column.toLowerCase().replace(/[\s_-]/g, ''));
  const findHeaderIndex = (aliases: string[]) => {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias);
      if (idx !== -1) return idx;
    }
    for (const alias of aliases) {
      const idx = headers.findIndex((header) => header.includes(alias));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const titleIdx = findHeaderIndex(['title', 'name', '标题', '工作项', '任务']);
  const descIdx = findHeaderIndex(['description', 'desc', '描述', '详情', '内容', '备注']);
  const prioIdx = findHeaderIndex(['priority', 'prio', '优先级', '等级']);
  const dueIdx = findHeaderIndex(['duedate', 'due', '截止时间', '截止日期', '到期日', '日期']);
  const groupIdx = findHeaderIndex(['stategroup']);
  const statusIdx = findHeaderIndex(['status', 'state', '状态']);
  const metadataColumns = [prioIdx, dueIdx, groupIdx, statusIdx];
  const titleColumn = titleIdx === -1 && ![descIdx, ...metadataColumns].includes(0) ? 0 : titleIdx;
  const descriptionColumn = descIdx === -1 && ![titleColumn, ...metadataColumns].includes(1) ? 1 : descIdx;

  const mapPriority = (val: string): Priority => {
    const v = (val || '').toLowerCase();
    if (v.includes('0') || v.includes('1') || v.includes('紧急') || v.includes('urgent')) return 'P1';
    if (v.includes('2') || v.includes('高') || v.includes('high')) return 'P2';
    if (v.includes('4') || v.includes('低') || v.includes('low')) return 'P4';
    return 'P3';
  };

  const tasks: ParsedImportTask[] = [];
  for (const cols of rows) {
    const rawTitle = cols[titleColumn];
    if (!rawTitle?.trim()) continue;

    const rawDesc = cols[descriptionColumn] ?? '';
    const rawPrio = cols[prioIdx] ?? 'P2';
    const rawDue = cols[dueIdx]?.trim();
    const stateGroup = resolveImportedStateGroup(cols[groupIdx], cols[statusIdx]);

    tasks.push({
      title: rawTitle,
      description: rawDesc,
      priority: mapPriority(rawPrio),
      dueDate: rawDue && !isNaN(Date.parse(rawDue)) ? rawDue : undefined,
      status: GROUP_TO_LEGACY_STATUS[stateGroup],
      stateGroup,
    });
  }

  return tasks;
}
