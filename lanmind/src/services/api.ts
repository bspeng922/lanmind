import { getWorkspaceContext, setWorkspaceContext, sameWorkspace, migrateWorkspaceStorage, clearWorkspaceStorage, scopedStorageKey, type WorkspaceContext } from "../utils/workspaceContext";
import { tr } from "../i18n/core";
/**
 * Renderer-to-runtime boundary.
 *
 * The desktop branches call trusted Rust commands through Tauri IPC. The HTTP
 * branches exist only for the browser prototype and must not be used to infer
 * desktop persistence, P2P, tray, or global-shortcut behavior.
 */
import { invoke as tauriInvoke, isTauri, Channel } from '@tauri-apps/api/core';
import { localizedError } from '../i18n/messages';
import { currentLocale } from '../i18n/core';
import type { LocaleState } from '../i18n/preferences';
import type { LocalePreference } from '../i18n/registry';
import type { PageRequest, RecordPage, SyncLogPage } from '../types';
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
  TaskComment,
  TaskActivity,
  ChildTaskDraft,
  LanChatGroup,
  LanGroupAnnouncement,
  LanChatMessage,
  ChatUnreadSummary,
  ChatSearchPage,
  ChatMessagePage,
  LocalDirectory,
  Workspace,
  WorkspaceMember,
  WorkItemState,
  ClearDataOptions,
  ClearDataResult,
} from '../types';

export type CloseButtonBehavior = 'tray' | 'exit';

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

export interface WebStatus {
  readOnly: boolean;
  enabled: boolean;
  bindAddress: '0.0.0.0' | '127.0.0.1';
  port: number;
  passwordConfigured: boolean;
  running: boolean;
  endpoint: string;
  error?: string | null;
}

export interface AppLockStatus {
  revision: number;
  enabled: boolean;
  idleMinutes: number;
  passwordConfigured: boolean;
  locked: boolean;
}

export interface TaskExportResult {
  exportedCount: number;
  path: string;
}

export interface TaskImportResult {
  importedCount: number;
  restoredCount: number;
  skippedCount: number;
  convertedCount: number;
}

const desktop = () => isTauri();

let contextRequest: Promise<WorkspaceContext> | null = null;
export async function ensureWorkspaceContext(): Promise<WorkspaceContext> {
  const current = getWorkspaceContext();
  if (current) return current;
  if (!contextRequest) contextRequest = tauriInvoke<WorkspaceContext>('get_workspace_context').then(value => {
    setWorkspaceContext(value);
    try { migrateWorkspaceStorage(value); } catch (error) { console.error('Workspace storage migration failed', error); }
    return value;
  }).finally(() => { contextRequest = null; });
  return contextRequest;
}
export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    const exempt = ['get_workspace_context','get_bootstrap','get_workspace','get_workspaces','get_locale_settings','set_locale_preference'].includes(command);
    const context = exempt ? null : await ensureWorkspaceContext();
    const result = await tauriInvoke<T>(command, { ...args, ...(context ? { workspaceContext: context } : {}) });
    if (context && !['switch_workspace', 'delete_workspace', 'dissolve_workspace'].includes(command) && !sameWorkspace(context)) throw new Error('工作区已切换，请重新载入后操作');
    if (command === 'get_bootstrap') await ensureWorkspaceContext();
    return result;
  } catch (error) { throw localizedError(error); }
}

// Every webview follows the same switch event, including Quick Add and Calendar.
if (isTauri()) {
  void import('@tauri-apps/api/event').then(({ listen }) => listen<{ action: string; dissolvedWorkspaceId?: string }>('workspace://changed', event => {
    if (!['switched','deleted','dissolved'].includes(event.payload.action)) return;
    const previous=getWorkspaceContext();
    if (event.payload.dissolvedWorkspaceId) {
      try { clearWorkspaceStorage(event.payload.dissolvedWorkspaceId, previous); }
      catch (error) { console.error('Failed to clear dissolved workspace caches', error); }
    }
    if (previous) setWorkspaceContext({...previous,revision:-1});
    window.dispatchEvent(new Event('workspace:invalidated'));
    window.location.reload();
  }));
}

export const TASKS_CHANGED_EVENT = 'tasks://changed';

export class ApiService {
  static async saveWikiChanges(payload: unknown, scope = getWorkspaceContext()): Promise<{ documents: import('../components/wiki/wikiTypes').WikiDocument[] }> {
    if (!desktop() || !scope) throw new Error('Wiki persistence requires a workspace');
    return tauriInvoke('save_wiki_changes', { payload, workspaceContext: scope });
  }

  static async getWorkspaceData(feature: 'wiki' | 'ai' | 'wikiView'): Promise<unknown | null> {
    return desktop() ? invoke('get_workspace_data', { feature }) : null;
  }
  static async saveWorkspaceData(feature: 'wiki' | 'ai' | 'wikiView', payload: unknown, scope = getWorkspaceContext()): Promise<void> {
    if (desktop() && scope) await tauriInvoke('save_workspace_data', { feature, payload, workspaceContext:scope });
  }

