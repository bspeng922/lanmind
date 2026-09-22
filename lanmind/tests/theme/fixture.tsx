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
import type { GeneratedReport, Project, ProjectFile, ProjectFolder, Task, User, LanChatGroup, LanGroupAnnouncement } from '../../src/types';
import '../../src/index.css';
import { docxUrl } from './document';

const params = new URLSearchParams(location.search);
const view = params.get('view') || 'files';
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
ApiService.getUsers = async () => [user, peer];
ApiService.getProjects = async () => [project];
ApiService.getTasks = async () => tasks;
ApiService.getRiskWarnings = async () => [];
ApiService.getSyncLogs = async () => ({ logs: [], latestVersion: 1 });
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
  switch(view) {
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
    case 'task': return <TaskModal isOpen onClose={noop} taskToEdit={tasks[0]} projects={[project]} users={[user,peer]} currentUser={user} onSaveTask={asyncNoop} />;
    case 'project': return <ProjectModal isOpen onClose={noop} projectToEdit={project} users={[user,peer]} currentUser={user} onProjectSaved={asyncNoop} onProjectDeleted={asyncNoop} />;
    case 'settings': return <SettingsModal isOpen onClose={noop} shortcuts={DEFAULT_SHORTCUTS} onSaveShortcuts={asyncNoop} currentUserId={user.id} onTasksImported={asyncNoop} defaultTab={(params.get('tab') || 'basic') as SettingsTab} />;
    case 'report': return <LLMReportStudio projects={[project]} currentUser={user} />;
    case 'calendar-window': return <DesktopCalendarWindow />;
    case 'notification': return <NotificationWindow />;
    case 'quick-add': return <QuickAddWindow />;
    case 'controls': return <Controls />;
    default: return <App />;
  }
}

createRoot(document.getElementById('root')!).render(<ThemeProvider><Fixture /></ThemeProvider>);
