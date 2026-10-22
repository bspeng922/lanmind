/**
 * McpServerToolsList — Showcase of exposed tools provided by LanMind's LAN MCP server.
 *
 * CALLING SPEC:
 *   <McpServerToolsList />
 *
 * PROPS: None (standalone showcase component)
 * SIDE EFFECTS: None (pure UI display with local search & filter state)
 */

import React, { useState, useMemo } from 'react';
import {
  Wrench,
  Search,
  ChevronDown,
  ChevronUp,
  FolderKanban,
  CheckSquare,
  Users,
  MessageSquare,
  BookOpen,
  Lock,
  Unlock,
} from 'lucide-react';
import { tr, useLocale } from '../../i18n';

interface ExposedTool {
  name: string;
  category: 'workspace' | 'projects' | 'tasks' | 'comments' | 'wiki';
  write: boolean;
  descZh: string;
  descEn: string;
}

const EXPOSED_TOOLS: readonly ExposedTool[] = [
  // Workspace & Org
  {
    name: 'get_context',
    category: 'workspace',
    write: false,
    descZh: '读取授权工作区、当前用户、本地日期时间与时区偏移',
    descEn: 'Read authorized workspace, current user, local date/time, and timezone offset',
  },
  {
    name: 'list_users',
    category: 'workspace',
    write: false,
    descZh: '获取工作区成员列表及真实 ID（用于指派与过滤）',
    descEn: 'List current workspace users and their real IDs for assignment',
  },
  {
    name: 'get_workspace',
    category: 'workspace',
    write: false,
    descZh: '读取当前工作区基本信息、描述及配置时区',
    descEn: 'Read workspace profile, description, and configured timezone',
  },
  {
    name: 'list_workspace_members',
    category: 'workspace',
    write: false,
    descZh: '分页查询已加入工作区的成员资料与角色权限',
    descEn: 'List admitted workspace members, profiles, and roles with pagination',
  },
  {
    name: 'get_org_directory',
    category: 'workspace',
    write: false,
    descZh: '读取本地维护的组织架构部门与成员映射目录',
    descEn: 'Read local organization units and member directory mappings',
  },

  // Projects
  {
    name: 'list_projects',
    category: 'projects',
    write: false,
    descZh: '列出当前用户有权访问的项目列表及成员状态',
    descEn: 'List projects accessible to authorized user and membership status',
  },
  {
    name: 'get_project',
    category: 'projects',
    write: false,
    descZh: '根据 projectId 读取指定项目的详细配置',
    descEn: 'Read project profile by projectId',
  },
  {
    name: 'list_project_members',
    category: 'projects',
    write: false,
    descZh: '分页读取项目成员名单、项目负责人与管理权限',
    descEn: 'Read project members, administrator roles, and project lead',
  },
  {
    name: 'get_project_summary',
    category: 'projects',
    write: false,
    descZh: '查询项目任务统计快照（状态分组分布、完成率、逾期与风险数）',
    descEn: 'Current snapshot task counts, completion rate, overdue and risk counts',
  },
  {
    name: 'list_states',
    category: 'projects',
    write: false,
    descZh: '查询个人与指定项目的全部任务状态定义及 stateId',
    descEn: 'List personal and project task state definitions and IDs',
  },

  // Tasks
  {
    name: 'list_tasks',
    category: 'tasks',
    write: false,
    descZh: '多条件筛选可见任务（关键词、项目、执行人、状态、优先级、日期范围）',
    descEn: 'Filter visible tasks by keyword, project, assignee, state, priority, and date',
  },
  {
    name: 'get_task',
    category: 'tasks',
    write: false,
    descZh: '根据 taskId 查询单个任务详情（含当前版本号）',
    descEn: 'Read one visible task by taskId, including current version',
  },
  {
    name: 'list_today_tasks',
    category: 'tasks',
    write: false,
    descZh: '查询今日日程任务（今日到期或进行中，排除已归档/已完成）',
    descEn: "Today's schedule: tasks due today or in progress",
  },
  {
    name: 'list_risk_warnings',
    category: 'tasks',
    write: false,
    descZh: '查询逾期、阻塞、临期与高优先级等风险预警任务',
    descEn: 'Read overdue, blocked, imminent, and high-priority risk warnings',
  },
  {
    name: 'create_task',
    category: 'tasks',
    write: true,
    descZh: '创建任务或子任务（支持指派、关联项目、优先级、截止时间）',
    descEn: 'Create task or child work item with assignee, project, priority, and dates',
  },
  {
    name: 'update_task',
    category: 'tasks',
    write: true,
    descZh: '更新任务属性（状态推进、指派变更、描述修改、标题调整）',
    descEn: 'Update task properties (state, assignee, title, description, progress)',
  },

  // Comments & Activity
  {
    name: 'list_task_comments',
    category: 'comments',
    write: false,
    descZh: '分页读取任务的讨论评论列表（按时间排序）',
    descEn: "Read a task's comments with pagination",
  },
  {
    name: 'create_task_comment',
    category: 'comments',
    write: true,
    descZh: '在指定任务下发表新讨论评论或回复已有评论',
    descEn: 'Add comment or reply to existing comment on a task',
  },
  {
    name: 'update_task_comment',
    category: 'comments',
    write: true,
    descZh: '编辑当前用户发表的讨论评论内容',
    descEn: 'Edit comment content posted by current user',
  },
  {
    name: 'list_task_activity',
    category: 'comments',
    write: false,
    descZh: '分页查询任务的操作动态与变更历史记录',
    descEn: 'Read authorized task activity and change history with pagination',
  },

  // Wiki Docs
  {
    name: 'list_wiki_pages',
    category: 'wiki',
    write: false,
    descZh: '获取指定项目或目录下的 Wiki 文档目录与元数据',
    descEn: 'List readable Wiki page metadata and hierarchy',
  },
  {
    name: 'search_wiki',
    category: 'wiki',
    write: false,
    descZh: '全文检索 Wiki 标题与正文 Markdown 内容并返回匹配摘要',
    descEn: 'Search readable Wiki titles and Markdown content with snippets',
  },
  {
    name: 'get_wiki_page',
    category: 'wiki',
    write: false,
    descZh: '分页读取指定 Wiki 页面的完整 Markdown 正文与版本信息',
    descEn: 'Read Wiki page Markdown content and version by character offset',
  },
  {
    name: 'create_wiki_page',
    category: 'wiki',
    write: true,
    descZh: '在知识库中创建新 Wiki 文档页面及内容',
    descEn: 'Create a new Wiki page with title and Markdown content',
  },
  {
    name: 'update_wiki_page',
    category: 'wiki',
    write: true,
    descZh: '基于预期版本号更新 Wiki 页面标题与 Markdown 内容',
    descEn: 'Update Wiki title and Markdown content with optimistic concurrency',
  },
];

