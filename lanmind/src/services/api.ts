/**
 * Renderer-to-runtime boundary.
 *
 * The desktop branches call trusted Rust commands through Tauri IPC. The HTTP
 * branches exist only for the browser prototype and must not be used to infer
 * desktop persistence, P2P, tray, or global-shortcut behavior.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from '@tauri-apps/plugin-autostart';
import {
  User,
  Project,
  ProjectFile,
  ProjectFolder,
  Task,
  ChangeLog,
  LLMConfig,
  PPTTemplate,
  ReportType,
  GeneratedReport,
  GeneratedPresentation,
  ReportGenerationRequest,
  RiskWarning,
  QuickParseResult,
  TaskAssignmentNotification,
  LanChatGroup,
  LanGroupAnnouncement,
  LanChatMessage,
} from '../types';

export interface NetworkPeer {
  deviceId: string;
  userId: string;
  displayName: string;
  address: string;
  lastSeen: string;
}

export interface NetworkStatus {
  nodeId: string;
  workspaceId: string;
  listeningPort: number;
  peers: NetworkPeer[];
}

export interface FileOffer {
  transferId: string;
  sourceNodeId: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  url: string;
}

export interface GlobalShortcutBinding {
  action: string;
  accelerator: string;
}

export interface McpStatus {
  enabled: boolean;
  port: number;
  token: string;
  running: boolean;
  endpoint: string;
  error?: string | null;
}

export interface TaskExportResult {
  exportedCount: number;
  path: string;
}

export interface TaskImportResult {
  importedCount: number;
  skippedCount: number;
  convertedCount: number;
}

const desktop = () => isTauri();

export class ApiService {
  private static getHeaders(currentUserId?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (currentUserId) headers['x-user-id'] = currentUserId;
    return headers;
  }

  static async getBootstrap(): Promise<{ workspaceId: string; workspaceName: string; currentUser: User; deviceId: string } | null> {
    return desktop() ? invoke('get_bootstrap') : null;
  }

  static async getUsers(): Promise<User[]> {
    if (desktop()) return invoke('get_users');
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error('Failed to fetch users');
    return res.json();
  }

  static async setIdentity(user: Partial<User> & { id: string }): Promise<User> {
    if (desktop()) return invoke('set_identity', { user });
    const res = await fetch('/api/users/identity', { method: 'POST', headers: this.getHeaders(user.id), body: JSON.stringify(user) });
    if (!res.ok) throw new Error('Failed to set identity');
    return res.json();
  }

  static async getProjects(currentUserId?: string): Promise<Project[]> {
    if (desktop()) return invoke('get_projects', { currentUserId });
    const res = await fetch('/api/projects', { headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw new Error('Failed to fetch projects');
    return res.json();
  }

  static async createProject(proj: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>, currentUserId: string): Promise<Project> {
    if (desktop()) return invoke('create_project', { project: proj, currentUserId });
    const res = await fetch('/api/projects', { method: 'POST', headers: this.getHeaders(currentUserId), body: JSON.stringify(proj) });
    if (!res.ok) throw new Error('Failed to create project');
    return res.json();
  }

  static async updateProject(id: string, updates: Partial<Project>, currentUserId: string): Promise<Project> {
    if (desktop()) return invoke('update_project', { id, updates, currentUserId });
    const res = await fetch(`/api/projects/${id}`, { method: 'PUT', headers: this.getHeaders(currentUserId), body: JSON.stringify(updates) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update project');
    return data;
  }

  static async transferProject(id: string, targetUserId: string, currentUserId: string): Promise<Project> {
    if (desktop()) return invoke('transfer_project', { id, targetUserId, currentUserId });
    const res = await fetch(`/api/projects/${id}/transfer`, {
      method: 'POST',
      headers: this.getHeaders(currentUserId),
      body: JSON.stringify({ targetUserId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to transfer project');
    return data;
  }

  static async deleteProject(id: string, currentUserId: string): Promise<boolean> {
    if (desktop()) return invoke('delete_project', { id, currentUserId });
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE', headers: this.getHeaders(currentUserId) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete project');
    return Boolean(data.success);
  }

  static async getTasks(currentUserId?: string): Promise<Task[]> {
    if (desktop()) return invoke('get_tasks', { currentUserId });
    const res = await fetch('/api/tasks', { headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw new Error('Failed to fetch tasks');
    return res.json();
  }

  static async exportTasks(path: string, currentUserId: string): Promise<TaskExportResult> {
    if (!desktop()) throw new Error('任务数据导出仅在桌面端可用');
    return invoke('export_tasks', { path, currentUserId });
  }

  static async importTasks(path: string, currentUserId: string): Promise<TaskImportResult> {
    if (!desktop()) throw new Error('任务数据导入仅在桌面端可用');
    return invoke('import_tasks', { path, currentUserId });
  }

  static async getAutostartEnabled(): Promise<boolean> {
    if (!desktop()) return false;
    return isAutostartEnabled();
  }

  static async setAutostartEnabled(enabled: boolean): Promise<boolean> {
    if (!desktop()) throw new Error('开机启动仅在桌面端可用');
    if (enabled) await enableAutostart();
    else await disableAutostart();
    return isAutostartEnabled();
  }

  static async createTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'version'>, currentUserId: string): Promise<Task> {
    if (desktop()) return invoke('create_task', { task, currentUserId });
    const res = await fetch('/api/tasks', { method: 'POST', headers: this.getHeaders(currentUserId), body: JSON.stringify(task) });
    if (!res.ok) throw new Error('Failed to create task');
    return res.json();
  }

  static async updateTask(id: string, updates: Partial<Task>, currentUserId: string): Promise<Task> {
    if (desktop()) return invoke('update_task', { id, updates, currentUserId });
    const res = await fetch(`/api/tasks/${id}`, { method: 'PUT', headers: this.getHeaders(currentUserId), body: JSON.stringify(updates) });
    if (!res.ok) throw new Error('Failed to update task');
    return res.json();
  }

  static async deleteTask(id: string, currentUserId: string): Promise<boolean> {
    if (desktop()) return invoke('delete_task', { id, currentUserId });
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE', headers: this.getHeaders(currentUserId) });
    const data = await res.json();
    return data.success;
  }

  static async getSyncLogs(sinceVersion = 0): Promise<{ logs: ChangeLog[]; latestVersion: number }> {
    if (desktop()) return invoke('get_sync_logs', { sinceVersion });
    const res = await fetch(`/api/sync/logs?since=${sinceVersion}`);
    if (!res.ok) throw new Error('Failed to fetch sync logs');
    return res.json();
  }

  static async getRiskWarnings(currentUserId?: string): Promise<RiskWarning[]> {
    if (desktop()) return invoke('get_risk_warnings', { currentUserId });
    const res = await fetch('/api/sync/risk-warnings');
    if (!res.ok) throw new Error('Failed to fetch risk warnings');
    return res.json();
  }

  static async getTaskAssignmentNotifications(currentUserId: string): Promise<TaskAssignmentNotification[]> {
    if (!desktop()) return [];
    return invoke('get_task_assignment_notifications', { currentUserId });
  }

  static async markTaskAssignmentNotificationsRead(ids: string[], currentUserId: string): Promise<number> {
    if (!desktop() || ids.length === 0) return 0;
    return invoke('mark_task_assignment_notifications_read', { ids, currentUserId });
  }

  static async getNetworkStatus(): Promise<NetworkStatus | null> {
    return desktop() ? invoke('get_network_status') : null;
  }

  static async syncNow(): Promise<NetworkStatus | null> {
    return desktop() ? invoke('sync_now') : null;
  }

  static async registerFileForTransfer(path: string): Promise<FileOffer> {
    if (!desktop()) throw new Error('文件传输需要桌面节点');
    return invoke('register_file_for_transfer', { path });
  }

  static async downloadFileFromPeer(url: string, destination: string): Promise<string> {
    if (!desktop()) throw new Error('文件传输需要桌面节点');
    return invoke('download_file_from_peer', { url, destination });
  }

  static async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    if (desktop()) {
      const raw = await invoke<any[]>('get_project_files', { projectId });
      return (raw || []).map((file: any) => ({
        ...file,
        size: Number(file.size ?? file.sizeBytes ?? 0),
        type: file.type || file.mimeType || 'application/octet-stream',
      }));
    }
    try {
      const saved = JSON.parse(localStorage.getItem(`lanmind_project_files:${projectId}`) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  static async getProjectFolders(projectId: string): Promise<ProjectFolder[]> {
    if (desktop()) return invoke('get_project_folders', { projectId });
    try {
      const saved = JSON.parse(localStorage.getItem(`lanmind_project_files:${projectId}:folders`) || '[]');
      return Array.isArray(saved)
        ? saved.map((p: string, i: number) => ({
            id: `fld-${i}`,
            projectId,
            path: p,
            createdBy: '',
            createdAt: '',
          }))
        : [];
    } catch {
      return [];
    }
  }

  static async saveProjectFile(
    projectId: string,
    name: string,
    relativePath: string,
    base64Content: string,
    mimeType: string,
    currentUserId: string
  ): Promise<ProjectFile> {
    if (desktop()) {
      return invoke('save_project_file', {
        projectId,
        name,
        relativePath,
        base64Content,
        mimeType,
        currentUserId,
      });
    }
    const record: ProjectFile = {
      id: `pf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      projectId,
      name,
      relativePath,
      size: Math.round(base64Content.length * 0.75),
      type: mimeType,
      dataUrl: `data:${mimeType};base64,${base64Content}`,
      uploadedBy: currentUserId,
      uploadedAt: new Date().toISOString(),
      isLocal: true,
    };
    try {
      const list = await this.getProjectFiles(projectId);
      localStorage.setItem(`lanmind_project_files:${projectId}`, JSON.stringify([record, ...list]));
    } catch {
      /* storage quota */
    }
    return record;
  }

  static async uploadProjectFilesFromPaths(
    projectId: string,
    targetDirectory: string,
    paths: string[],
    currentUserId: string
  ): Promise<ProjectFile[]> {
    if (desktop()) {
      const raw = await invoke<any[]>('upload_project_files_from_paths', {
        projectId,
        targetDirectory,
        paths,
        currentUserId,
      });
      return (raw || []).map((file: any) => ({
        ...file,
        size: Number(file.size ?? file.sizeBytes ?? 0),
        type: file.type || file.mimeType || 'application/octet-stream',
      }));
    }
    return [];
  }

  static async deleteProjectFile(fileId: string, currentUserId: string): Promise<boolean> {
    if (desktop()) return invoke('delete_project_file', { fileId, currentUserId });
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('lanmind_project_files:') || key.endsWith(':folders')) continue;
      try {
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(list) && list.some((file) => file?.id === fileId)) {
          localStorage.setItem(key, JSON.stringify(list.filter((file) => file?.id !== fileId)));
          return true;
        }
      } catch { /* ignore malformed browser data */ }
    }
    return true;
  }

  static async createProjectFolder(
    projectId: string,
    path: string,
    currentUserId: string
  ): Promise<ProjectFolder> {
    if (desktop()) return invoke('create_project_folder', { projectId, path, currentUserId });
    const record = {
      id: `fld-${Date.now()}`,
      projectId,
      path,
      createdBy: currentUserId,
      createdAt: new Date().toISOString(),
    };
    const key = `lanmind_project_files:${projectId}:folders`;
    try {
      const paths = JSON.parse(localStorage.getItem(key) || '[]');
      localStorage.setItem(key, JSON.stringify(Array.from(new Set([...(Array.isArray(paths) ? paths : []), path]))));
    } catch { /* ignore storage quota */ }
    return record;
  }

  static async deleteProjectFolder(folderId: string, currentUserId: string, projectId?: string, folderPath?: string): Promise<boolean> {
    if (desktop()) return invoke('delete_project_folder', { folderId, currentUserId });
    if (projectId && folderPath) {
      const folderKey = `lanmind_project_files:${projectId}:folders`;
      try {
        const folders = JSON.parse(localStorage.getItem(folderKey) || '[]');
        localStorage.setItem(folderKey, JSON.stringify(Array.isArray(folders) ? folders.filter((path) => path !== folderPath && !String(path).startsWith(`${folderPath}/`)) : []));
        const fileKey = `lanmind_project_files:${projectId}`;
        const files = JSON.parse(localStorage.getItem(fileKey) || '[]');
        localStorage.setItem(fileKey, JSON.stringify(Array.isArray(files) ? files.filter((file) => !String(file?.relativePath || file?.name).startsWith(`${folderPath}/`) && file?.relativePath !== folderPath) : []));
      } catch { /* ignore malformed browser data */ }
    }
    return true;
  }

  static async readProjectFileContent(projectId: string, fileId: string): Promise<string> {
    if (desktop()) return invoke('read_project_file_content', { projectId, fileId });
    throw new Error('仅在桌面模式支持读取文件内容');
  }

  static async downloadProjectFileTo(
    projectId: string,
    fileId: string,
    destinationPath: string
  ): Promise<string> {
    if (desktop()) return invoke('download_project_file_to', { projectId, fileId, destinationPath });
    throw new Error('仅在桌面模式支持下载文件');
  }

  static async saveFileToPath(
    dataUrl: string,
    destinationPath: string
  ): Promise<string> {
    if (desktop()) return invoke('save_file_to_path', { dataUrl, destinationPath });
    throw new Error('仅在桌面模式支持保存文件');
  }

  static async showItemInFolder(path: string): Promise<void> {
    if (desktop()) return invoke('show_item_in_folder', { path });
  }

  static async setGlobalShortcuts(bindings: GlobalShortcutBinding[]): Promise<void> {
    if (!desktop()) return;
    return invoke('set_global_shortcuts', { bindings });
  }

  static async getMcpStatus(): Promise<McpStatus> {
    if (!desktop()) throw new Error('MCP 服务仅在桌面端可用');
    return invoke('get_mcp_status');
  }

  static async updateMcpConfig(enabled: boolean, port: number): Promise<McpStatus> {
    if (!desktop()) throw new Error('MCP 服务仅在桌面端可用');
    return invoke('update_mcp_config', { enabled, port });
  }

  static async rotateMcpToken(): Promise<McpStatus> {
    if (!desktop()) throw new Error('MCP 服务仅在桌面端可用');
    return invoke('rotate_mcp_token');
  }

  static async getLLMConfig(): Promise<LLMConfig> {
    if (desktop()) return invoke('get_llm_config');
    const res = await fetch('/api/llm/config');
    if (!res.ok) throw new Error('Failed to fetch LLM config');
    return res.json();
  }

  static async updateLLMConfig(config: Partial<LLMConfig>): Promise<LLMConfig> {
    if (desktop()) return invoke('update_llm_config', { config });
    const res = await fetch('/api/llm/config', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(config) });
    if (!res.ok) throw new Error('Failed to update LLM config');
    return res.json();
  }

  static async testLLMConnection(config: { protocol: string; baseUrl: string; apiKey: string; modelName: string }): Promise<{ success: boolean; message?: string; error?: string; latencyMs?: number }> {
    if (desktop()) return invoke('test_llm_connection', { config });
    const res = await fetch('/api/llm/test', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(config) });
    return res.json();
  }

  static async fetchLLMModels(config: { baseUrl: string; apiKey?: string }): Promise<{ success: boolean; models?: string[]; error?: string }> {
    if (desktop()) return invoke('fetch_llm_models', { config });
    const res = await fetch('/api/llm/models', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(config) });
    return res.json();
  }

  static async getPPTTemplates(): Promise<PPTTemplate[]> {
    if (desktop()) return invoke('get_ppt_templates');
    const res = await fetch('/api/ppt/templates');
    if (!res.ok) throw new Error('Failed to fetch PPT templates');
    return res.json();
  }

  static async addPPTTemplate(template: PPTTemplate): Promise<PPTTemplate> {
    if (desktop()) return invoke('add_ppt_template', { template });
    const res = await fetch('/api/ppt/templates', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(template) });
    if (!res.ok) throw new Error('Failed to save custom PPT template');
    return res.json();
  }

  static async quickParseTask(input: string): Promise<QuickParseResult> {
    if (desktop()) return invoke('quick_parse_task', { input });
    const res = await fetch('/api/llm/quick-parse', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ input }) });
    if (!res.ok) throw new Error('Failed to parse quick task');
    return res.json();
  }

  static async generateReport(params: ReportGenerationRequest): Promise<GeneratedReport> {
    if (desktop()) return invoke('generate_report', { params });
    const res = await fetch('/api/llm/generate-report', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(params) });
    if (!res.ok) {
      const error = await res.json().catch(() => null);
      throw new Error(error?.error || '生成工作汇报失败');
    }
    return res.json();
  }

  static async generatePresentationPlan(params: ReportGenerationRequest): Promise<GeneratedPresentation> {
    if (desktop()) return invoke('generate_presentation_plan', { params });
    const res = await fetch('/api/llm/generate-presentation-plan', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => null);
      throw new Error(error?.error || '生成汇报 PPT 方案失败');
    }
    return res.json();
  }

  static async getChatMessages(currentUserId: string, targetId?: string): Promise<LanChatMessage[]> {
    if (!desktop()) return [];
    return invoke('get_chat_messages', { currentUserId, targetId });
  }

  static async clearChatMessages(
    currentUserId: string,
    conversationType: 'broadcast' | 'user' | 'group',
    targetId?: string,
  ): Promise<number> {
    if (!desktop()) return 0;
    return invoke('clear_chat_messages', { currentUserId, conversationType, targetId });
  }

  static async sendChatMessage(message: Omit<LanChatMessage, 'id' | 'timestamp'>): Promise<LanChatMessage> {
    if (!desktop()) throw new Error('聊天同步仅在桌面端可用');
    return invoke('send_chat_message', { message });
  }

  static async deleteChatMessage(messageId: string, operator?: string): Promise<void> {
    if (!desktop()) return;
    return invoke('delete_chat_message', { messageId, currentUserId: operator || '' });
  }

  static async markChatMessagesRead(messageIds: string[], readerId?: string): Promise<LanChatMessage[]> {
    if (!desktop() || messageIds.length === 0) return [];
    return invoke('mark_chat_messages_read', { messageIds, readerId: readerId || '' });
  }

  static async getChatGroups(): Promise<LanChatGroup[]> {
    if (!desktop()) return [];
    return invoke('get_chat_groups');
  }

  static async saveChatGroup(group: LanChatGroup): Promise<LanChatGroup> {
    if (!desktop()) throw new Error('群组同步仅在桌面端可用');
    return invoke('save_chat_group', { group });
  }

  static async updateChatGroupMembers(
    groupId: string,
    memberIds: string[],
    currentUserId: string,
  ): Promise<LanChatGroup> {
    if (!desktop()) throw new Error('群成员管理仅在桌面端可用');
    return invoke('update_chat_group_members', { groupId, memberIds, currentUserId });
  }

  static async updateChatGroupProfile(
    groupId: string,
    name: string,
    description?: string,
    avatar?: string,
    projectId?: string,
    currentUserId?: string,
  ): Promise<LanChatGroup> {
    if (!desktop()) throw new Error('群组设置仅在桌面端可用');
    return invoke('update_chat_group_profile', {
      groupId,
      name,
      description,
      avatar,
      projectId,
      currentUserId: currentUserId || '',
    });
  }

  static async getGroupAnnouncements(groupId: string): Promise<LanGroupAnnouncement[]> {
    if (!desktop()) return [];
    return invoke('get_group_announcements', { groupId });
  }

  static async saveGroupAnnouncement(
    announcement: Partial<LanGroupAnnouncement>,
    currentUserId?: string,
  ): Promise<LanGroupAnnouncement> {
    if (!desktop()) throw new Error('群公告发布仅在桌面端可用');
    return invoke('save_group_announcement', { announcement, currentUserId: currentUserId || null });
  }

  static async deleteGroupAnnouncement(
    announcementId: string,
    currentUserId?: string,
  ): Promise<void> {
    if (!desktop()) throw new Error('群公告删除仅在桌面端可用');
    return invoke('delete_group_announcement', { announcementId, currentUserId: currentUserId || null });
  }

  static async pinGroupAnnouncement(
    announcementId: string,
    pinned: boolean,
    currentUserId?: string,
  ): Promise<LanGroupAnnouncement> {
    if (!desktop()) throw new Error('群公告置顶仅在桌面端可用');
    return invoke('pin_group_announcement', { announcementId, pinned, currentUserId: currentUserId || null });
  }

  static async markGroupAnnouncementRead(
    announcementId: string,
    readerId?: string,
  ): Promise<LanGroupAnnouncement> {
    if (!desktop()) throw new Error('标记群公告已读仅在桌面端可用');
    return invoke('mark_group_announcement_read', { announcementId, readerId: readerId || null });
  }

  static async toggleDesktopCalendar(): Promise<boolean> {
    if (!desktop()) return false;
    return invoke('toggle_desktop_calendar');
  }

  static async showDesktopCalendar(): Promise<boolean> {
    if (!desktop()) return false;
    return invoke('show_desktop_calendar');
  }

  static async hideDesktopCalendar(): Promise<boolean> {
    if (!desktop()) return false;
    return invoke('hide_desktop_calendar');
  }

  static async isDesktopCalendarVisible(): Promise<boolean> {
    if (!desktop()) return false;
    return invoke('is_desktop_calendar_visible');
  }

  static async setDesktopCalendarAdjustMode(enabled: boolean): Promise<void> {
    if (!desktop()) return;
    return invoke('set_desktop_calendar_adjust_mode', { enabled });
  }

  static async setDesktopCalendarBounds(x: number, y: number, width: number, height: number): Promise<void> {
    if (!desktop()) return;
    return invoke('set_desktop_calendar_bounds', {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    });
  }

  static async getDesktopCalendarConfig(): Promise<{
    enabled: boolean;
    x?: number | null;
    y?: number | null;
    width?: number | null;
    height?: number | null;
    opacity?: number | null;
    showCompleted?: boolean | null;
    themeTone?: 'system' | 'custom' | null;
    customColor?: string | null;
  } | null> {
    if (!desktop()) return null;
    return invoke('get_desktop_calendar_config');
  }

  static async setDesktopCalendarOpacity(opacity: number): Promise<void> {
    if (!desktop()) return;
    return invoke('set_desktop_calendar_opacity', { opacity: Math.max(0, Math.min(90, Math.round(opacity))) });
  }

  static async setDesktopCalendarShowCompleted(showCompleted: boolean): Promise<void> {
    if (!desktop()) return;
    return invoke('set_desktop_calendar_show_completed', { showCompleted });
  }

  static async setDesktopCalendarThemeTone(themeTone: 'system' | 'custom'): Promise<void> {
    if (!desktop()) return;
    return invoke('set_desktop_calendar_theme_tone', { themeTone });
  }

  static async setDesktopCalendarCustomColor(customColor: string): Promise<void> {
    if (!desktop()) return;
    return invoke('set_desktop_calendar_custom_color', { customColor });
  }


  static async setDesktopCalendarInteractiveMode(enabled: boolean): Promise<void> {
    if (!desktop()) return;
    return invoke('set_desktop_calendar_interactive_mode', { enabled });
  }

  static async getQuickAddPosition(): Promise<{ x: number; y: number } | null> {
    if (!desktop()) return null;
    return invoke('get_quick_add_position');
  }

  static async setQuickAddPosition(x: number, y: number): Promise<void> {
    if (!desktop()) return;
    return invoke('set_quick_add_position', {
      x: Math.round(x),
      y: Math.round(y),
    });
  }

  static async showNotificationWindow(notification: {
    id: string;
    kind: 'assignment' | 'message' | 'reminder';
    title: string;
    body: string;
    createdAt?: string;
    themeId?: string;
    themePreference?: string;
  }): Promise<void> {
    if (!desktop()) return;
    return invoke('show_notification_window', { notification });
  }

  static async getPendingNotifications(): Promise<Array<{
    id: string;
    kind: 'assignment' | 'message' | 'reminder';
    title: string;
    body: string;
    createdAt?: string;
    themeId?: string;
    themePreference?: string;
  }>> {
    if (!desktop()) return [];
    return invoke('get_pending_notifications');
  }
}