  static async getLocaleSettings(): Promise<LocaleState | null> {
    return desktop() ? invoke('get_locale_settings') : null;
  }
  static async setLocalePreference(preference: LocalePreference): Promise<LocaleState> {
    return invoke('set_locale_preference', { preference });
  }
  static async resizeNotificationWindow(height: number): Promise<void> {
    if (desktop()) await invoke('resize_notification_window', { height });
  }
  private static getHeaders(currentUserId?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept-Language': currentLocale() };
    if (currentUserId) headers['x-user-id'] = currentUserId;
    return headers;
  }

  static async getBootstrap(): Promise<{ workspaceId: string; workspaceName: string; workspace?: Workspace; currentUser: User; deviceId: string } | null> {
    return desktop() ? invoke('get_bootstrap') : null;
  }

  /** 读取当前工作区。桌面端返回规范化后的工作区实体。 */
  static async getWorkspace(): Promise<Workspace | null> {
    return desktop() ? invoke('get_workspace') : null;
  }

  /** 获取所有工作区列表 */
  static async getWorkspaces(): Promise<Workspace[]> {
    if (desktop()) return invoke('get_workspaces');
    const ws = await this.getWorkspace();
    return ws ? [ws] : [];
  }

  /** 创建新工作区 */
  static async createWorkspace(name: string, slug?: string, timezone?: string, currentUserId: string = ''): Promise<Workspace> {
    if (desktop()) return invoke('create_workspace', { name, slug: slug || null, timezone: timezone || null, currentUserId });
    throw new Error('Web preview does not support creating workspaces');
  }

  /** 删除工作区 */
  static async deleteWorkspace(workspaceId: string, currentUserId: string): Promise<void> {
    if (desktop()) return invoke('delete_workspace', { workspaceId, currentUserId });
    throw new Error('Web preview does not support deleting workspaces');
  }

  /** 解散工作区，持久化解散记录并通知其他设备。 */
  static async dissolveWorkspace(workspaceId: string, currentUserId: string, confirmationName: string): Promise<Workspace> {
    if (desktop()) return invoke('dissolve_workspace', { workspaceId, currentUserId, confirmationName });
    throw new Error('Web preview does not support dissolving workspaces');
  }

  /** 切换活动工作区 */
  static async switchWorkspace(workspaceId: string, currentUserId: string): Promise<Workspace> {
    if (desktop()) {
      const previous = await ensureWorkspaceContext();
      try { return await invoke('switch_workspace', { workspaceId, currentUserId }); }
      catch (error) {
        // A failed network restart restores the previous workspace with a new
        // revision. Refresh that revision so retrying does not reuse stale IPC.
        try {
          const restored = await tauriInvoke<WorkspaceContext>('get_workspace_context');
          if (restored.workspaceId === previous.workspaceId && restored.userId === previous.userId) setWorkspaceContext(restored);
        } catch { /* Keep the original switch error. */ }
        throw error;
      }
    }
    throw new Error('Web preview does not support switching workspaces');
  }

