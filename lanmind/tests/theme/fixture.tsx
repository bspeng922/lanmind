// Development-only fixtures: no real database, peer network, or file operations.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import App from '../../src/App';
import { ThemeProvider, useTheme } from '../../src/context/ThemeContext';
import { ApiService } from '../../src/services/api';
import { ProjectFilesPanel } from '../../src/components/ProjectFilesPanel';
import { FilePreviewModal } from '../../src/components/FilePreviewModal';
import { GroupAnnouncementModal } from '../../src/components/GroupAnnouncementModal';
import { GroupAnnouncementBanner } from '../../src/components/GroupAnnouncementBanner';
import { EditGroupModal } from '../../src/components/EditGroupModal';
import { ForwardMessageModal } from '../../src/components/ForwardMessageModal';
import { ReadReceiptsModal } from '../../src/components/ReadReceiptsModal';
import { ChatFilesModal } from '../../src/components/ChatFilesModal';
import { UserProfileModal } from '../../src/components/UserProfileModal';
import { SyncMonitorModal } from '../../src/components/SyncMonitorModal';
import { TaskActivityModal } from '../../src/components/TaskActivityModal';
import { RiskAlertsModal } from '../../src/components/RiskAlertsModal';
import { LLMConfigModal } from '../../src/components/LLMConfigModal';
import { ThemeModal } from '../../src/components/ThemeModal';
import { ThemeSelect } from '../../src/components/ThemeSelect';
import { ThemeDatePicker } from '../../src/components/ThemeDatePicker';
import { ThemeCheckbox } from '../../src/components/ThemeCheckbox';
import { LanChatModal } from '../../src/components/LanChatModal';
import { TaskModal } from '../../src/components/TaskModal';
import { ProjectModal } from '../../src/components/ProjectModal';
import { SettingsModal, SettingsTab } from '../../src/components/SettingsModal';
import { LLMReportStudio } from '../../src/components/LLMReportStudio';
import { DEFAULT_SHORTCUTS } from '../../src/components/ShortcutModal';
import DesktopCalendarWindow from '../../src/DesktopCalendarWindow';
import { NotificationWindow } from '../../src/NotificationWindow';
import QuickAddWindow from '../../src/QuickAddWindow';
import type { GeneratedReport, Project, ProjectFile, ProjectFolder, Task, TaskComment, User, LanChatGroup, LanGroupAnnouncement, PageRequest } from '../../src/types';
import '../../src/index.css';
import { docxUrl } from './document';
import { AppLockFixture, StartupFixture, configureAppLockFixture } from './appLockFixture';

