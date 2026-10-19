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

import { Priority } from '../../types';

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
  status: 'todo' | 'completed';
  stateGroup: string;
}

export function parseCSVRows(text: string): ParsedImportTask[] {
  // Strip BOM
  const cleaned = text.replace(/^\uFEFF/, '');
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  // Helper to parse CSV line respecting quotes
  const parseCsvLine = (line: string): string[] => {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    return row;
  };

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[\s_-]/g, ''));
  const tasks: ParsedImportTask[] = [];

  // Match column indexes for both EN and ZH
  const findHeaderIndex = (aliases: string[]) => {
    for (const alias of aliases) {
      const idx = headers.findIndex((h) => h === alias || h.includes(alias));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const titleIdx = findHeaderIndex(['title', 'name', '标题', '工作项', '任务']);
  const descIdx = findHeaderIndex(['description', 'desc', '描述', '详情', '内容', '备注']);
  const prioIdx = findHeaderIndex(['priority', 'prio', '优先级', '等级']);
  const dueIdx = findHeaderIndex(['duedate', 'due', '截止时间', '截止日期', '到期日', '日期']);
  const stateIdx = findHeaderIndex(['stategroup', 'status', 'state', '状态']);

  const mapPriority = (val: string): Priority => {
    const v = (val || '').toLowerCase();
    if (v.includes('0') || v.includes('1') || v.includes('紧急') || v.includes('urgent')) return 'P1';
    if (v.includes('2') || v.includes('高') || v.includes('high')) return 'P2';
    if (v.includes('4') || v.includes('低') || v.includes('low')) return 'P4';
    return 'P3';
  };

  const mapState = (val: string): { status: 'todo' | 'completed'; stateGroup: string } => {
    const v = (val || '').toLowerCase();
    if (v.includes('completed') || v.includes('done') || v.includes('已完成') || v.includes('完成')) {
      return { status: 'completed', stateGroup: 'completed' };
    }
    if (v.includes('started') || v.includes('doing') || v.includes('in_progress') || v.includes('进行中') || v.includes('处理中')) {
      return { status: 'todo', stateGroup: 'started' };
    }
    if (v.includes('backlog') || v.includes('待办池') || v.includes('需求池') || v.includes('积压')) {
      return { status: 'todo', stateGroup: 'backlog' };
    }
    return { status: 'todo', stateGroup: 'unstarted' };
  };

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length === 0 || !cols.some(Boolean)) continue;

    const rawTitle = titleIdx !== -1 ? cols[titleIdx] : cols[0];
    if (!rawTitle) continue;

    const rawDesc = descIdx !== -1 ? cols[descIdx] : cols[1] || '';
    const rawPrio = prioIdx !== -1 ? cols[prioIdx] : 'P2';
    const rawDue = dueIdx !== -1 ? cols[dueIdx] : undefined;
    const rawState = stateIdx !== -1 ? cols[stateIdx] : 'unstarted';

    const stateInfo = mapState(rawState);

    tasks.push({
      title: rawTitle,
      description: rawDesc,
      priority: mapPriority(rawPrio),
      dueDate: rawDue && !isNaN(Date.parse(rawDue)) ? rawDue : undefined,
      status: stateInfo.status,
      stateGroup: stateInfo.stateGroup,
    });
  }

  return tasks;
}