  static async updateWorkspace(updates: Partial<Workspace>, currentUserId: string): Promise<Workspace> {
    if (desktop()) return invoke('update_workspace', { updates, currentUserId });
    const res = await fetch('/api/workspaces/current', {
      method: 'PUT',
      headers: this.getHeaders(currentUserId),
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : tr("common:api.couldNotUpdateWorkspace"));
    return data;
  }

  static async getWorkspaceMembers(currentUserId: string): Promise<WorkspaceMember[]> {
    if (desktop()) return invoke('get_workspace_members', { currentUserId });
    const res = await fetch('/api/workspaces/members', { headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw localizedError(tr("common:api.couldNotLoadWorkspaceMembers"));
    return res.json();
  }

  /** 管理员选择已发现的局域网用户，包括当前离线的设备。 */
  static async getWorkspaceMemberCandidates(currentUserId: string): Promise<User[]> {
    if (desktop()) return invoke('get_workspace_member_candidates', { currentUserId });
    return this.getUsers();
  }

  /** 兼容旧版的成员状态读取；未被管理员添加的用户无法自行加入。 */
  static async requestWorkspaceMembership(workspaceId: string, currentUserId: string): Promise<WorkspaceMember> {
    if (desktop()) return invoke('request_workspace_membership', { workspaceId, currentUserId });
    const res = await fetch('/api/workspaces/membership-requests', {
      method: 'POST',
      headers: this.getHeaders(currentUserId),
      body: JSON.stringify({ workspaceId }),
    });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : tr("common:api.couldNotRequestWorkspaceMembership"));
    return data;
  }

  /** 审批/管理工作区成员角色。仅 owner 与 admin 可调用。 */
  static async reviewWorkspaceMembership(requestId: string, approve: boolean, role: string | undefined, currentUserId: string): Promise<WorkspaceMember> {
    if (desktop()) return invoke('review_workspace_membership', { requestId, approve, role: role || null, currentUserId });
    const res = await fetch(`/api/workspaces/membership-requests/${requestId}`, {
      method: 'POST',
      headers: this.getHeaders(currentUserId),
      body: JSON.stringify({ approve, role }),
    });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : tr("common:api.couldNotReviewWorkspaceMembership"));
    return data;
  }

  /** 修改工作区成员的角色权限 */
  static async updateWorkspaceMemberRole(userId: string, role: string, currentUserId: string): Promise<WorkspaceMember> {
    return this.reviewWorkspaceMembership(userId, true, role, currentUserId);
  }

  /** 从工作区中移除成员 */
  static async removeWorkspaceMember(userId: string, currentUserId: string): Promise<void> {
    await this.reviewWorkspaceMembership(userId, false, undefined, currentUserId);
  }

  /** 向工作区中添加已有局域网成员 */
  static async addWorkspaceMember(userId: string, role: string, currentUserId: string): Promise<WorkspaceMember> {
    return this.reviewWorkspaceMembership(userId, true, role, currentUserId);
  }

  /**
   * 读取工作项状态列表。
   * `projectId` 为 null 时返回个人任务的状态列表。
   */
  static async getStates(projectId: string | null, currentUserId: string): Promise<WorkItemState[]> {
    if (desktop()) return invoke('get_states', { projectId, currentUserId });
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    const res = await fetch(`/api/states${query}`, { headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw localizedError(tr("common:api.couldNotLoadStates"));
    return res.json();
  }

  static async createState(state: Omit<WorkItemState, 'id' | 'createdAt' | 'updatedAt'>, currentUserId: string): Promise<WorkItemState> {
    if (desktop()) return invoke('create_state', { state, currentUserId });
    const res = await fetch('/api/states', {
      method: 'POST',
      headers: this.getHeaders(currentUserId),
      body: JSON.stringify(state),
    });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : tr("common:api.couldNotCreateState"));
    return data;
  }

  static async updateState(id: string, updates: Partial<WorkItemState>, currentUserId: string): Promise<WorkItemState> {
    if (desktop()) return invoke('update_state', { id, updates, currentUserId });
    const res = await fetch(`/api/states/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(currentUserId),
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : tr("common:api.couldNotUpdateState"));
    return data;
  }

  /** 删除状态。仍被工作项引用时后端会拒绝，并在错误信息中给出引用数量。 */
  static async deleteState(id: string, currentUserId: string): Promise<boolean> {
    if (desktop()) return invoke('delete_state', { id, currentUserId });
    const res = await fetch(`/api/states/${id}`, { method: 'DELETE', headers: this.getHeaders(currentUserId) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw localizedError(data.error ? data : tr("common:api.couldNotDeleteState"));
    }
    return true;
  }

  static async reorderStates(projectId: string | null, orderedIds: string[], currentUserId: string): Promise<WorkItemState[]> {
    if (desktop()) return invoke('reorder_states', { projectId, orderedIds, currentUserId });
    const res = await fetch('/api/states/reorder', {
      method: 'POST',
      headers: this.getHeaders(currentUserId),
      body: JSON.stringify({ projectId, orderedIds }),
    });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : tr("common:api.couldNotReorderStates"));
    return data;
  }

  static async setDefaultState(id: string, currentUserId: string): Promise<WorkItemState> {
    if (desktop()) return invoke('set_default_state', { id, currentUserId });
    const res = await fetch(`/api/states/${id}/default`, { method: 'POST', headers: this.getHeaders(currentUserId) });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : tr("common:api.couldNotSetDefaultState"));
    return data;
  }

  static async getUsers(): Promise<User[]> {
    if (desktop()) return invoke('get_users');
    const res = await fetch('/api/users');
    if (!res.ok) throw localizedError('Failed to fetch users');
    return res.json();
  }

  static async getLocalDirectory(): Promise<LocalDirectory> {
    if (desktop()) return invoke('get_local_directory');
    return { units: [], members: [] };
  }

  static async saveLocalDirectory(directory: LocalDirectory): Promise<LocalDirectory> {
    if (desktop()) return invoke('save_local_directory', { directory });
    return directory;
  }

  static async setIdentity(user: Partial<User> & { id: string }): Promise<User> {
    if (desktop()) return invoke('set_identity', { user });
    const res = await fetch('/api/users/identity', { method: 'POST', headers: this.getHeaders(user.id), body: JSON.stringify(user) });
    if (!res.ok) throw localizedError('Failed to set identity');
    return res.json();
  }

  static async getProjects(currentUserId?: string): Promise<Project[]> {
    if (desktop()) return invoke('get_projects', { currentUserId });
    const res = await fetch('/api/projects', { headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw localizedError('Failed to fetch projects');
    return res.json();
  }

  static async createProject(proj: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>, currentUserId: string): Promise<Project> {
    if (desktop()) return invoke('create_project', { project: proj, currentUserId });
    const res = await fetch('/api/projects', { method: 'POST', headers: this.getHeaders(currentUserId), body: JSON.stringify(proj) });
    if (!res.ok) throw localizedError('Failed to create project');
    return res.json();
  }

  static async updateProject(id: string, updates: Partial<Project>, currentUserId: string): Promise<Project> {
    if (desktop()) return invoke('update_project', { id, updates, currentUserId });
    const res = await fetch(`/api/projects/${id}`, { method: 'PUT', headers: this.getHeaders(currentUserId), body: JSON.stringify(updates) });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : 'Failed to update project');
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
    if (!res.ok) throw localizedError(data.error ? data : 'Failed to transfer project');
    return data;
  }

  static async deleteProject(id: string, currentUserId: string): Promise<boolean> {
    if (desktop()) return invoke('delete_project', { id, currentUserId });
    const res = await fetch(`/api/projects/${id}`, { method: 'DELETE', headers: this.getHeaders(currentUserId) });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : 'Failed to delete project');
    return Boolean(data.success);
  }

  static async getTasks(currentUserId?: string): Promise<Task[]> {
    if (desktop()) return invoke('get_tasks', { currentUserId });
    const res = await fetch('/api/tasks', { headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw localizedError('Failed to fetch tasks');
    return res.json();
  }

  static async exportTasks(path: string, currentUserId: string): Promise<TaskExportResult> {
    if (!desktop()) throw localizedError(tr("common:api.taskExportIsOnlyAvailableInThe"));
    return invoke('export_tasks', { path, currentUserId });
  }

  static async saveTextFile(path: string, content: string): Promise<void> {
    if (!desktop()) return;
    return invoke('save_text_file', { path, content });
  }

  static async importTasks(path: string, currentUserId: string): Promise<TaskImportResult> {
    if (!desktop()) throw localizedError(tr("common:api.taskImportIsOnlyAvailableInThe"));
    return invoke('import_tasks', { path, currentUserId });
  }

  static async clearLocalData(options: ClearDataOptions, currentUserId: string): Promise<ClearDataResult> {
    if (desktop()) {
      return invoke('clear_local_data', { options, currentUserId });
    }
    return {
      tasksDeleted: 0,
      taskCommentsDeleted: 0,
      wikiDocumentsDeleted: 0,
      chatMessagesDeleted: 0,
      aiConversationsDeleted: 0,
      aiMessagesDeleted: 0,
      success: true,
      message: '本地数据清理完成',
    };
  }

  static async getCloseButtonBehavior(): Promise<CloseButtonBehavior> {
    if (!desktop()) return 'tray';
    return invoke('get_close_button_behavior');
  }

  static async setCloseButtonBehavior(behavior: CloseButtonBehavior): Promise<CloseButtonBehavior> {
    if (!desktop()) throw localizedError(tr("common:api.closeButtonSettingsAreOnlyAvailableIn"));
    return invoke('set_close_button_behavior', { behavior });
  }

  static async getAutostartEnabled(): Promise<boolean> {
    if (!desktop()) return false;
    return isAutostartEnabled();
  }

  static async setAutostartEnabled(enabled: boolean): Promise<boolean> {
    if (!desktop()) throw localizedError(tr("common:api.startupIsOnlyAvailableInTheDesktop"));
    if (enabled) await enableAutostart();
    else await disableAutostart();
    return isAutostartEnabled();
  }

  static async createTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'version'>, currentUserId: string): Promise<Task> {
    if (desktop()) return invoke('create_task', { task, currentUserId });
    const res = await fetch('/api/tasks', { method: 'POST', headers: this.getHeaders(currentUserId), body: JSON.stringify(task) });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : tr("common:api.couldNotCreateTask"));
    return data;
  }

  static async updateTask(id: string, updates: Partial<Task>, currentUserId: string): Promise<Task> {
    if (desktop()) return invoke('update_task', { id, updates, currentUserId });
    const res = await fetch(`/api/tasks/${id}`, { method: 'PUT', headers: this.getHeaders(currentUserId), body: JSON.stringify(updates) });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : tr("common:api.couldNotUpdateTask"));
    return data;
  }

  static async saveTaskWithChildren(id: string | null, task: Partial<Task>, childTasks: ChildTaskDraft[], detachedChildIds: string[], currentUserId: string, expectedVersion?: number): Promise<Task> {
    if (desktop()) return invoke('save_task_with_children', { id, task, childTasks, detachedChildIds, currentUserId, expectedVersion });
    const res = await fetch('/api/tasks/save-with-children', {
      method: 'POST', headers: this.getHeaders(currentUserId),
      body: JSON.stringify({ id, task, childTasks, detachedChildIds, expectedVersion }),
    });
    const data = await res.json();
    if (!res.ok) throw localizedError(data.error ? data : tr("common:api.couldNotSaveTask"));
    return data;
  }

  static async deleteTask(id: string, currentUserId: string): Promise<boolean> {
    if (desktop()) return invoke('delete_task', { id, currentUserId });
    const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE', headers: this.getHeaders(currentUserId) });
    const data = await res.json();
    return data.success;
  }

  static async taskRecycle<T>(action: 'list' | 'detail' | 'trash' | 'restore' | 'purge', request: Record<string, unknown>, currentUserId: string): Promise<T> {
    if (desktop()) return invoke('task_recycle', { action, request });
    const response = await fetch(`/api/task-recycle/${action}`, { method: 'POST', headers: this.getHeaders(currentUserId), body: JSON.stringify(request) });
    const data = await response.json();
    if (!response.ok) throw localizedError(data.error ? data : tr('tasks:recycle.failed'));
    return data;
  }

  static async getTaskComments(taskId: string, currentUserId: string): Promise<TaskComment[]> {
    if (desktop()) return invoke('get_task_comments', { taskId, currentUserId });
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`, { headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw localizedError('Failed to fetch task comments');
    return res.json();
  }

  static async createTaskComment(taskId: string, content: string, currentUserId: string, replyToCommentId?: string): Promise<TaskComment> {
    if (desktop()) return invoke('create_task_comment', { taskId, content, currentUserId, replyToCommentId });
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`, { method: 'POST', headers: this.getHeaders(currentUserId), body: JSON.stringify({ content, replyToCommentId }) });
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw localizedError(data.error ? data : tr("common:api.couldNotSendComment")); }
    return res.json();
  }

  static async updateTaskComment(id: string, content: string, currentUserId: string): Promise<TaskComment> {
    if (desktop()) return invoke('update_task_comment', { id, content, currentUserId });
    const res = await fetch(`/api/task-comments/${encodeURIComponent(id)}`, { method: 'PUT', headers: this.getHeaders(currentUserId), body: JSON.stringify({ content }) });
    if (!res.ok) throw localizedError('Failed to update task comment');
    return res.json();
  }

  static async deleteTaskComment(id: string, currentUserId: string): Promise<boolean> {
    if (desktop()) return invoke('delete_task_comment', { id, currentUserId });
    const res = await fetch(`/api/task-comments/${encodeURIComponent(id)}`, { method: 'DELETE', headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw localizedError('Failed to delete task comment');
    return Boolean((await res.json()).success);
  }

  static async getTaskActivity(taskId: string, currentUserId: string): Promise<TaskActivity[]> {
    if (desktop()) return invoke('get_task_activity', { taskId, currentUserId });
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/activity`, { headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw localizedError('Failed to fetch task activity');
    return res.json();
  }

  static async getTaskActivityPage(taskId: string, currentUserId: string, request: PageRequest = {}): Promise<RecordPage<TaskActivity>> {
    const { page = 1, pageSize = 20, snapshot } = request;
    if (desktop()) return invoke('get_task_activity_page', { taskId, currentUserId, page, pageSize, snapshot });
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (snapshot !== undefined) query.set('snapshot', String(snapshot));
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/activity?${query}`, { headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw localizedError(tr("common:api.couldNotLoadTaskActivity"));
    return res.json();
  }

  static async getSyncLogsPage(request: PageRequest = {}): Promise<SyncLogPage> {
    const { page = 1, pageSize = 20, snapshot } = request;
    if (desktop()) return invoke('get_sync_logs_page', { page, pageSize, snapshot });
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (snapshot !== undefined) query.set('snapshot', String(snapshot));
    const res = await fetch(`/api/sync/logs/page?${query}`);
    if (!res.ok) throw localizedError(tr("common:api.couldNotLoadSyncLog"));
    return res.json();
  }

  static async getSyncLogs(sinceVersion = 0): Promise<{ logs: ChangeLog[]; latestVersion: number }> {
    if (desktop()) return invoke('get_sync_logs', { sinceVersion });
    const res = await fetch(`/api/sync/logs?since=${sinceVersion}`);
    if (!res.ok) throw localizedError('Failed to fetch sync logs');
    return res.json();
  }

  static async getRiskWarnings(currentUserId?: string): Promise<RiskWarning[]> {
    if (desktop()) return invoke('get_risk_warnings', { currentUserId });
    const res = await fetch('/api/sync/risk-warnings', { headers: this.getHeaders(currentUserId) });
    if (!res.ok) throw localizedError('Failed to fetch risk warnings');
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
    if (!desktop()) throw localizedError(tr("common:api.fileTransferRequiresADesktopNode"));
    return invoke('register_file_for_transfer', { path });
  }

  static async captureChatScreenshot(hideWindow = false): Promise<void> {
    if (!desktop()) throw localizedError(tr('chat:screenshot.desktopRequired'));
    return invoke('capture_chat_screenshot', { hideWindow });
  }

  static async cancelChatScreenshot(): Promise<void> {
    if (desktop()) await invoke('cancel_screenshot');
  }

  static async downloadFileFromPeer(url: string, destination: string): Promise<string> {
    if (!desktop()) throw localizedError(tr("common:api.fileTransferRequiresADesktopNode"));
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
      const saved = JSON.parse(localStorage.getItem(scopedStorageKey(`lanmind_project_files:${projectId}`)) || '[]');
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  static async getProjectFolders(projectId: string): Promise<ProjectFolder[]> {
    if (desktop()) return invoke('get_project_folders', { projectId });
    try {
      const saved = JSON.parse(localStorage.getItem(scopedStorageKey(`lanmind_project_files:${projectId}:folders`)) || '[]');
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
      localStorage.setItem(scopedStorageKey(`lanmind_project_files:${projectId}`), JSON.stringify([record, ...list]));
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
      if (!key?.startsWith(scopedStorageKey('lanmind_project_files:')) || key.endsWith(':folders')) continue;
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
      const paths = JSON.parse(localStorage.getItem(scopedStorageKey(key)) || '[]');
      localStorage.setItem(scopedStorageKey(key), JSON.stringify(Array.from(new Set([...(Array.isArray(paths) ? paths : []), path]))));
    } catch { /* ignore storage quota */ }
    return record;
  }

  static async deleteProjectFolder(folderId: string, currentUserId: string, projectId?: string, folderPath?: string): Promise<boolean> {
    if (desktop()) return invoke('delete_project_folder', { folderId, currentUserId });
    if (projectId && folderPath) {
      const folderKey = `lanmind_project_files:${projectId}:folders`;
      try {
        const folders = JSON.parse(localStorage.getItem(scopedStorageKey(folderKey)) || '[]');
        localStorage.setItem(scopedStorageKey(folderKey), JSON.stringify(Array.isArray(folders) ? folders.filter((path) => path !== folderPath && !String(path).startsWith(`${folderPath}/`)) : []));
        const fileKey = `lanmind_project_files:${projectId}`;
        const files = JSON.parse(localStorage.getItem(scopedStorageKey(fileKey)) || '[]');
        localStorage.setItem(scopedStorageKey(fileKey), JSON.stringify(Array.isArray(files) ? files.filter((file) => !String(file?.relativePath || file?.name).startsWith(`${folderPath}/`) && file?.relativePath !== folderPath) : []));
      } catch { /* ignore malformed browser data */ }
    }
    return true;
  }

  static async readProjectFileContent(projectId: string, fileId: string): Promise<string> {
    if (desktop()) return invoke('read_project_file_content', { projectId, fileId });
    throw localizedError(tr("common:api.readingFileContentRequiresTheDesktopApp"));
  }

  static async downloadProjectFileTo(
    projectId: string,
    fileId: string,
    destinationPath: string
  ): Promise<string> {
    if (desktop()) return invoke('download_project_file_to', { projectId, fileId, destinationPath });
    throw localizedError(tr("common:api.downloadingFilesRequiresTheDesktopApp"));
  }

  static async saveFileToPath(
    dataUrl: string,
    destinationPath: string
  ): Promise<string> {
    if (desktop()) return invoke('save_file_to_path', { dataUrl, destinationPath });
    throw localizedError(tr("common:api.savingFilesRequiresTheDesktopApp"));
  }

  static async showItemInFolder(path: string): Promise<void> {
    if (desktop()) return invoke('show_item_in_folder', { path });
  }

  static async setGlobalShortcuts(bindings: GlobalShortcutBinding[]): Promise<void> {
    if (!desktop()) return;
    return invoke('set_global_shortcuts', { bindings });
  }

  static async getMcpStatus(): Promise<McpStatus> {
    if (!desktop()) throw localizedError(tr("common:api.mcpIsOnlyAvailableInTheDesktop"));
    return invoke('get_mcp_status');
  }

  static async updateMcpConfig(enabled: boolean, port: number): Promise<McpStatus> {
    if (!desktop()) throw localizedError(tr("common:api.mcpIsOnlyAvailableInTheDesktop"));
    return invoke('update_mcp_config', { enabled, port });
  }

  static async rotateMcpToken(): Promise<McpStatus> {
    if (!desktop()) throw localizedError(tr("common:api.mcpIsOnlyAvailableInTheDesktop"));
    return invoke('rotate_mcp_token');
  }

  static async getWebStatus(): Promise<WebStatus> {
    if (!desktop()) throw localizedError(tr("common:api.webAccessSettingsRequireTheDesktopApp"));
    return invoke('get_web_status');
  }

  static async getAppLockStatus(): Promise<AppLockStatus> {
    if (!desktop()) throw localizedError(tr("common:api.autoLockIsOnlyAvailableInThe"));
    return invoke('get_app_lock_status');
  }

  static async updateAppLockConfig(config: { enabled: boolean; idleMinutes: number; password?: string; currentPassword?: string; clearPassword?: boolean }): Promise<AppLockStatus> {
    if (!desktop()) throw localizedError(tr("common:api.autoLockIsOnlyAvailableInThe"));
    return invoke('update_app_lock_config', config);
  }

  static async recordAppActivity(): Promise<AppLockStatus> { return invoke('record_app_activity'); }
  static async lockApp(): Promise<AppLockStatus> { return invoke('lock_app'); }
  static async unlockApp(password: string): Promise<AppLockStatus> { return invoke('unlock_app', { password }); }

  static async getWebPassword(): Promise<string | null> {
    if (!desktop()) throw localizedError(tr("common:api.theWebAccessPasswordCanOnlyBe"));
    return invoke('get_web_password');
  }

  static async updateWebConfig(config: {
    readOnly: boolean;
    enabled: boolean;
    bindAddress: '0.0.0.0' | '127.0.0.1';
    port: number;
    password?: string;
  }): Promise<WebStatus> {
    if (!desktop()) throw localizedError(tr("common:api.webAccessSettingsRequireTheDesktopApp"));
    return invoke('update_web_config', config);
  }

  static async getLLMConfig(): Promise<LLMConfig> {
    if (desktop()) return invoke('get_llm_config');
    const res = await fetch('/api/llm/config');
    if (!res.ok) throw localizedError('Failed to fetch LLM config');
    return res.json();
  }

  static async updateLLMConfig(config: Partial<LLMConfig>): Promise<LLMConfig> {
    if (desktop()) return invoke('update_llm_config', { config });
    const res = await fetch('/api/llm/config', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(config) });
    if (!res.ok) throw localizedError('Failed to update LLM config');
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
    if (!res.ok) throw localizedError('Failed to fetch PPT templates');
    return res.json();
  }

  static async addPPTTemplate(template: PPTTemplate): Promise<PPTTemplate> {
    if (desktop()) return invoke('add_ppt_template', { template });
    const res = await fetch('/api/ppt/templates', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(template) });
    if (!res.ok) throw localizedError('Failed to save custom PPT template');
    return res.json();
  }

  static async quickParseTask(input: string): Promise<QuickParseResult> {
    if (desktop()) return invoke('quick_parse_task', { input, locale: currentLocale() });
    const res = await fetch('/api/llm/quick-parse', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ input, locale: currentLocale() }) });
    if (!res.ok) throw localizedError('Failed to parse quick task');
    return res.json();
  }

  static async sendAIChat(prompt: string, systemPrompt?: string, modelName?: string): Promise<string> {
    if (desktop()) return invoke('send_ai_chat', { prompt, systemPrompt, modelName });
    const res = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, modelName }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => null);
      throw localizedError(error?.error ? error : 'AI 对话请求失败');
    }
    const data = await res.json();
    return data.reply || data.content || '';
  }

  static async sendAIChatStream(
    prompt: string,
    onChunk: (chunk: string) => void,
    systemPrompt?: string,
    modelName?: string,
  ): Promise<void> {
    if (desktop()) {
      const channel = new Channel<{ event: 'chunk' | 'done' | 'error'; data?: string }>((event) => {
        if (event.event === 'chunk' && event.data) {
          onChunk(event.data);
        }
      });
      return invoke('send_ai_chat_stream', { prompt, systemPrompt, modelName, channel });
    }
    const res = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ prompt, systemPrompt, modelName }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => null);
      throw localizedError(error?.error ? error : 'AI 对话请求失败');
    }
    const data = await res.json();
    const reply = data.reply || data.content || '';
    if (reply) {
      onChunk(reply);
    }
  }

  static async generateReport(params: ReportGenerationRequest): Promise<GeneratedReport> {
    params = { ...params, locale: params.locale || currentLocale() };
    if (desktop()) return invoke('generate_report', { params });
    const res = await fetch('/api/llm/generate-report', { method: 'POST', headers: this.getHeaders(), body: JSON.stringify(params) });
    if (!res.ok) {
      const error = await res.json().catch(() => null);
      throw localizedError(error?.error ? error : tr("common:api.couldNotGenerateReport"));
    }
    return res.json();
  }

  static async generatePresentationPlan(params: ReportGenerationRequest): Promise<GeneratedPresentation> {
    params = { ...params, locale: params.locale || currentLocale() };
    if (desktop()) return invoke('generate_presentation_plan', { params });
    const res = await fetch('/api/llm/generate-presentation-plan', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => null);
      throw localizedError(error?.error ? error : tr("common:api.couldNotGeneratePresentation"));
    }
    return res.json();
  }

  static async getChatMessages(currentUserId: string, targetId?: string): Promise<LanChatMessage[]> {
    if (!desktop()) return [];
    return invoke('get_chat_messages', { currentUserId, targetId });
  }

  static async getChatMessagePage(params: {
    currentUserId: string;
    conversationType: 'broadcast' | 'user' | 'group';
    targetId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<ChatMessagePage> {
    if (!desktop()) return { messages: [], hasMore: false };
    return invoke('get_chat_message_page', {
      currentUserId: params.currentUserId,
      conversationType: params.conversationType,
      targetId: params.targetId,
      cursor: params.cursor,
      limit: params.limit,
    });
  }

  static async getChatUnreadSummaries(currentUserId: string): Promise<ChatUnreadSummary[]> {
    if (!desktop()) return [];
    return invoke('get_chat_unread_summaries', { currentUserId });
  }

  static async searchChatMessages(params: {
    currentUserId: string;
    conversationType: 'broadcast' | 'user' | 'group';
    targetId?: string;
    query: string;
    cursor?: string;
    limit?: number;
  }): Promise<ChatSearchPage> {
    if (!desktop()) return { results: [], total: 0 };
    return invoke('search_chat_messages', {
      currentUserId: params.currentUserId,
      conversationType: params.conversationType,
      targetId: params.targetId,
      query: params.query,
      cursor: params.cursor,
      limit: params.limit,
    });
  }

  static async getChatMessageContext(params: {
    currentUserId: string;
    conversationType: 'broadcast' | 'user' | 'group';
    targetId?: string;
    messageId: string;
    before?: number;
    after?: number;
  }): Promise<LanChatMessage[]> {
    if (!desktop()) return [];
    return invoke('get_chat_message_context', {
      currentUserId: params.currentUserId,
      conversationType: params.conversationType,
      targetId: params.targetId,
      messageId: params.messageId,
      before: params.before,
      after: params.after,
    });
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
    if (!desktop()) throw localizedError(tr("common:api.chatSyncRequiresTheDesktopApp"));
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
    if (!desktop()) throw localizedError(tr("common:api.groupSyncRequiresTheDesktopApp"));
    return invoke('save_chat_group', { group });
  }

  static async updateChatGroupMembers(
    groupId: string,
    memberIds: string[],
    adminIdsOrCurrentUserId?: string[] | string,
    currentUserIdParam?: string,
  ): Promise<LanChatGroup> {
    if (!desktop()) throw localizedError(tr("common:api.memberManagementRequiresTheDesktopApp"));
    let adminIds: string[] | undefined;
    let currentUserId: string;
    if (typeof adminIdsOrCurrentUserId === 'string') {
      currentUserId = adminIdsOrCurrentUserId;
      adminIds = undefined;
    } else {
      adminIds = adminIdsOrCurrentUserId;
      currentUserId = currentUserIdParam || '';
    }
    return invoke('update_chat_group_members', { groupId, memberIds, adminIds, currentUserId });
  }

  static async updateChatGroupProfile(
    groupId: string,
    name: string,
    description?: string,
    avatar?: string,
    projectId?: string,
    currentUserId?: string,
  ): Promise<LanChatGroup> {
    if (!desktop()) throw localizedError(tr("common:api.groupSettingsRequireTheDesktopApp"));
    return invoke('update_chat_group_profile', {
      groupId,
      name,
      description,
      avatar,
      projectId,
      currentUserId: currentUserId || '',
    });
  }

  static async transferChatGroup(groupId: string, targetUserId: string, currentUserId: string): Promise<LanChatGroup> {
    if (!desktop()) throw localizedError(tr("common:api.transferringAGroupRequiresTheDesktopApp"));
    return invoke('transfer_chat_group', { groupId, targetUserId, currentUserId });
  }

  static async deleteChatGroup(groupId: string, currentUserId: string): Promise<boolean> {
    if (!desktop()) throw localizedError(tr("common:api.deletingAGroupRequiresTheDesktopApp"));
    return invoke('delete_chat_group', { groupId, currentUserId });
  }


  static async getGroupAnnouncements(groupId: string): Promise<LanGroupAnnouncement[]> {
    if (!desktop()) return [];
    return invoke('get_group_announcements', { groupId });
  }

  static async saveGroupAnnouncement(
    announcement: Partial<LanGroupAnnouncement>,
    currentUserId?: string,
  ): Promise<LanGroupAnnouncement> {
    if (!desktop()) throw localizedError(tr("common:api.postingAnnouncementsRequiresTheDesktopApp"));
    return invoke('save_group_announcement', { announcement, currentUserId: currentUserId || null });
  }

  static async deleteGroupAnnouncement(
    announcementId: string,
    currentUserId?: string,
  ): Promise<void> {
    if (!desktop()) throw localizedError(tr("common:api.deletingAnnouncementsRequiresTheDesktopApp"));
    return invoke('delete_group_announcement', { announcementId, currentUserId: currentUserId || null });
  }

  static async pinGroupAnnouncement(
    announcementId: string,
    pinned: boolean,
    currentUserId?: string,
  ): Promise<LanGroupAnnouncement> {
    if (!desktop()) throw localizedError(tr("common:api.pinningAnnouncementsRequiresTheDesktopApp"));
    return invoke('pin_group_announcement', { announcementId, pinned, currentUserId: currentUserId || null });
  }

  static async markGroupAnnouncementRead(
    announcementId: string,
    readerId?: string,
  ): Promise<LanGroupAnnouncement> {
    if (!desktop()) throw localizedError(tr("common:api.readReceiptsRequireTheDesktopApp"));
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
    feature?: 'chat';
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