const params = new URLSearchParams(location.search);
const view = params.get('view') || 'files';
if (view === 'app-lock' || view === 'app-startup') configureAppLockFixture(params);
if(view === 'calendar-window') document.body.classList.add('desktop-calendar-host');
if(view === 'notification') document.body.classList.add('notification-host');
if(view === 'quick-add') document.body.classList.add('quick-add-host');
if (params.has('theme')) localStorage.setItem('lanmind-theme', params.get('theme')!);
const now = '2026-09-14T10:00:00Z';
const noop = () => {};
const asyncNoop = async () => {};
export const user: User = { id: 'local-user@desktop', username: 'tester', nickname: '测试管理员', deviceId: 'test', role: 'admin', ip: '127.0.0.1', isOnline: true, lastActive: now };
const peer: User = { ...user, id: 'peer@test', nickname: '协作成员', role: 'user' };
const project: Project = { id: 'theme-project', name: '协作工作台', description: '明亮模式样式检查', color: '#2563eb', createdBy: user.id, admins: [user.id], members: [user.id, peer.id], createdAt: now, updatedAt: now };
const group: LanChatGroup = { id: 'theme-group', name: '项目协作群', createdBy: user.id, createdAt: now, memberIds: [user.id, peer.id], adminIds: [user.id] };
if (view === 'chat' && params.get('group-role') === 'admin') group.createdBy = peer.id;
if (view === 'chat' && params.get('group-role') === 'member') { group.createdBy = peer.id; group.adminIds = [peer.id]; }
if (view === 'chat' && params.has('readonly-group')) group.projectId = 'inaccessible-project';
const announcement: LanGroupAnnouncement = { id: 'ann-theme', groupId: group.id, title: '本周项目进展与安排', content: '请在周五前提交项目资料，文档和附件统一存放到项目文件中。', authorId: user.id, authorName: user.nickname, createdAt: now, pinned: true, readBy: [user.id] };
const message = { id: 'file-message', senderId: peer.id, senderName: peer.nickname, type: 'file', content: '项目资料已上传', fileName: '项目说明.md', fileUrl: 'data:text/plain;base64,b2s=', timestamp: now, readBy: [user.id] };
const markdown = '# 项目说明\n\n统一的浅色阅读界面，支持 **加粗**、[链接](https://example.com) 和 `inline code`。\n\n## 实施步骤\n\n- 检查项目文档\n- 提交验收报告\n\n```typescript\n// Theme-aware code\nconst status = "ready";\nfunction greet(name: string) { return name; }\n```\n\n> 引用说明：正文、链接和代码应清晰可读。\n';
const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const markdownUrl = 'data:text/plain;base64,' + base64(markdown);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['任务', '负责人', '状态'], ['检查明亮主题', '测试管理员', '进行中'], ['文件资料归档', '协作成员', '已完成']]), '项目安排');
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['备注'], ['切换工作表后样式一致']]), '备注');
const excelUrl = 'data:application/octet-stream;base64,' + XLSX.write(book, { type: 'base64', bookType: 'xlsx' });
const files: ProjectFile[] = [
  { id: 'md', projectId: project.id, name: '项目说明.md', size: 2048, type: 'text/markdown', uploadedBy: user.id, uploadedAt: now, dataUrl: markdownUrl },
  { id: 'xlsx', projectId: project.id, name: '项目安排.xlsx', size: 16384, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', uploadedBy: peer.id, uploadedAt: now, dataUrl: excelUrl },
  { id: 'long', projectId: project.id, name: '用于检查长文件名截断和操作按钮布局的项目验收资料与补充说明.txt', size: 512, type: 'text/plain', uploadedBy: user.id, uploadedAt: now },
];
const folders: ProjectFolder[] = [{ id: 'docs', projectId: project.id, path: '参考资料', createdBy: user.id, createdAt: now }];
const tasks: Task[] = ['todo', 'in_progress', 'completed', 'blocked'].map((status, i) => ({ id: 'task-'+i, title: ['整理项目资料', '检查明亮主题', '完成联调验证', '确认交付时间'][i], description: '检查文字、边界和状态颜色。', priority: ['P1','P2','P3','P4'][i] as Task['priority'], status: status as Task['status'], dueDate: '2026-09-14', creatorId: user.id, assigneeId: user.id, projectId: project.id, isShared: false, sharedWith: [], subtasks: [], tags: ['验收'], createdAt: now, updatedAt: now, version: 1 }));
if (view === 'timeline') {
  const base = tasks[0];
  tasks.splice(0, tasks.length,
    { ...base, id: 'today-point', title: '今日交付节点', dueDate: '2026-09-30T18:00' },
    { ...base, id: 'continues-before', title: '跨月资料整理', startDate: '2026-09-25', dueDate: '2026-10-01' },
    { ...base, id: 'continues-after', title: '持续联调验证', startDate: '2026-10-02', dueDate: '2026-10-12' },
    { ...base, id: 'outside-before', title: '更早的排期', dueDate: '2026-09-20' },
    { ...base, id: 'outside-after', title: '后续交付', dueDate: '2026-10-20' },
    { ...base, id: 'unscheduled', title: '待排期评估', dueDate: undefined },
  );
}
if (view === 'task-detail') {
  tasks[0].description = '保留任务正文\n\n- [ ] 核对资料\n- [x] 提交报告';
  tasks[0].subtasks = [{ id: 'check-one', title: '核对资料', completed: false }, { id: 'check-two', title: '提交报告', completed: true }];
  tasks[1].tags = ['开发', '设计'];
  tasks[1].subtasks = [{ id: 'legacy-check', title: '旧版检查事项', completed: false }];
  tasks.push({ ...tasks[0], id: 'child-one', title: '独立子任务', parentTaskId: tasks[0].id, description: '子任务说明', subtasks: [], tags: ['子任务标签'], status: 'completed', progress: 100 });
  const testState = { tasks, failSave: false, saves: 0, failComment: false };
  (window as any).__taskFixture = testState;
  ApiService.updateTask = async (id, updates) => { const index = tasks.findIndex((task) => task.id === id); tasks[index] = { ...tasks[index], ...updates, version: tasks[index].version + 1 }; return tasks[index]; };
  ApiService.createTask = async (payload) => { const task = { ...payload, id: crypto.randomUUID(), createdAt: now, updatedAt: now, version: 1 }; tasks.push(task); return task; };
  ApiService.saveTaskWithChildren = async (id, payload, children, detached) => {
    if (testState.failSave) throw new Error('测试保存失败');
    const parent = id ? await ApiService.updateTask(id, payload, user.id) : await ApiService.createTask(payload as Task, user.id);
    for (const child of children) {
      if (child.id) await ApiService.updateTask(child.id, child, user.id);
      else await ApiService.createTask({ ...parent, ...child, parentTaskId: parent.id }, user.id);
    }
    for (const id of detached) await ApiService.updateTask(id, { parentTaskId: null }, user.id);
    testState.saves += 1;
    return parent;
  };
  const comments: TaskComment[] = [{ id: 'comment-one', taskId: tasks[0].id, authorId: peer.id, content: '请核对资料后提交', createdAt: now, updatedAt: now }];
  ApiService.getTaskComments = async (taskId) => comments.filter((comment) => comment.taskId === taskId);
  ApiService.createTaskComment = async (taskId, content, authorId, replyToCommentId) => {
    if (testState.failComment) throw new Error('评论发送失败，请重试');
    const original = comments.find((comment) => comment.taskId === taskId && comment.id === replyToCommentId);
    if (replyToCommentId && !original) throw new Error('引用的评论不存在、已删除或不属于当前任务');
    const comment: TaskComment = { id: crypto.randomUUID(), taskId, content, authorId, createdAt: now, updatedAt: now, replyTo: original ? { commentId: original.id, authorId: original.authorId, content: original.content } : undefined };
    comments.push(comment); return comment;
  };
  ApiService.deleteTaskComment = async (id, authorId) => {
    const index = comments.findIndex((comment) => comment.id === id && comment.authorId === authorId);
    if (index < 0) throw new Error('不能删除其他成员的评论');
    comments.splice(index, 1);
    return true;
  };
  ApiService.getTaskActivityPage = async (taskId, _user, request = {}) => ({ items: [{ id: 'event-one', taskId, action: 'update', actorId: peer.id, timestamp: now, payload: { title: '整理项目资料' } }], total: 1, page: 1, pageSize: request.pageSize || 20, snapshot: 1 });
}
if (view === 'network-settings') {
  const settingsState = { password: localStorage.getItem('fixture-web-password'), reveals: 0, saves: [] as any[], status: { enabled: false, bindAddress: '0.0.0.0' as '0.0.0.0' | '127.0.0.1', port: 45993, passwordConfigured: Boolean(localStorage.getItem('fixture-web-password')) || params.has('legacy'), running: false, endpoint: 'http://127.0.0.1:45993', readOnly: true }, failSave: false };
  (window as any).__networkFixture = settingsState;
  (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => command === 'plugin:app|version' ? '0.1.5' : command === 'plugin:autostart|is_enabled' ? false : null };
  (window as any).isTauri = true;
  ApiService.getWebStatus = async () => settingsState.status;
  ApiService.getWebPassword = async () => { settingsState.reveals += 1; return settingsState.password; };
  ApiService.updateWebConfig = async (config) => { if (settingsState.failSave) throw new Error('配置保存失败'); settingsState.saves.push(config); const { password, ...settings } = config; if (password) { settingsState.password = password; localStorage.setItem('fixture-web-password', password); } settingsState.status = { ...settingsState.status, ...settings, passwordConfigured: Boolean(password) || settingsState.status.passwordConfigured, running: config.enabled }; return settingsState.status; };
}
if (view === 'task-filters') {
  tasks.push(
    { ...tasks[0], id: 'upcoming-task', title: '准备下次交付', dueDate: '2026-09-15', tags: ['交付'] },
    { ...tasks[2], id: 'upcoming-completed', title: '交付检查已完成', dueDate: '2026-09-15', tags: ['交付'] },
    { ...tasks[1], id: 'unscheduled-task', title: '待排期评估', status: 'todo', dueDate: undefined, tags: ['评估'] },
  );
}
ApiService.getUsers = async () => [user, peer];
const fixtureProjects = [project];
if (view === 'project-layout' || view === 'ui-refinements') {
  tasks[0].progress = 35;
  fixtureProjects.push(
    { ...project, id: 'admin-project', name: '成员共建项目', createdBy: peer.id },
    { ...project, id: 'member-project', name: '成员项目', createdBy: peer.id, admins: [peer.id] },
  );
  tasks.push({ ...tasks[1], id: 'abandoned-task', title: '归档暂缓事项', status: 'abandoned', dueDate: undefined, tags: ['归档', ...Array.from({ length: 12 }, (_, i) => `参考标签${i + 1}`)] });
  if (view === 'ui-refinements') {
    tasks.push({ ...tasks[0], id: 'child-refinement', title: '父任务下的子任务', parentTaskId: tasks[0].id, status: 'completed' });
    tasks.push(...Array.from({ length: 12 }, (_, i) => ({ ...tasks[1], id: `dense-${i}`, title: `当天排期 ${i + 1}` })));
  }
  ApiService.updateProject = async (id, updates) => {
    const index = fixtureProjects.findIndex((item) => item.id === id);
    fixtureProjects[index] = { ...fixtureProjects[index], ...updates };
    return fixtureProjects[index];
  };
  ApiService.transferProject = async (id, targetUserId) => {
    const index = fixtureProjects.findIndex((item) => item.id === id);
    fixtureProjects[index] = { ...fixtureProjects[index], createdBy: targetUserId, admins: [targetUserId] };
    return fixtureProjects[index];
  };
  ApiService.deleteProject = async (id) => {
    fixtureProjects.splice(fixtureProjects.findIndex((item) => item.id === id), 1);
    return true;
  };
}
ApiService.getProjects = async () => [...fixtureProjects];
ApiService.getTasks = async () => [...tasks];
ApiService.getRiskWarnings = async () => [];
ApiService.getSyncLogs = async () => ({ logs: [], latestVersion: 1 });
ApiService.getSyncLogsPage = async (request = {}) => ({ items: [], total: 0, page: 1, pageSize: request.pageSize || 20, snapshot: 0, latestVersion: 1 });
if (view === 'activity-pages' || view === 'sync-pages') {
  const entries = Array.from({ length: 45 }, (_, index) => ({ id: `event-${index + 1}`, version: index + 1,
    taskId: tasks[0].id, entityType: 'task' as const, entityId: `任务记录-${index + 1}`, action: 'update' as const, actorId: peer.id,
    nodeId: peer.id, timestamp: now, payload: { taskId: tasks[0].id, content: `动态记录-${index + 1}` } }));
  const state = { entries, requests: [] as any[], failPage: 0, delayMs: 0 };
  (window as any).__paginationFixture = state;
  const loadPage = async (request: PageRequest = {}, taskId?: string) => {
    state.requests.push({ ...request, taskId });
    const page = request.page || 1;
    const pageSize = request.pageSize || 20;
    const snapshot = request.snapshot ?? Math.max(0, ...state.entries.map((entry) => entry.version));
    const selected = state.entries.filter((entry) => entry.version <= snapshot).sort((a, b) => b.version - a.version);
    const failed = state.failPage === page;
    if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    if (failed) throw new Error('测试读取失败');
    return { items: selected.slice((page - 1) * pageSize, page * pageSize).map((entry) => ({ ...entry, taskId: taskId || entry.taskId })), total: selected.length, page, pageSize, snapshot, latestVersion: Math.max(0, ...state.entries.map((entry) => entry.version)) };
  };
  ApiService.getTaskActivityPage = (taskId, _userId, request) => loadPage(request, taskId);
  ApiService.getSyncLogsPage = (request) => loadPage(request);
}
ApiService.getProjectFiles = async () => files;
ApiService.getProjectFolders = async () => folders;
ApiService.createProjectFolder = async (_id, path) => { const folder = { ...folders[0], id: 'created', path }; folders.push(folder); return folder; };
ApiService.readProjectFileContent = async () => markdown;
ApiService.getPPTTemplates = async () => [];
ApiService.generateReport = async () => ({
  title: '本周工作汇报',
  type: 'weekly',
  period: '2026-09-14 至 2026-09-20',
  asOf: '2026-09-20',
  generatedAt: now,
  audience: '项目负责人及协作成员',
  keyTakeaway: '本周完成联调验证，下一步集中处理交付时间风险。',
  executiveSummary: '核心功能已经完成验证，仍需确认最终交付时间。',
  metrics: {
    relevantTasksCount: 4,
    completedTasksCount: 1,
    progressedTasksCount: 1,
    pendingTasksCount: 2,
    blockedTasksCount: 1,
    overdueTasksCount: 0,
    upcomingTasksCount: 1,
  },
  sections: [],
  dataNotes: [],
  rawMarkdown: '# 本周工作汇报\n\n> 周期：2026-09-14 至 2026-09-20\n\n## 周期成果\n\n- **联调验证完成**：核心流程已经通过验收。\n\n## 下周计划\n\n- 确认交付时间并整理项目资料。',
  sourceTasks: tasks,
  generationMode: 'ai',
} satisfies GeneratedReport);
localStorage.setItem('lan_chat_groups_v2', JSON.stringify([group]));
localStorage.setItem('lan_chat_messages_v2', JSON.stringify([
  { id: 'm1', senderId: peer.id, senderName: peer.nickname, type: 'text', content: '请大家查看本周的项目安排。', timestamp: now, readBy: [] },
  { id: 'm2', senderId: user.id, senderName: user.nickname, type: 'text', content: '已收到，稍后补充相关资料。', timestamp: now, readBy: [user.id] },
  { id: 'm-group', groupId: group.id, senderId: peer.id, senderName: peer.nickname, type: 'text', content: '群内项目进展记录', timestamp: now, readBy: [user.id] },
]));

function Controls() {
  const { setThemeId, themePreference } = useTheme();
  const [checked, setChecked] = useState(false);
  const [date, setDate] = useState('2026-09-14');
  return <div className="mx-auto max-w-3xl space-y-6 p-8">
    <h1 className="text-main text-xl font-semibold">共用控件</h1>
    <div className="flex gap-3"><button className="theme-btn-primary px-4 py-2">主要操作</button><button className="theme-btn-secondary px-4 py-2">次要操作</button><button disabled className="theme-btn-primary px-4 py-2">不可用</button></div>
    <button data-testid="hover-only" className="px-4 py-2 hover:bg-hover">仅悬停时显示背景</button>
    <input aria-label="测试输入框" className="w-full rounded-lg border px-3 py-2" placeholder="请输入内容" />
    <ThemeSelect ariaLabel={themePreference === 'system' ? '跟随系统' : themePreference === 'navy-slate' ? '深蓝星空' : '钛白明亮'} value={themePreference} onChange={(id) => setThemeId(id as typeof themePreference)} options={[{ value:'system', label:'跟随系统' }, { value:'titanium-light', label:'钛白明亮' }, { value:'navy-slate', label:'深蓝星空' }]} />
    <ThemeCheckbox checked={checked} onChange={setChecked} label="显示已完成" />
    <label className="flex items-center gap-2 text-main"><input type="checkbox" className="desktop-cal-task-checkbox" aria-label="日历任务完成状态" />日历任务完成状态</label>
    <ThemeDatePicker value={date} onChange={setDate} />
    <div className="flex gap-4"><span className="text-info">信息</span><span className="text-success">成功</span><span className="text-warning">警告</span><span className="text-danger">错误</span><span className="text-quiet">辅助文字</span></div>
    <div data-testid="nested-theme" data-theme="navy-slate" className="rounded-lg bg-surface p-4 text-main"><p>独立深色容器</p><div className="chat-bubble-self rounded p-3">自身主题的消息气泡</div><div className="desktop-cal-cell p-3">独立桌面日历</div></div>
  </div>;
}

function Fixture() {
  const [anns, setAnns] = useState([announcement]);
  const [lockTaskOpen, setLockTaskOpen] = useState(false);
  switch(view) {
    case 'app-startup': return <React.StrictMode><StartupFixture params={params} /></React.StrictMode>;
    case 'app-lock': return <AppLockFixture primary={params.get('aux') !== 'true'}><button type="button" onClick={() => setLockTaskOpen(true)}>打开任务编辑器</button><TaskModal isOpen={lockTaskOpen} onClose={() => setLockTaskOpen(false)} taskToEdit={tasks[0]} tasks={tasks} projects={[project]} users={[user,peer]} currentUser={user} onSaveTask={asyncNoop} /></AppLockFixture>;
    case 'activity-pages':
    case 'sync-pages': return <PaginationFixture />;
    case 'files': return <ProjectFilesPanel project={project} users={[user,peer]} currentUser={user} onClose={noop} />;
    case 'markdown': return <FilePreviewModal name="项目说明.md" dataUrl={markdownUrl} onClose={noop} />;
    case 'excel': return <FilePreviewModal name="项目安排.xlsx" dataUrl={excelUrl} onClose={noop} />;
    case 'word': return <FilePreviewModal name="验收说明.docx" dataUrl={docxUrl} onClose={noop} />;
    case 'preview-error': return <FilePreviewModal name="未同步的资料.md" httpUrl="/tests/theme/missing-file" onClose={noop} />;
    case 'announcement': return <><GroupAnnouncementBanner pinnedAnnouncement={announcement} totalAnnouncementsCount={1} onOpenAnnouncementsModal={noop} onDismiss={noop}/><GroupAnnouncementModal isOpen onClose={noop} group={group} currentUserId={user.id} currentUserDisplayName={user.nickname} groupMembers={[user,peer]} announcements={anns} canManage onSaveAnnouncement={async (data) => setAnns([...anns,{...announcement,...data,id:'new'}])} onDeleteAnnouncement={asyncNoop} onPinAnnouncement={asyncNoop} onViewReadReceipts={noop}/></>;
    case 'chat': return <LanChatModal isOpen onClose={noop} currentUser={user} users={[user,peer]} projects={[project]} />;
    case 'group': return <EditGroupModal isOpen onClose={noop} group={group} projects={[project]} currentUser={user} onGroupUpdated={noop} />;
    case 'forward': return <ForwardMessageModal isOpen onClose={noop} message={message} users={[user,peer]} groups={[group]} currentUserId={user.id} onForward={asyncNoop} />;
    case 'receipts': return <ReadReceiptsModal isOpen onClose={noop} message={message} groupMembers={[user,peer]} currentUserId={user.id} />;
    case 'chat-files': return <ChatFilesModal isOpen onClose={noop} messages={[message]} onDownloadFile={noop} />;
    case 'profile': return <UserProfileModal isOpen onClose={noop} currentUser={user} onUserUpdated={noop} />;
    case 'sync': return <SyncMonitorModal isOpen onClose={noop} syncVersion={1} />;
    case 'risk': return <RiskAlertsModal isOpen onClose={noop} />;
    case 'llm': return <LLMConfigModal isOpen onClose={noop} />;
    case 'theme': return <ThemeModal isOpen onClose={noop} />;
    case 'task': return <TaskModal isOpen onClose={noop} taskToEdit={tasks[0]} tasks={tasks} projects={[project]} users={[user,peer]} currentUser={user} onSaveTask={asyncNoop} />;
    case 'project': return <ProjectModal isOpen onClose={noop} projectToEdit={project} users={[user,peer]} currentUser={user} onProjectSaved={asyncNoop} onProjectDeleted={asyncNoop} />;
    case 'settings': return <SettingsModal isOpen onClose={noop} shortcuts={DEFAULT_SHORTCUTS} onSaveShortcuts={asyncNoop} currentUserId={user.id} onTasksImported={asyncNoop} defaultTab={(params.get('tab') || 'basic') as SettingsTab} />;
    case 'network-settings': return <SettingsModal isOpen onClose={noop} shortcuts={DEFAULT_SHORTCUTS} onSaveShortcuts={asyncNoop} currentUserId={user.id} onTasksImported={asyncNoop} defaultTab="web" />;
    case 'report': return <LLMReportStudio projects={[project]} currentUser={user} />;
    case 'calendar-window': return <DesktopCalendarWindow />;
    case 'notification': return <NotificationWindow />;
    case 'quick-add': return <QuickAddWindow />;
    case 'controls': return <Controls />;
    default: return <App />;
  }
}

function PaginationFixture() {
  const [open, setOpen] = useState(true);
  const [taskIndex, setTaskIndex] = useState(0);
  return <><button type="button" onClick={() => setOpen(true)}>重新打开日志</button><button type="button" onClick={() => { setTaskIndex(1); setOpen(true); }}>查看另一任务动态</button>
    {view === 'sync-pages' ? <SyncMonitorModal isOpen={open} syncVersion={45} onClose={() => setOpen(false)} />
      : open && <TaskActivityModal task={tasks[taskIndex]} currentUser={user} users={[user, peer]} onClose={() => setOpen(false)} />}</>;
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><Fixture /></ThemeProvider>);