export function McpServerToolsList(): React.ReactElement {
  const { locale } = useLocale();
  const [isExpanded, setIsExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const filteredTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    return EXPOSED_TOOLS.filter((tool) => {
      if (selectedCategory !== 'all' && tool.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      return (
        tool.name.toLowerCase().includes(q) ||
        tool.descZh.toLowerCase().includes(q) ||
        tool.descEn.toLowerCase().includes(q)
      );
    });
  }, [search, selectedCategory]);

  const categories = [
    { id: 'all', label: tr('settings:settingsModal.mcpToolsAll'), icon: Wrench },
    { id: 'workspace', label: tr('settings:settingsModal.mcpToolsCategoryWorkspace'), icon: Users },
    { id: 'projects', label: tr('settings:settingsModal.mcpToolsCategoryProjects'), icon: FolderKanban },
    { id: 'tasks', label: tr('settings:settingsModal.mcpToolsCategoryTasks'), icon: CheckSquare },
    { id: 'comments', label: tr('settings:settingsModal.mcpToolsCategoryComments'), icon: MessageSquare },
    { id: 'wiki', label: tr('settings:settingsModal.mcpToolsCategoryWiki'), icon: BookOpen },
  ];

  return (
    <div className="rounded-xl border border-edge bg-canvas/30 overflow-hidden transition-all">
      {/* Header / Expand Toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between p-3.5 text-left hover:bg-hover/50 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-info/10 text-info">
            <Wrench className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-main flex items-center gap-2">
              <span>{tr('settings:settingsModal.mcpToolsHeading', { count: EXPOSED_TOOLS.length })}</span>
              <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-accent/10 text-accent">
                25 Tools
              </span>
            </div>
            <div className="text-[11px] text-sub truncate mt-0.5">
              {tr('settings:settingsModal.mcpToolsSubtitle')}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-quiet text-xs shrink-0 ml-2">
          <span>{isExpanded ? tr('settings:settingsModal.mcpToolsCollapse') : tr('settings:settingsModal.mcpToolsExpand')}</span>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-edge p-3 space-y-3 bg-surface/40 animate-in fade-in duration-150">
          {/* Controls: Search and Categories */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-quiet" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tr('settings:settingsModal.mcpToolsSearchPlaceholder')}
                className="w-full rounded-lg border border-edge bg-canvas pl-8 pr-3 py-1.5 text-xs text-main placeholder:text-quiet focus:border-accent focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {categories.map((cat) => {
                const Icon = cat.icon;
                const active = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] transition-colors ${
                      active
                        ? 'bg-accent text-on-accent font-medium'
                        : 'bg-input/60 text-sub hover:bg-hover'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tools Grid */}
          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
            {filteredTools.length === 0 ? (
              <div className="py-6 text-center text-xs text-quiet">
                {tr('settings:settingsModal.mcpToolsEmpty')}
              </div>
            ) : (
              filteredTools.map((tool) => (
                <div
                  key={tool.name}
                  className="flex items-center justify-between gap-3 p-2 rounded-lg border border-edge/60 bg-surface/80 hover:bg-hover/60 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono font-semibold text-main">
                        {tool.name}
                      </code>
                      <span
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                          tool.write
                            ? 'bg-warning/10 text-warning border-warning/30'
                            : 'bg-info/10 text-info border-info/30'
                        }`}
                      >
                        {tool.write ? (
                          <>
                            <Unlock className="w-2.5 h-2.5" />
                            <span>{tr('settings:settingsModal.mcpToolsWrite')}</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-2.5 h-2.5" />
                            <span>{tr('settings:settingsModal.mcpToolsRead')}</span>
                          </>
                        )}
                      </span>
                    </div>
                    <p className="text-[11px] text-sub mt-0.5 line-clamp-1">
                      {locale === 'en-US' ? tool.descEn : tool.descZh}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
